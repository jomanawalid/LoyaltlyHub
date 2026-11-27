'use strict';
// Points & Transactions business logic (owner: Jana).

const repo = require('./repository');
const rules = require('./rules');
const idempotency = require('./idempotency');
const callService = require('../../shared/service-client').serviceClient('points');
const { conflict, notFound, badRequest } = require('../../shared/errors');
const { logger } = require('../../shared/logger');
const { publishAlert } = require('../../shared/alerts');
const { ROLES, assertCustomerAccess } = require('../../shared/auth');

/** Ask Customers whether the member exists and is active, and for the tier multiplier. */
async function requireActiveMember(businessId, customerId, requestId) {
  const m = await callService('customers', 'getMembership', { customerId, businessId }, { requestId });
  if (m.status !== 'active') throw conflict('CUSTOMER_NOT_ACTIVE', `Customer status is ${m.status}`);
  return m;
}

/**
 * F1: Add points for a purchase.
 * Rules: idempotency key (DynamoDB), active member (Customers service), earn rate x tier
 * multiplier, max purchase, daily cap; balance + ledger row in one atomic statement;
 * then tell Customers about the activity so the tier is re-evaluated.
 */
async function earnPoints(user, { customerId, purchaseAmount }, idempotencyKey, requestId) {
  const claim = await idempotency.begin(user.businessId, idempotencyKey, { customerId, purchaseAmount });
  if (claim.replay) {
    logger.info('IDEMPOTENT_REPLAY', { customerId });
    return { ...claim.replay, replayed: true };
  }
  try {
    const member = await requireActiveMember(user.businessId, customerId, requestId);
    const rule = await repo.getEarnRule(user.businessId);
    const points = rules.calculateEarnPoints(purchaseAmount, rule.pointsPerUnit, member.multiplier);
    const earnedToday = await repo.earnedToday(user.businessId, customerId);
    const broken = rules.checkEarnLimits({
      purchaseAmount,
      maxPurchase: rule.maxPurchase,
      points,
      earnedToday,
      dailyCap: rule.dailyPointsCap,
    });
    if (broken === 'PURCHASE_OVER_LIMIT' || broken === 'PURCHASE_TOO_SMALL') throw badRequest(broken, { purchaseAmount });
    if (broken) throw conflict(broken, `earnedToday=${earnedToday} points=${points} cap=${rule.dailyPointsCap}`);

    const tx = await repo.earn({
      businessId: user.businessId,
      customerId,
      points,
      purchaseAmount,
      multiplier: member.multiplier,
      idempotencyKey,
      createdBy: user.sub,
    });
    if (!tx) throw conflict('ACCOUNT_CLOSED', 'Points account is closed');

    // Tier re-evaluation in Customers. A failure here must not undo the earn.
    let tier = { tier: member.tier, changed: false };
    try {
      const summary = await repo.earnSummary(user.businessId, customerId);
      tier = await callService('customers', 'applyEarnActivity', {
        customerId,
        businessId: user.businessId,
        points12m: summary.points12m,
      }, { requestId });
    } catch (err) {
      logger.warn('TIER_UPDATE_SKIPPED', { customerId, reason: err.message });
    }

    const { balance, ...transaction } = tx;
    const response = { transaction, balance, tier: tier.tier, tierChanged: tier.changed };
    await idempotency.complete(claim.pk, response);
    logger.audit('POINTS_EARNED', { customerId, points, purchaseAmount, by: user.sub });
    return response;
  } catch (err) {
    await idempotency.release(claim.pk).catch(() => {});
    throw err;
  }
}

/** F2: Balance (staff/owner, or the customer themself). */
async function getBalance(user, customerId) {
  assertCustomerAccess(user, customerId);
  const acct = await repo.getAccount(user.businessId, customerId);
  if (!acct) {
    // No account yet: make sure the customer really exists in this business before answering 0.
    await callService('customers', 'getMembership', { customerId, businessId: user.businessId });
    return { customerId, balance: 0, status: 'open' };
  }
  return acct;
}

/** F2: Transaction history. Customers are forced to their own id. */
async function getHistory(user, query) {
  const q = { ...query };
  if (user.role === ROLES.CUSTOMER) {
    if (q.customerId && q.customerId !== user.customerId) assertCustomerAccess(user, q.customerId);
    q.customerId = user.customerId;
  }
  const { items, total } = await repo.history(user.businessId, q);
  return { items, total, limit: q.limit, offset: q.offset };
}

/** F3: Owner voids an EARN or ADJUST (one void per transaction, balance never negative). */
async function voidTransaction(user, transactionId, { reason }) {
  const original = await repo.findTransaction(user.businessId, transactionId);
  if (!original) throw notFound('Transaction not found', { transactionId });
  const account = await repo.getAccount(user.businessId, original.customerId);
  const problem = rules.voidCheck(original, account ? account.balance : 0);
  if (problem) throw conflict(problem, `Cannot void ${transactionId}`);
  const result = await repo.voidTransaction({ businessId: user.businessId, original, reason, createdBy: user.sub });
  if (!result) throw conflict('POINTS_ALREADY_SPENT', 'Balance changed during void');
  logger.security('TRANSACTION_VOIDED', { transactionId, customerId: original.customerId, points: original.pointsDelta, by: user.sub });
  await publishAlert('TRANSACTION_VOIDED', { businessId: user.businessId, transactionId, customerId: original.customerId, by: user.sub });
  const { balance, ...transaction } = result;
  return { transaction, balance };
}

/** F3: Owner manual adjustment with a mandatory reason. */
async function adjustPoints(user, { customerId, pointsDelta, reason }) {
  await callService('customers', 'getMembership', { customerId, businessId: user.businessId });
  const acct = await repo.getAccount(user.businessId, customerId);
  if (!rules.adjustmentAllowed(acct ? acct.balance : 0, pointsDelta)) {
    throw conflict('INSUFFICIENT_POINTS', 'Adjustment would make balance negative');
  }
  const result = await repo.applyDelta({
    businessId: user.businessId,
    customerId,
    type: 'ADJUST',
    delta: pointsDelta,
    reason,
    createdBy: user.sub,
  });
  if (!result) throw conflict('INSUFFICIENT_POINTS', 'Balance changed during adjustment');
  logger.security('POINTS_ADJUSTED', { customerId, pointsDelta, by: user.sub });
  await publishAlert('POINTS_ADJUSTED', { businessId: user.businessId, customerId, pointsDelta, by: user.sub });
  const { balance, ...transaction } = result;
  return { transaction, balance };
}

async function getEarnRule(user) {
  return repo.getEarnRule(user.businessId);
}

async function updateEarnRule(user, body) {
  const rule = await repo.updateEarnRule(user.businessId, body, user.sub);
  logger.audit('EARN_RULE_UPDATED', { ...body, by: user.sub });
  return rule;
}

async function staffActivityReport(user, days) {
  const rows = await repo.staffActivity(user.businessId, days);
  const staff = rules.flagStaff(rows);
  const flagged = staff.filter((s) => s.flags.length);
  if (flagged.length) logger.security('STAFF_ACTIVITY_FLAGGED', { count: flagged.length });
  if (flagged.length) {
    await publishAlert('STAFF_ACTIVITY_FLAGGED', { businessId: user.businessId, count: flagged.length, by: user.sub });
  }
  return { days, staff };
}

// ---- used by Rewards (internal) ----

async function debitForRedemption({ businessId, customerId, points, redemptionId, createdBy }) {
  const tx = await repo.applyDelta({
    businessId,
    customerId,
    type: 'REDEEM',
    delta: -points,
    referenceId: redemptionId,
    reason: 'Reward redemption',
    createdBy,
  });
  if (!tx) throw conflict('INSUFFICIENT_POINTS', 'Balance lower than reward cost');
  return { transactionId: tx.transactionId, balance: tx.balance };
}

async function refundRedemption({ businessId, customerId, points, redemptionId, createdBy, reason }) {
  const tx = await repo.applyDelta({
    businessId,
    customerId,
    type: 'REFUND',
    delta: points,
    referenceId: redemptionId,
    reason: reason || 'Redemption refund',
    createdBy,
  });
  if (!tx) throw conflict('ACCOUNT_CLOSED', 'Cannot refund to closed account');
  return { transactionId: tx.transactionId, balance: tx.balance };
}

module.exports = {
  earnPoints,
  getBalance,
  getHistory,
  voidTransaction,
  adjustPoints,
  getEarnRule,
  updateEarnRule,
  staffActivityReport,
  debitForRedemption,
  refundRedemption,
};
