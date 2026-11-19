-- 005_app_role_grants.sql  (owner: Jana - least privilege for the database)
--
-- Each Lambda connects with ITS OWN Postgres role, so a bug or a stolen connection
-- string in one service cannot touch another service's tables or change the schema.
--
-- 1. Create the three roles in the Neon Console (Roles -> New role). Neon generates
--    the passwords; they never appear in this repository:
--      loyalty_customers_svc, loyalty_points_svc, loyalty_rewards_svc
-- 2. Run this file as the database owner: node database/migrate.js
--    (it is skipped automatically if the roles do not exist yet, e.g. local Docker).
-- 3. Put each role's connection string in its own Secrets Manager secret
--    (infra/scripts/01-foundation.sh does this from your local .env).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty_customers_svc') THEN
    RAISE NOTICE 'Service roles not found: skipping grants (create them in the Neon Console first)';
    RETURN;
  END IF;

  -- Nobody but the owner may create or change tables.
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM loyalty_customers_svc, loyalty_points_svc, loyalty_rewards_svc';

  -- Service 1: Customers & Membership
  EXECUTE 'GRANT SELECT ON businesses TO loyalty_customers_svc';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON customers TO loyalty_customers_svc';
  EXECUTE 'GRANT SELECT, INSERT ON customer_status_history, tier_history TO loyalty_customers_svc';
  EXECUTE 'GRANT USAGE ON SEQUENCE customer_status_history_id_seq, tier_history_id_seq TO loyalty_customers_svc';

  -- Service 2: Points & Transactions (ledger: SELECT + INSERT only, never UPDATE/DELETE)
  EXECUTE 'GRANT SELECT ON businesses TO loyalty_points_svc';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON earn_rules, points_accounts TO loyalty_points_svc';
  EXECUTE 'GRANT SELECT, INSERT ON transactions TO loyalty_points_svc';

  -- Service 3: Rewards & Redemption (+ the e-mail worker, which only updates email_status)
  EXECUTE 'GRANT SELECT ON businesses TO loyalty_rewards_svc';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON rewards, redemptions TO loyalty_rewards_svc';
END
$$;
