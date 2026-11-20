#!/usr/bin/env node
'use strict';
// Owner: Jana. Loads 10,000 demo customers (and ~50,000 ledger rows) into the
// Demo Cafe business so search, reports and the load test run at realistic size.
//
// Usage (from backend/):  npm run db:seed10k            (adds 10,000)
//                         npm run db:seed10k -- 25000   (any number)
// Needs DATABASE_URL (Neon OWNER connection string) in backend/.env, like migrate.js.
// Seeded customers have NO Cognito login (cognito_sub is NULL) and use the reserved
// example.com domain, so no real person is ever e-mailed. Run it once per database;
// running it again adds a new batch with new e-mails.
//
// Everything is set-based SQL (generate_series), so 10,000 rows take seconds, not minutes.

const path = require('node:path');
const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
require(path.join(backendModules, 'dotenv')).config({ path: path.join(__dirname, '..', 'backend', '.env'), quiet: true });
const { Client } = require(path.join(backendModules, 'pg'));

const DEMO_CAFE = '11111111-1111-4111-8111-111111111111';
const COUNT = Number(process.argv[2] || 10000);

async function main() {
  if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 200000) throw new Error('Count must be 1..200000');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set in backend/.env');
  const client = new Client({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined });
  await client.connect();
  const batch = Date.now().toString(36);
  const started = Date.now();
  try {
    await client.query('BEGIN');
    // 1) customers: spread joins over the last 2 years, activity over the last 6 months,
    //    ~3% suspended so filters and reports have something to show.
    const customers = await client.query(
      `INSERT INTO customers (business_id, full_name, email, phone, status, status_reason, created_by, joined_at, last_activity_at)
       SELECT $1::uuid,
              (ARRAY['Mona','Omar','Sara','Youssef','Nour','Karim','Laila','Ahmed','Hana','Ziad'])[1 + (g % 10)]
                || ' ' || (ARRAY['Ali','Hassan','Mostafa','Ibrahim','Saeed','Fathy','Kamal','Nabil'])[1 + (g / 10 % 8)]
                || ' ' || g,
              'load-' || $2 || '-' || g || '@example.com',
              '+2010' || lpad(((g * 7919) % 100000000)::text, 8, '0'),
              CASE WHEN g % 33 = 0 THEN 'suspended' ELSE 'active' END,
              CASE WHEN g % 33 = 0 THEN 'Seeded suspended member' END,
              'seed-10k',
              now() - (g % 730) * interval '1 day',
              now() - (g % 180) * interval '1 day'
       FROM generate_series(1, $3::int) AS g
       RETURNING customer_id`,
      [DEMO_CAFE, batch, COUNT],
    );
    const ids = customers.rows.map((r) => r.customer_id);

    // 2) one points account per customer
    await client.query(
      `INSERT INTO points_accounts (customer_id, business_id) SELECT unnest($1::uuid[]), $2::uuid`,
      [ids, DEMO_CAFE],
    );

    // 3) 1-9 EARN rows per customer (avg ~5), 20-800 EGP (every 12th customer is a big spender, x4)
    const tx = await client.query(
      `INSERT INTO transactions (business_id, customer_id, type, points_delta, purchase_amount, tier_multiplier, created_by, created_at)
       SELECT $2::uuid, c.id, 'EARN', floor(amount)::int, amount, 1, 'seed-10k',
              now() - ((n * 13 + c.ord) % 365) * interval '1 day'
       FROM unnest($1::uuid[]) WITH ORDINALITY AS c(id, ord)
       CROSS JOIN LATERAL generate_series(1, 1 + (c.ord % 9)::int) AS n
       CROSS JOIN LATERAL (SELECT ((20 + ((c.ord * 31 + n * 97) % 780)) * CASE WHEN c.ord % 12 = 0 THEN 4 ELSE 1 END)::numeric(10,2) AS amount) a`,
      [ids, DEMO_CAFE],
    );

    // 4) balances = sum of the ledger; tiers from the last 12 months (same thresholds as tiers.js)
    await client.query(
      `UPDATE points_accounts pa SET balance = s.total, updated_at = now()
       FROM (SELECT customer_id, sum(points_delta)::int AS total FROM transactions WHERE customer_id = ANY($1::uuid[]) GROUP BY customer_id) s
       WHERE pa.customer_id = s.customer_id`,
      [ids],
    );
    await client.query(
      `UPDATE customers c SET tier = CASE WHEN s.p12 >= 5000 THEN 'GOLD' WHEN s.p12 >= 1000 THEN 'SILVER' ELSE 'BRONZE' END,
                              tier_evaluated_at = now()
       FROM (SELECT customer_id, sum(points_delta) AS p12 FROM transactions
             WHERE customer_id = ANY($1::uuid[]) AND type = 'EARN' AND created_at > now() - interval '12 months'
             GROUP BY customer_id) s
       WHERE c.customer_id = s.customer_id`,
      [ids],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE customers; ANALYZE points_accounts; ANALYZE transactions;');

    const tiers = await client.query(
      `SELECT tier, count(*)::int AS n FROM customers WHERE business_id = $1 AND created_by = 'seed-10k' GROUP BY tier ORDER BY tier`,
      [DEMO_CAFE],
    );
    console.log(`Seeded ${ids.length} customers and ${tx.rowCount} transactions in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log('Seeded customers by tier:', Object.fromEntries(tiers.rows.map((r) => [r.tier, r.n])));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Message only: never print the connection string.
  console.error('Seed failed:', err.message);
  process.exit(1);
});
