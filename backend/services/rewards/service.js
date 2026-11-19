'use strict';
// Rewards & Redemption business logic (owner: Habiba).

const crypto = require('node:crypto');
const repo = require('./repository');
const voucher = require('./voucher');
const aws = require('./aws-clients');
const callService = require('../../shared/service-client').serviceClient('rewards');
const { conflict, notFound, badRequest, forbidden } = require('../../shared/errors');
const { logger } = require('../../shared/logger');
const { ROLES, assertCustomerAccess } = require('../../shared/auth');
const { PG } = require('../../shared/db');

// ---------- F1: reward catalogue (owner manages, everyone browses) ----------

/** Customers also see whether they can afford each reward (balance from the Points service). */
async function browseRewards(user, query) {
  const { items, total } = await repo.listRewards(user.businessId, query);
  if (user.role !== ROLES.CUSTOMER) return { items, total, limit: query.limit, offset: query.offset };
  const { balance } = await callService('points', 'getBalance', { customerId: user.customerId, businessId: user.businessId });
  return {
    balance,
    items: items.map((r) => ({
      ...r,
      affordable: balance >= r.pointsCost && r.stock > 0,
      pointsNeeded: Math.max(0, r.pointsCost - balance),
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

async function createReward(user, body) {
  const reward = await repo.createReward(user.businessId, body, user.sub).catch((err) => {
    if (err.code === PG.UNIQUE_VIOLATION) throw conflict('REWARD_NAME_TAKEN', 'Active reward with this name exists');
    throw err;
  });
  logger.audit('REWARD_CREATED', { rewardId: reward.rewardId, pointsCost: reward.pointsCost });
  return reward;
}

async function updateReward(user, rewardId, body) {
  const reward = await repo.updateReward(user.businessId, rewardId, body);
  if (!reward) {
    const exists = await repo.findReward(user.businessId, rewardId);
    if (!exists) throw notFound('Reward not found', { rewardId });
    throw conflict('REWARD_RETIRED', 'Retired rewards cannot be edited');
  }
  logger.audit('REWARD_UPDATED', { rewardId, fields: Object.keys(body) });
  return reward;
}

async function retireReward(user, rewardId) {
  const done = await repo.retireReward(user.businessId, rewardId);
  if (!done) {
    const exists = await repo.findReward(user.businessId, rewardId);
    if (!exists) throw notFound('Reward not found', { rewardId });
    throw conflict('REWARD_RETIRED', 'Reward already retired');
  }
  logger.audit('REWARD_RETIRED', { rewardId });
}

// ---------- F2: redeem a reward (saga across Customers, Points, S3/SQS) ----------

function resolveCustomerId(user, requested) {
  if (user.role === ROLES.CUSTOMER) {
    // The customer id comes from the token, never from what was typed.
    if (requested && requested !== user.customerId) assertCustomerAccess(user, requested);
    return user.customerId;
  }
  if (!requested) throw badRequest('Staff/Owner must say which customer is redeeming');
  return requested;
}

/**
 * 1. Check the reward (exists, active, in stock, monthly limit) and the member (active).
 * 2. Points service debits the cost: conditional SQL "balance >= cost" -> 409 if not enough.
 * 3. Take one item from stock + store the redemption with a voucher code (one statement).
 *    If that fails (someone took the last item), refund the points (compensation).
 * 4. Queue the confirmation e-mail (SQS -> notifier Lambda -> Brevo). Never blocks the answer.
 */
async function redeem(user, body, requestId) {
  const customerId = resolveCustomerId(user, body.customerId);
  const reward = await repo.findReward(user.businessId, body.rewardId);
  if (!reward) throw notFound('Reward not found', { rewardId: body.rewardId });

  const member = await callService('customers', 'getMembership', { customerId, businessId: user.businessId }, { requestId });
  if (member.status !== 'active') throw conflict('CUSTOMER_NOT_ACTIVE', `Customer status is ${member.status}`);

  const recent = await repo.countRecentRedemptions(user.businessId, customerId, reward.rewardId);
  const blocker = voucher.redeemBlocker(reward, recent);
  if (blocker) throw conflict(blocker, `Reward ${reward.rewardId} blocked: ${blocker}`);

  const redemptionId = crypto.randomUUID();
  const debit = await callService(
    'points',
    'debitPoints',
    { customerId, businessId: user.businessId, points: reward.pointsCost, redemptionId, createdBy: user.sub },
    { requestId },
  );

  let redemption;
  try {
    for (let attempt = 1; attempt <= 2 && !redemption; attempt += 1) {
      try {
        redemption = await repo.createRedemptionWithStock({
          redemptionId,
          businessId: user.businessId,
          customerId,
          rewardId: reward.rewardId,
          transactionId: debit.transactionId,
          points: reward.pointsCost,
          voucherCode: voucher.generateVoucherCode(),
          createdBy: user.sub,
        });
        if (!redemption) throw conflict('OUT_OF_STOCK', 'Lost the race for the last item');
      } catch (err) {
        // Voucher code collision is astronomically rare; retry once with a new code.
        if (err.code === PG.UNIQUE_VIOLATION && attempt === 1) continue;
        throw err;
      }
    }
  } catch (err) {
    const refund = await callService(
      'points',
      'creditPoints',
      { customerId, businessId: user.businessId, points: reward.pointsCost, redemptionId, createdBy: user.sub, reason: 'Redemption failed: automatic refund' },
      { requestId },
    ).catch((e) => {
      logger.error('REFUND_FAILED_MANUAL_ACTION_NEEDED', { redemptionId, customerId, points: reward.pointsCost, err: e });
      return null;
    });
    logger.warn('REDEMPTION_COMPENSATED', { redemptionId, refunded: Boolean(refund), reason: err.message });
    throw err;
  }

  try {
    await aws.enqueueVoucherEmail({ redemptionId, businessId: user.businessId });
  } catch (err) {
    logger.error('EMAIL_QUEUE_FAILED', { redemptionId, err });
    await repo.setEmailStatus(redemptionId, 'failed').catch(() => {});
    redemption.emailStatus = 'failed';
  }

  logger.audit('REWARD_REDEEMED', { redemptionId, rewardId: reward.rewardId, customerId, points: reward.pointsCost });
  return { redemption, balance: debit.balance };
}

// ---------- F3: redemption history + voucher fulfilment workflow ----------

async function listRedemptions(user, query) {
  const q = { ...query };
  if (user.role === ROLES.CUSTOMER) {
    if (q.customerId && q.customerId !== user.customerId) assertCustomerAccess(user, q.customerId);
    if (q.voucherCode) throw forbidden('Customers cannot search by voucher code');
    q.customerId = user.customerId;
  }
  const { items, total } = await repo.listRedemptions(user.businessId, q);
  // Staff see masked codes (they must ask the customer for the real one to fulfil).
  const shown = user.role === ROLES.CUSTOMER ? items : items.map((r) => ({ ...r, voucherCode: voucher.maskVoucher(r.voucherCode) }));
  return { items: shown, total, limit: q.limit, offset: q.offset };
}

async function changeRedemptionStatus(user, redemptionId, { status, voucherCode, reason }) {
  const current = await repo.findRedemption(user.businessId, redemptionId);
  if (!current) throw notFound('Redemption not found', { redemptionId });
  if (!voucher.canTransition(current.status, status)) {
    throw conflict('INVALID_STATUS_TRANSITION', `${current.status} -> ${status}`);
  }

  if (status === 'FULFILLED') {
    const done = await repo.fulfil(user.businessId, redemptionId, voucherCode, user.sub);
    if (!done) {
      logger.security('VOUCHER_CODE_MISMATCH', { redemptionId });
      throw conflict('VOUCHER_MISMATCH', 'Voucher code does not match or already used');
    }
    logger.audit('VOUCHER_FULFILLED', { redemptionId, by: user.sub });
    return { ...done, voucherCode: voucher.maskVoucher(current.voucherCode) };
  }

  // CANCELLED: owner only, puts stock back and refunds the points.
  if (user.role !== ROLES.OWNER) throw forbidden('Only the owner can cancel a voucher');
  const cancelled = await repo.cancel(user.businessId, redemptionId, reason);
  if (!cancelled) throw conflict('INVALID_STATUS_TRANSITION', 'Redemption no longer ISSUED');
  const refund = await callService('points', 'creditPoints', {
    customerId: cancelled.customerId,
    businessId: user.businessId,
    points: cancelled.pointsSpent,
    redemptionId,
    createdBy: user.sub,
    reason: `Voucher cancelled: ${reason}`,
  });
  logger.security('VOUCHER_CANCELLED', { redemptionId, refunded: cancelled.pointsSpent, by: user.sub });
  return { redemptionId, status: 'CANCELLED', refundedPoints: cancelled.pointsSpent, balance: refund.balance };
}

// ---------- F4: owner reports + dashboard ----------

async function redemptionReport(user, { from, to, format }) {
  if (from > to) throw badRequest('from is after to');
  const rows = await repo.redemptionReport(user.businessId, from, to);
  const totals = rows.reduce(
    (t, r) => ({ redemptions: t.redemptions + r.redemptions, pointsSpent: t.pointsSpent + r.pointsSpent }),
    { redemptions: 0, pointsSpent: 0 },
  );
  if (format === 'csv') {
    const csv = voucher.toCsv(rows, ['rewardName', 'redemptions', 'fulfilled', 'cancelled', 'pointsSpent', 'uniqueCustomers']);
    const link = await aws.storeReportAndSign(user.businessId, csv);
    logger.audit('REPORT_EXPORTED', { key: link.key });
    return { from, to, totals, downloadUrl: link.downloadUrl, expiresIn: link.expiresIn };
  }
  return { from, to, totals, rows };
}

/** One screen for the owner: data from all three services. */
async function ownerDashboard(user, days) {
  const ref = { businessId: user.businessId, days };
  const [members, points, redemptions] = await Promise.all([
    callService('customers', 'getActiveMembersSummary', ref),
    callService('points', 'getPointsSummary', ref),
    repo.redemptionStats(user.businessId, days),
  ]);
  return { days, members, points, redemptions };
}

module.exports = {
  browseRewards,
  createReward,
  updateReward,
  retireReward,
  redeem,
  listRedemptions,
  changeRedemptionStatus,
  redemptionReport,
  ownerDashboard,
};
