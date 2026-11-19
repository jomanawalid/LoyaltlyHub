'use strict';
// Customers & Membership data access (Neon Postgres). The ONLY file in this service
// that runs SQL. Every query is parameterised and filtered by business_id, so one
// business can never read or change another business's customers.

const db = require('../../shared/db');

const COLUMNS = `customer_id AS "customerId", business_id AS "businessId", full_name AS "fullName",
  email, phone, status, status_reason AS "statusReason", tier, tier_evaluated_at AS "tierEvaluatedAt",
  joined_at AS "joinedAt", last_activity_at AS "lastActivityAt", updated_at AS "updatedAt"`;

async function businessExists(businessId) {
  return Boolean(await db.one(`SELECT 1 FROM businesses WHERE business_id = $1 AND status = 'active'`, [businessId]));
}

async function emailTaken(businessId, email, exceptCustomerId = null) {
  const row = await db.one(
    `SELECT 1 FROM customers
      WHERE business_id = $1 AND lower(email) = lower($2)
        AND ($3::uuid IS NULL OR customer_id <> $3::uuid)`,
    [businessId, email, exceptCustomerId],
  );
  return Boolean(row);
}

async function insert({ customerId, businessId, fullName, email, phone, cognitoSub, createdBy }) {
  return db.one(
    `INSERT INTO customers (customer_id, business_id, full_name, email, phone, cognito_sub, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [customerId, businessId, fullName, email.toLowerCase(), phone, cognitoSub, createdBy],
  );
}

async function findById(businessId, customerId) {
  return db.one(`SELECT ${COLUMNS}, cognito_sub AS "cognitoSub" FROM customers WHERE business_id = $1 AND customer_id = $2`, [
    businessId,
    customerId,
  ]);
}

async function search(businessId, { q, status, tier, limit, offset }) {
  const params = [businessId];
  const where = ['business_id = $1'];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  } else {
    where.push(`status <> 'erased'`);
  }
  if (tier) {
    params.push(tier);
    where.push(`tier = $${params.length}`);
  }
  if (q) {
    // One search box: partial name (trigram index), exact e-mail or exact phone.
    params.push(q);
    const i = params.length;
    where.push(`(lower(full_name) LIKE '%' || lower($${i}) || '%' OR lower(email) = lower($${i}) OR phone = $${i})`);
  }
  const whereSql = where.join(' AND ');
  params.push(limit, offset);
  const items = await db.query(
    `SELECT ${COLUMNS} FROM customers WHERE ${whereSql}
      ORDER BY joined_at DESC, customer_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRow = await db.one(`SELECT count(*)::int AS total FROM customers WHERE ${whereSql}`, params.slice(0, -2));
  return { items, total: countRow.total };
}

async function update(businessId, customerId, fields) {
  return db.one(
    `UPDATE customers
        SET full_name = COALESCE($3, full_name),
            email     = COALESCE(lower($4), email),
            phone     = COALESCE($5, phone),
            updated_at = now()
      WHERE business_id = $1 AND customer_id = $2 AND status <> 'erased'
      RETURNING ${COLUMNS}`,
    [businessId, customerId, fields.fullName ?? null, fields.email ?? null, fields.phone ?? null],
  );
}

/** Status change + history row in ONE transaction. Conditional on the old status (no lost updates). */
async function changeStatus(businessId, customerId, fromStatus, toStatus, reason, changedBy) {
  const [rows] = await db.transaction([
    {
      text: `UPDATE customers SET status = $4::text, status_reason = $5, updated_at = now()
              WHERE business_id = $1 AND customer_id = $2 AND status = $3::text
              RETURNING ${COLUMNS}`,
      params: [businessId, customerId, fromStatus, toStatus, reason],
    },
    {
      text: `INSERT INTO customer_status_history (customer_id, business_id, from_status, to_status, reason, changed_by)
             SELECT $2::uuid, $1::uuid, $3::text, $4::text, $5::text, $6::text
              WHERE EXISTS (SELECT 1 FROM customers WHERE business_id = $1 AND customer_id = $2 AND status = $4::text)`,
      params: [businessId, customerId, fromStatus, toStatus, reason, changedBy],
    },
  ]);
  return rows[0] || null;
}

/** Right-to-erasure: remove personal data, keep the anonymous row so ledger history stays valid. */
async function anonymize(businessId, customerId, fromStatus, changedBy) {
  const [rows] = await db.transaction([
    {
      text: `UPDATE customers
                SET full_name = 'Erased customer', email = NULL, phone = NULL, cognito_sub = NULL,
                    status = 'erased', status_reason = 'Erasure request', updated_at = now()
              WHERE business_id = $1 AND customer_id = $2 AND status <> 'erased'
              RETURNING customer_id AS "customerId"`,
      params: [businessId, customerId],
    },
    {
      text: `INSERT INTO customer_status_history (customer_id, business_id, from_status, to_status, reason, changed_by)
             VALUES ($2, $1, $3, 'erased', 'Erasure request', $4)`,
      params: [businessId, customerId, fromStatus, changedBy],
    },
  ]);
  return rows[0] || null;
}

async function saveTier(businessId, customerId, fromTier, toTier, points12m) {
  const statements = [
    {
      text: `UPDATE customers SET tier = $3, tier_evaluated_at = now(), updated_at = now()
              WHERE business_id = $1 AND customer_id = $2`,
      params: [businessId, customerId, toTier],
    },
  ];
  if (fromTier !== toTier) {
    statements.push({
      text: `INSERT INTO tier_history (customer_id, business_id, from_tier, to_tier, points_12_months)
             VALUES ($2, $1, $3, $4, $5)`,
      params: [businessId, customerId, fromTier, toTier, points12m],
    });
  }
  await db.transaction(statements);
}

async function lastTierChange(customerId) {
  const row = await db.one(`SELECT max(changed_at) AS at FROM tier_history WHERE customer_id = $1`, [customerId]);
  return row && row.at;
}

async function touchActivity(businessId, customerId) {
  await db.query(
    `UPDATE customers SET last_activity_at = now() WHERE business_id = $1 AND customer_id = $2`,
    [businessId, customerId],
  );
}

/** Active-members report: everything is aggregated in SQL (one row per group). */
async function membershipReport(businessId, days) {
  const summary = await db.one(
    `SELECT
        count(*) FILTER (WHERE status = 'active')::int                                         AS "activeMembers",
        count(*) FILTER (WHERE status = 'suspended')::int                                      AS "suspendedMembers",
        count(*) FILTER (WHERE status = 'active' AND last_activity_at >= now() - make_interval(days => $2))::int AS "activeInWindow",
        count(*) FILTER (WHERE joined_at >= now() - make_interval(days => $2))::int            AS "newInWindow",
        count(*) FILTER (WHERE status = 'active' AND last_activity_at < now() - interval '30 days'
                              AND last_activity_at >= now() - interval '90 days')::int         AS "atRisk",
        count(*) FILTER (WHERE status = 'active' AND (last_activity_at IS NULL
                              OR last_activity_at < now() - interval '90 days'))::int          AS "lapsed"
       FROM customers WHERE business_id = $1`,
    [businessId, days],
  );
  const byTier = await db.query(
    `SELECT tier, count(*)::int AS members FROM customers
      WHERE business_id = $1 AND status = 'active' GROUP BY tier ORDER BY tier`,
    [businessId],
  );
  return { ...summary, byTier };
}

module.exports = {
  businessExists,
  emailTaken,
  insert,
  findById,
  search,
  update,
  changeStatus,
  anonymize,
  saveTier,
  lastTierChange,
  touchActivity,
  membershipReport,
};
