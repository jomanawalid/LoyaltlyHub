'use strict';
// Rewards & Redemption data access (Neon Postgres). Every query is filtered by business_id.

const db = require('../../shared/db');

const REWARD = `reward_id AS "rewardId", name, description, points_cost AS "pointsCost", stock,
  max_per_customer_month AS "maxPerCustomerMonth", status, created_at AS "createdAt", updated_at AS "updatedAt"`;
const REDEMPTION = `r.redemption_id AS "redemptionId", r.customer_id AS "customerId", r.reward_id AS "rewardId",
  w.name AS "rewardName", r.transaction_id AS "transactionId", r.points_spent AS "pointsSpent",
  r.voucher_code AS "voucherCode", r.status, r.email_status AS "emailStatus", r.created_at AS "createdAt",
  r.fulfilled_by AS "fulfilledBy", r.fulfilled_at AS "fulfilledAt", r.cancel_reason AS "cancelReason"`;

async function listRewards(businessId, { status, limit, offset }) {
  const items = await db.query(
    `SELECT ${REWARD} FROM rewards WHERE business_id = $1 AND status = $2
      ORDER BY points_cost, name LIMIT $3 OFFSET $4`,
    [businessId, status, limit, offset],
  );
  const { total } = await db.one(`SELECT count(*)::int AS total FROM rewards WHERE business_id = $1 AND status = $2`, [
    businessId,
    status,
  ]);
  return { items, total };
}

async function findReward(businessId, rewardId) {
  return db.one(`SELECT ${REWARD} FROM rewards WHERE business_id = $1 AND reward_id = $2`, [businessId, rewardId]);
}

async function createReward(businessId, r, createdBy) {
  return db.one(
    `INSERT INTO rewards (business_id, name, description, points_cost, stock, max_per_customer_month, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${REWARD}`,
    [businessId, r.name.trim(), (r.description || '').trim(), r.pointsCost, r.stock, r.maxPerCustomerMonth || 5, createdBy],
  );
}

async function updateReward(businessId, rewardId, r) {
  return db.one(
    `UPDATE rewards SET name = COALESCE($3, name), description = COALESCE($4, description),
            points_cost = COALESCE($5, points_cost), stock = COALESCE($6, stock),
            max_per_customer_month = COALESCE($7, max_per_customer_month), updated_at = now()
      WHERE business_id = $1 AND reward_id = $2 AND status = 'active'
      RETURNING ${REWARD}`,
    [
      businessId,
      rewardId,
      r.name ? r.name.trim() : null,
      r.description != null ? r.description.trim() : null,
      r.pointsCost ?? null,
      r.stock ?? null,
      r.maxPerCustomerMonth ?? null,
    ],
  );
}

/** Soft delete: a retired reward stays in redemption history but can no longer be redeemed. */
async function retireReward(businessId, rewardId) {
  return db.one(
    `UPDATE rewards SET status = 'retired', updated_at = now()
      WHERE business_id = $1 AND reward_id = $2 AND status = 'active' RETURNING reward_id AS "rewardId"`,
    [businessId, rewardId],
  );
}

async function countRecentRedemptions(businessId, customerId, rewardId) {
  const row = await db.one(
    `SELECT count(*)::int AS n FROM redemptions
      WHERE business_id = $1 AND customer_id = $2 AND reward_id = $3 AND status <> 'CANCELLED'
        AND created_at >= now() - interval '30 days'`,
    [businessId, customerId, rewardId],
  );
  return row.n;
}

/**
 * Take one item from stock and record the redemption in ONE statement.
 * "stock > 0" in the WHERE clause means two customers racing for the last item
 * cannot both win: the second UPDATE matches no row and nothing is inserted.
 */
async function createRedemptionWithStock({ redemptionId, businessId, customerId, rewardId, transactionId, points, voucherCode, createdBy }) {
  return db.one(
    `WITH taken AS (
       UPDATE rewards SET stock = stock - 1, updated_at = now()
        WHERE business_id = $2 AND reward_id = $4 AND status = 'active' AND stock > 0
        RETURNING reward_id, name
     ), ins AS (
       INSERT INTO redemptions (redemption_id, business_id, customer_id, reward_id, transaction_id, points_spent, voucher_code, created_by)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8 FROM taken
       RETURNING *
     )
     SELECT ins.redemption_id AS "redemptionId", ins.customer_id AS "customerId", ins.reward_id AS "rewardId",
            taken.name AS "rewardName", ins.points_spent AS "pointsSpent", ins.voucher_code AS "voucherCode",
            ins.status, ins.email_status AS "emailStatus", ins.created_at AS "createdAt"
       FROM ins, taken`,
    [redemptionId, businessId, customerId, rewardId, transactionId, points, voucherCode, createdBy],
  );
}

async function findRedemption(businessId, redemptionId) {
  return db.one(
    `SELECT ${REDEMPTION} FROM redemptions r JOIN rewards w ON w.reward_id = r.reward_id
      WHERE r.business_id = $1 AND r.redemption_id = $2`,
    [businessId, redemptionId],
  );
}

async function listRedemptions(businessId, { customerId, status, voucherCode, limit, offset }) {
  const params = [businessId];
  const where = ['r.business_id = $1'];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (customerId) add('r.customer_id = ?', customerId);
  if (status) add('r.status = ?', status);
  if (voucherCode) add('r.voucher_code = ?', voucherCode);
  const whereSql = where.join(' AND ');
  const items = await db.query(
    `SELECT ${REDEMPTION} FROM redemptions r JOIN rewards w ON w.reward_id = r.reward_id
      WHERE ${whereSql} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { total } = await db.one(`SELECT count(*)::int AS total FROM redemptions r WHERE ${whereSql}`, params);
  return { items, total };
}

/** ISSUED -> FULFILLED only if the code the customer shows matches. */
async function fulfil(businessId, redemptionId, voucherCode, fulfilledBy) {
  return db.one(
    `UPDATE redemptions SET status = 'FULFILLED', fulfilled_by = $4, fulfilled_at = now()
      WHERE business_id = $1 AND redemption_id = $2 AND status = 'ISSUED' AND voucher_code = $3
      RETURNING redemption_id AS "redemptionId", status, fulfilled_at AS "fulfilledAt"`,
    [businessId, redemptionId, voucherCode, fulfilledBy],
  );
}

/** ISSUED -> CANCELLED and put the item back in stock, in one statement. */
async function cancel(businessId, redemptionId, reason) {
  return db.one(
    `WITH c AS (
       UPDATE redemptions SET status = 'CANCELLED', cancel_reason = $3
        WHERE business_id = $1 AND redemption_id = $2 AND status = 'ISSUED'
        RETURNING redemption_id, customer_id, reward_id, points_spent, status
     ), s AS (
       UPDATE rewards SET stock = stock + 1, updated_at = now()
        WHERE reward_id IN (SELECT reward_id FROM c)
        RETURNING reward_id
     )
     SELECT c.redemption_id AS "redemptionId", c.customer_id AS "customerId", c.reward_id AS "rewardId",
            c.points_spent AS "pointsSpent", c.status
       FROM c LEFT JOIN s ON s.reward_id = c.reward_id`,
    [businessId, redemptionId, reason],
  );
}

async function setEmailStatus(redemptionId, emailStatus) {
  await db.query(`UPDATE redemptions SET email_status = $2 WHERE redemption_id = $1`, [redemptionId, emailStatus]);
}

async function findForEmail(businessId, redemptionId) {
  return db.one(
    `SELECT r.redemption_id AS "redemptionId", r.customer_id AS "customerId", r.voucher_code AS "voucherCode",
            r.points_spent AS "pointsSpent", r.email_status AS "emailStatus", w.name AS "rewardName", b.name AS "businessName"
       FROM redemptions r JOIN rewards w ON w.reward_id = r.reward_id JOIN businesses b ON b.business_id = r.business_id
      WHERE r.business_id = $1 AND r.redemption_id = $2`,
    [businessId, redemptionId],
  );
}

async function countOpenVouchers(businessId, customerId) {
  const row = await db.one(
    `SELECT count(*)::int AS n FROM redemptions WHERE business_id = $1 AND customer_id = $2 AND status = 'ISSUED'`,
    [businessId, customerId],
  );
  return row.n;
}

/** Redemptions report: aggregated in SQL (GROUP BY) over a date range. */
async function redemptionReport(businessId, from, to) {
  return db.query(
    `SELECT w.reward_id AS "rewardId", w.name AS "rewardName",
            count(*) FILTER (WHERE r.status <> 'CANCELLED')::int AS redemptions,
            count(*) FILTER (WHERE r.status = 'FULFILLED')::int  AS fulfilled,
            count(*) FILTER (WHERE r.status = 'CANCELLED')::int  AS cancelled,
            COALESCE(sum(r.points_spent) FILTER (WHERE r.status <> 'CANCELLED'), 0)::int AS "pointsSpent",
            count(DISTINCT r.customer_id)::int AS "uniqueCustomers"
       FROM redemptions r JOIN rewards w ON w.reward_id = r.reward_id
      WHERE r.business_id = $1 AND r.created_at >= $2::date AND r.created_at < ($3::date + 1)
      GROUP BY w.reward_id, w.name ORDER BY redemptions DESC`,
    [businessId, from, to],
  );
}

async function redemptionStats(businessId, days) {
  return db.one(
    `SELECT count(*) FILTER (WHERE status <> 'CANCELLED')::int AS redemptions,
            count(*) FILTER (WHERE status = 'ISSUED')::int      AS "openVouchers",
            count(*) FILTER (WHERE email_status = 'failed')::int AS "emailFailures",
            (SELECT count(*)::int FROM rewards WHERE business_id = $1 AND status = 'active' AND stock <= 3) AS "lowStockRewards"
       FROM redemptions WHERE business_id = $1 AND created_at >= now() - make_interval(days => $2)`,
    [businessId, days],
  );
}

module.exports = {
  listRewards,
  findReward,
  createReward,
  updateReward,
  retireReward,
  countRecentRedemptions,
  createRedemptionWithStock,
  findRedemption,
  listRedemptions,
  fulfil,
  cancel,
  setEmailStatus,
  findForEmail,
  countOpenVouchers,
  redemptionReport,
  redemptionStats,
};
