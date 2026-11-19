'use strict';
// Points & Transactions data access (Neon Postgres). Balance changes and their
// ledger rows are ALWAYS written in one atomic statement/transaction, and every
// debit is conditional ("only if balance >= cost"), so two parallel requests can
// never spend the same points twice. Ledger rows are only ever INSERTed.

const db = require('../../shared/db');

const TX_COLUMNS = `transaction_id AS "transactionId", customer_id AS "customerId", type,
  points_delta AS "pointsDelta", purchase_amount::float AS "purchaseAmount", tier_multiplier::float AS "tierMultiplier",
  reason, reference_id AS "referenceId", voids_transaction_id AS "voidsTransactionId",
  created_by AS "createdBy", created_at AS "createdAt"`;

const ensureAccount = (businessId, customerId) => ({
  text: `INSERT INTO points_accounts (customer_id, business_id) VALUES ($2, $1) ON CONFLICT (customer_id) DO NOTHING`,
  params: [businessId, customerId],
});

async function getEarnRule(businessId) {
  await db.query(`INSERT INTO earn_rules (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  return db.one(
    `SELECT points_per_unit::float AS "pointsPerUnit", max_purchase::float AS "maxPurchase",
            daily_points_cap AS "dailyPointsCap", updated_by AS "updatedBy", updated_at AS "updatedAt"
       FROM earn_rules WHERE business_id = $1`,
    [businessId],
  );
}

async function updateEarnRule(businessId, { pointsPerUnit, maxPurchase, dailyPointsCap }, updatedBy) {
  return db.one(
    `INSERT INTO earn_rules (business_id, points_per_unit, max_purchase, daily_points_cap, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id) DO UPDATE
        SET points_per_unit = EXCLUDED.points_per_unit, max_purchase = EXCLUDED.max_purchase,
            daily_points_cap = EXCLUDED.daily_points_cap, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING points_per_unit::float AS "pointsPerUnit", max_purchase::float AS "maxPurchase",
               daily_points_cap AS "dailyPointsCap", updated_by AS "updatedBy", updated_at AS "updatedAt"`,
    [businessId, pointsPerUnit, maxPurchase, dailyPointsCap, updatedBy],
  );
}

async function getAccount(businessId, customerId) {
  return db.one(
    `SELECT customer_id AS "customerId", balance, status, updated_at AS "updatedAt"
       FROM points_accounts WHERE business_id = $1 AND customer_id = $2`,
    [businessId, customerId],
  );
}

async function earnedToday(businessId, customerId) {
  const row = await db.one(
    `SELECT COALESCE(sum(points_delta), 0)::int AS points FROM transactions
      WHERE business_id = $1 AND customer_id = $2 AND type = 'EARN' AND created_at >= date_trunc('day', now())`,
    [businessId, customerId],
  );
  return row.points;
}

/** Earn: create the account if needed, then add points + ledger row atomically. */
async function earn({ businessId, customerId, points, purchaseAmount, multiplier, idempotencyKey, createdBy }) {
  const [, rows] = await db.transaction([
    ensureAccount(businessId, customerId),
    {
      text: `WITH acct AS (
               UPDATE points_accounts SET balance = balance + $3, updated_at = now()
                WHERE customer_id = $2 AND business_id = $1 AND status = 'open'
                RETURNING balance
             ), tx AS (
               INSERT INTO transactions (business_id, customer_id, type, points_delta, purchase_amount, tier_multiplier, idempotency_key, created_by)
               SELECT $1, $2, 'EARN', $3, $4, $5, $6, $7 FROM acct
               RETURNING ${TX_COLUMNS}
             )
             SELECT tx.*, acct.balance FROM tx, acct`,
      params: [businessId, customerId, points, purchaseAmount, multiplier, idempotencyKey, createdBy],
    },
  ]);
  return rows[0] || null;
}

/** Signed change (ADJUST / REDEEM / REFUND). Applied only if the balance stays >= 0. */
async function applyDelta({ businessId, customerId, type, delta, reason, referenceId, createdBy }) {
  const statements = [];
  if (delta > 0) statements.push(ensureAccount(businessId, customerId));
  statements.push({
    text: `WITH acct AS (
             UPDATE points_accounts SET balance = balance + $3, updated_at = now()
              WHERE customer_id = $2 AND business_id = $1 AND status = 'open' AND balance + $3 >= 0
              RETURNING balance
           ), tx AS (
             INSERT INTO transactions (business_id, customer_id, type, points_delta, reason, reference_id, created_by)
             SELECT $1, $2, $4, $3, $5, $6, $7 FROM acct
             RETURNING ${TX_COLUMNS}
           )
           SELECT tx.*, acct.balance FROM tx, acct`,
    params: [businessId, customerId, delta, type, reason || null, referenceId || null, createdBy],
  });
  const results = await db.transaction(statements);
  return results[results.length - 1][0] || null;
}

async function findTransaction(businessId, transactionId) {
  return db.one(
    `SELECT ${TX_COLUMNS},
            (SELECT v.transaction_id FROM transactions v WHERE v.voids_transaction_id = t.transaction_id) AS "voidedBy"
       FROM transactions t WHERE business_id = $1 AND transaction_id = $2`,
    [businessId, transactionId],
  );
}

/** VOID = a new ledger row cancelling the original. The unique index allows one void per row. */
async function voidTransaction({ businessId, original, reason, createdBy }) {
  return db.one(
    `WITH acct AS (
       UPDATE points_accounts SET balance = balance - $3, updated_at = now()
        WHERE customer_id = $2 AND business_id = $1 AND balance - $3 >= 0
        RETURNING balance
     ), tx AS (
       INSERT INTO transactions (business_id, customer_id, type, points_delta, reason, voids_transaction_id, created_by)
       SELECT $1, $2, 'VOID', -$3::int, $4, $5, $6 FROM acct
       RETURNING ${TX_COLUMNS}
     )
     SELECT tx.*, acct.balance FROM tx, acct`,
    [businessId, original.customerId, original.pointsDelta, reason, original.transactionId, createdBy],
  );
}

async function history(businessId, { customerId, type, from, to, limit, offset }) {
  const params = [businessId];
  const where = ['business_id = $1'];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (customerId) add('customer_id = ?', customerId);
  if (type) add('type = ?', type);
  if (from) add('created_at >= ?', from);
  if (to) add('created_at < ?', to);
  const whereSql = where.join(' AND ');
  const items = await db.query(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE ${whereSql}
      ORDER BY created_at DESC, transaction_id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { total } = await db.one(`SELECT count(*)::int AS total FROM transactions WHERE ${whereSql}`, params);
  return { items, total };
}

/** Points earned in the last 12 months (EARN minus voided EARNs). Used by the tier engine. */
async function earnSummary(businessId, customerId) {
  return db.one(
    `SELECT COALESCE(sum(CASE WHEN t.type = 'EARN' THEN t.points_delta
                              WHEN t.type = 'VOID' AND o.type = 'EARN' THEN t.points_delta END), 0)::int AS "points12m",
            COALESCE((SELECT balance FROM points_accounts WHERE customer_id = $2 AND business_id = $1), 0)::int AS balance
       FROM transactions t
       LEFT JOIN transactions o ON o.transaction_id = t.voids_transaction_id
      WHERE t.business_id = $1 AND t.customer_id = $2 AND t.created_at >= now() - interval '365 days'`,
    [businessId, customerId],
  );
}

/** Erasure: zero the balance with a CLOSE ledger row and close the account. */
async function closeAccount(businessId, customerId, closedBy) {
  const account = await getAccount(businessId, customerId);
  if (!account || account.status === 'closed') return { closed: false, pointsRemoved: 0 };
  await db.transaction([
    {
      text: `INSERT INTO transactions (business_id, customer_id, type, points_delta, reason, created_by)
             SELECT $1, $2, 'CLOSE', -balance, 'Account closed (customer erasure)', $3
               FROM points_accounts WHERE business_id = $1 AND customer_id = $2 AND status = 'open'`,
      params: [businessId, customerId, closedBy],
    },
    {
      text: `UPDATE points_accounts SET balance = 0, status = 'closed', updated_at = now()
              WHERE business_id = $1 AND customer_id = $2`,
      params: [businessId, customerId],
    },
  ]);
  return { closed: true, pointsRemoved: account.balance };
}

async function staffActivity(businessId, days) {
  return db.query(
    `SELECT t.created_by AS "staffId",
            count(*) FILTER (WHERE t.type = 'EARN')::int                            AS earns,
            COALESCE(sum(t.points_delta) FILTER (WHERE t.type = 'EARN'), 0)::int    AS "pointsGiven",
            count(*) FILTER (WHERE t.type = 'EARN' AND v.transaction_id IS NOT NULL)::int AS "voidedEarns",
            count(*) FILTER (WHERE t.type = 'ADJUST')::int                          AS adjustments,
            count(*) FILTER (WHERE t.type = 'VOID')::int                            AS voids
       FROM transactions t
       LEFT JOIN transactions v ON v.voids_transaction_id = t.transaction_id
      WHERE t.business_id = $1 AND t.created_at >= now() - make_interval(days => $2)
        AND t.type IN ('EARN', 'ADJUST', 'VOID')
      GROUP BY t.created_by ORDER BY "pointsGiven" DESC`,
    [businessId, days],
  );
}

async function businessSummary(businessId, days) {
  return db.one(
    `SELECT COALESCE(sum(points_delta) FILTER (WHERE type = 'EARN'), 0)::int        AS "pointsIssued",
            COALESCE(-sum(points_delta) FILTER (WHERE type = 'REDEEM'), 0)::int     AS "pointsRedeemed",
            count(*) FILTER (WHERE type = 'EARN')::int                               AS purchases,
            COALESCE(sum(purchase_amount) FILTER (WHERE type = 'EARN'), 0)::float    AS "purchaseValue",
            (SELECT COALESCE(sum(balance), 0)::int FROM points_accounts WHERE business_id = $1) AS "outstandingPoints"
       FROM transactions WHERE business_id = $1 AND created_at >= now() - make_interval(days => $2)`,
    [businessId, days],
  );
}

module.exports = {
  getEarnRule,
  updateEarnRule,
  getAccount,
  earnedToday,
  earn,
  applyDelta,
  findTransaction,
  voidTransaction,
  history,
  earnSummary,
  closeAccount,
  staffActivity,
  businessSummary,
};
