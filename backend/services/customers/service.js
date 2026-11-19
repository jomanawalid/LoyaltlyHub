'use strict';
// Customers & Membership business logic (owner: Jomana).
// Controllers call these functions; these functions call the repository (SQL),
// Cognito, and the other services. No SQL and no req/res objects in here.

const crypto = require('node:crypto');
const repo = require('./repository');
const cognito = require('./cognito');
const tiers = require('./tiers');
const { canTransition } = require('./status-workflow');
const callService = require('../../shared/service-client').serviceClient('customers');
const { conflict, notFound, AppError } = require('../../shared/errors');
const { logger } = require('../../shared/logger');
const { ROLES, assertCustomerAccess } = require('../../shared/auth');

function publicView(customer) {
  if (!customer) return customer;
  const { cognitoSub, ...rest } = customer; // internal link, never returned
  return { ...rest, segment: tiers.engagementSegment(customer.lastActivityAt) };
}

async function getOrThrow(businessId, customerId) {
  const customer = await repo.findById(businessId, customerId);
  // Not in this business -> 404, so IDs from other businesses cannot be probed.
  if (!customer) throw notFound('Customer not found in caller business', { customerId });
  return customer;
}

/** F1: Register a customer = DB row + Cognito login, with compensation if one half fails. */
async function registerCustomer(user, { fullName, email, phone }) {
  if (!(await repo.businessExists(user.businessId))) throw notFound('Business not active');
  if (await repo.emailTaken(user.businessId, email)) {
    throw conflict('EMAIL_TAKEN', 'E-mail already registered in this business');
  }
  const customerId = crypto.randomUUID();
  const login = await cognito.createCustomerLogin({ email, customerId, businessId: user.businessId }).catch((err) => {
    if (err.name === 'UsernameExistsException') throw conflict('EMAIL_TAKEN', 'Cognito user already exists');
    throw err;
  });
  let customer;
  try {
    customer = await repo.insert({
      customerId,
      businessId: user.businessId,
      fullName: fullName.trim(),
      email,
      phone,
      cognitoSub: login.cognitoSub,
      createdBy: user.sub,
    });
  } catch (err) {
    // Compensation: never leave a login without a customer record.
    await cognito.deleteLogin(login.cognitoSub).catch((e) => logger.error('COGNITO_ROLLBACK_FAILED', { err: e }));
    throw err;
  }
  logger.audit('CUSTOMER_REGISTERED', { customerId, createdBy: user.sub });
  return {
    customer: publicView(customer),
    login: { inviteMode: login.inviteMode, temporaryPassword: login.temporaryPassword },
  };
}

/** F2: Search / filter customers with pagination. */
async function searchCustomers(user, query) {
  const { items, total } = await repo.search(user.businessId, query);
  return { items: items.map(publicView), total, limit: query.limit, offset: query.offset };
}

async function getCustomer(user, customerId) {
  assertCustomerAccess(user, customerId);
  return publicView(await getOrThrow(user.businessId, customerId));
}

/** F3: Update contact details (and keep the Cognito login e-mail in sync). */
async function updateCustomer(user, customerId, fields) {
  const current = await getOrThrow(user.businessId, customerId);
  if (current.status === 'erased') throw conflict('CUSTOMER_ERASED', 'Cannot edit an erased customer');
  if (fields.email && fields.email.toLowerCase() !== current.email) {
    if (await repo.emailTaken(user.businessId, fields.email, customerId)) {
      throw conflict('EMAIL_TAKEN', 'E-mail already used by another customer');
    }
    if (current.cognitoSub) await cognito.updateLoginEmail(current.cognitoSub, fields.email.toLowerCase());
  }
  const updated = await repo.update(user.businessId, customerId, {
    ...fields,
    fullName: fields.fullName && fields.fullName.trim(),
  });
  logger.audit('CUSTOMER_UPDATED', { customerId, fields: Object.keys(fields) });
  return publicView(updated);
}

/** F4: Membership status workflow (suspend / reactivate) with Cognito login enable/disable. */
async function changeStatus(user, customerId, { status, reason }) {
  const current = await getOrThrow(user.businessId, customerId);
  if (!canTransition(current.status, status)) {
    throw conflict('INVALID_STATUS_TRANSITION', `Cannot go from ${current.status} to ${status}`);
  }
  const updated = await repo.changeStatus(user.businessId, customerId, current.status, status, reason, user.sub);
  if (!updated) throw conflict('CONCURRENT_UPDATE', 'Status changed by someone else');
  if (current.cognitoSub) await cognito.setLoginEnabled(current.cognitoSub, status === 'active');
  logger.security('CUSTOMER_STATUS_CHANGED', { customerId, from: current.status, to: status, by: user.sub });
  return publicView(updated);
}

/**
 * F5: Tier engine. Asks Points for the points earned in the last 12 months,
 * applies the tier rules (upgrade now, downgrade one level after a 30-day grace)
 * and stores any change with history.
 */
async function evaluateTier(businessId, customer, points12m) {
  const lastChange = await repo.lastTierChange(customer.customerId);
  const decision = tiers.decideTier(customer.tier, points12m, lastChange || customer.joinedAt);
  await repo.saveTier(businessId, customer.customerId, customer.tier, decision.tier, points12m);
  if (decision.changed) {
    logger.audit('TIER_CHANGED', { customerId: customer.customerId, from: customer.tier, to: decision.tier, points12m });
  }
  return decision;
}

async function getMembership(user, customerId) {
  assertCustomerAccess(user, customerId);
  const customer = await getOrThrow(user.businessId, customerId);
  if (customer.status === 'erased') throw notFound('Customer erased');
  const summary = await callService('points', 'getEarnSummary', { customerId, businessId: user.businessId });
  const decision = await evaluateTier(user.businessId, customer, summary.points12m);
  const prog = tiers.progress(summary.points12m);
  return {
    customerId,
    status: customer.status,
    tier: decision.tier,
    multiplier: tiers.multiplierFor(decision.tier),
    points12m: summary.points12m,
    nextTier: prog.nextTier,
    pointsToNextTier: prog.pointsToNextTier,
    segment: tiers.engagementSegment(customer.lastActivityAt),
    balance: summary.balance,
  };
}

/** Customer's own profile page: profile + balance + tier in one call. */
async function getMe(user) {
  if (user.role !== ROLES.CUSTOMER) throw new AppError(403, 'FORBIDDEN', '/me is for customers');
  const customer = await getCustomer(user, user.customerId);
  const membership = await getMembership(user, user.customerId);
  return { ...customer, membership };
}

/**
 * F6: Right-to-erasure workflow (inter-service):
 *  1. Rewards: refuse if the customer still has ISSUED (unfulfilled) vouchers.
 *  2. Points: close the account (a CLOSE ledger row zeroes the balance; history kept).
 *  3. Anonymise personal data here and delete the Cognito login.
 */
async function eraseCustomer(user, customerId) {
  const customer = await getOrThrow(user.businessId, customerId);
  if (customer.status === 'erased') throw conflict('CUSTOMER_ERASED', 'Already erased');

  const { openVouchers } = await callService('rewards', 'countOpenVouchers', { customerId, businessId: user.businessId });
  if (openVouchers > 0) throw conflict('OPEN_VOUCHERS', `${openVouchers} voucher(s) not fulfilled yet`);

  await callService('points', 'closeAccount', { customerId, businessId: user.businessId, closedBy: user.sub });
  await repo.anonymize(user.businessId, customerId, customer.status, user.sub);
  if (customer.cognitoSub) {
    await cognito.deleteLogin(customer.cognitoSub).catch((err) => logger.error('COGNITO_DELETE_FAILED', { err }));
  }
  logger.security('CUSTOMER_ERASED', { customerId, by: user.sub });
}

/** F7: Active-members report for the owner. */
async function activeMembersReport(user, days) {
  return { days, ...(await repo.membershipReport(user.businessId, days)) };
}

module.exports = {
  registerCustomer,
  searchCustomers,
  getCustomer,
  updateCustomer,
  changeStatus,
  getMembership,
  getMe,
  eraseCustomer,
  activeMembersReport,
  evaluateTier,
  publicView,
};
