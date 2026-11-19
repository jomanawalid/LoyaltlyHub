-- 001_foundation.sql  (owner: Habiba - database setup lead)
-- Shared foundation. Run as the Neon database OWNER from a team laptop only.
-- Applied by: node database/migrate.js   (reads DATABASE_URL from backend/.env)

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    varchar(100) PRIMARY KEY,
  applied_at  timestamptz  NOT NULL DEFAULT now()
);

-- pg_trgm makes "search customer by part of the name" use an index instead of a scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Every business is a tenant. Every other table carries business_id and EVERY
-- query filters by the business_id taken from the caller's verified token.
CREATE TABLE IF NOT EXISTS businesses (
  business_id  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(100) NOT NULL CHECK (length(trim(name)) > 0),
  status       varchar(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz  NOT NULL DEFAULT now()
);
