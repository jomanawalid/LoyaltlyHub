#!/usr/bin/env node
'use strict';
// Applies database/*.sql in order (001, 002, ...) and records each one in
// schema_migrations so it is never applied twice. With --seed, also runs seed.sql.
//
// Usage (from backend/):  npm run db:migrate     or     npm run db:seed
// Needs DATABASE_URL (the Neon OWNER connection string) in backend/.env.
// Run it from a team laptop only; Lambdas never have schema permissions.

const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
  quiet: true,
});

const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
const { Client } = require(path.join(backendModules, 'pg'));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set in backend/.env');
    process.exit(1);
  }
  const client = new Client({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '001_foundation.sql'), 'utf8'));
    const files = fs.readdirSync(__dirname).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (done.rowCount && !file.startsWith('005_')) continue; // grants are re-applied every time
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO UPDATE SET applied_at = now()',
        [file],
      );
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    }
    if (process.argv.includes('--seed')) {
      await client.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
      console.log('applied seed.sql');
    }
    console.log('Database is up to date.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message); // message only: never print the connection string
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
