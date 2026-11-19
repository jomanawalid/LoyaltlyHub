'use strict';
// Database access for all services. Neon Postgres is the system of record.
//
// - Neon host (*.neon.tech): uses @neondatabase/serverless over HTTPS (TLS). Each query is a
//   stateless HTTP request, so thousands of concurrent Lambda instances do not exhaust
//   Postgres connections (important for the 10,000+ user target).
// - Any other host (local Docker Postgres for development/tests): uses node-postgres.
//
// ALL queries are parameterised ($1, $2 ...). Never build SQL by concatenating user input.

const { getDatabaseUrl } = require('./secrets');

let driverPromise;

async function createDriver() {
  const url = await getDatabaseUrl();
  const host = new URL(url).hostname;

  if (host.endsWith('neon.tech')) {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    return {
      kind: 'neon',
      query: (text, params = []) => sql.query(text, params),
      transaction: (statements) =>
        sql.transaction(statements.map((s) => sql.query(s.text, s.params || []))),
    };
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX || 3), // small: one Lambda instance handles one request at a time
    idleTimeoutMillis: 10000,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
  return {
    kind: 'pg',
    query: async (text, params = []) => (await pool.query(text, params)).rows,
    transaction: async (statements) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const s of statements) results.push((await client.query(s.text, s.params || [])).rows);
        await client.query('COMMIT');
        return results;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

function driver() {
  if (!driverPromise) {
    driverPromise = createDriver().catch((err) => {
      driverPromise = undefined; // allow retry on the next request
      throw err;
    });
  }
  return driverPromise;
}

/** Run one parameterised query and return the rows. */
async function query(text, params) {
  return (await driver()).query(text, params);
}

/** Return the first row or null. */
async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/** Run several statements atomically (all or nothing). Returns an array of row arrays. */
async function transaction(statements) {
  return (await driver()).transaction(statements);
}

/** Postgres error codes we turn into 409 Conflict instead of 500. */
const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
};

module.exports = { query, one, transaction, PG };
