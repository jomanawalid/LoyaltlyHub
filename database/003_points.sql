-- 003_points.sql  (owner: Jana - Points & Transactions service)

-- Earn rule per business: how many points per 1 EGP, the largest purchase staff may
-- enter, and a daily cap per customer (limits staff fraud / typing mistakes).
CREATE TABLE IF NOT EXISTS earn_rules (
  business_id         uuid          PRIMARY KEY REFERENCES businesses(business_id),
  points_per_unit     numeric(6,2)  NOT NULL DEFAULT 1    CHECK (points_per_unit > 0 AND points_per_unit <= 100),
  max_purchase        numeric(10,2) NOT NULL DEFAULT 10000 CHECK (max_purchase > 0 AND max_purchase <= 1000000),
  daily_points_cap    integer       NOT NULL DEFAULT 5000 CHECK (daily_points_cap > 0),
  updated_by          varchar(64)   NOT NULL DEFAULT 'system',
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- One balance per customer. The CHECK makes a negative balance impossible even
-- if two redemptions race each other.
CREATE TABLE IF NOT EXISTS points_accounts (
  customer_id  uuid        PRIMARY KEY,               -- same id as customers.customer_id (owned by service 1)
  business_id  uuid        NOT NULL REFERENCES businesses(business_id),
  balance      integer     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status       varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_points_accounts_business ON points_accounts (business_id);

-- The ledger. Append-only: rows are never updated or deleted (trigger below +
-- the points DB role has no UPDATE/DELETE grant on it).
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid          NOT NULL REFERENCES businesses(business_id),
  customer_id           uuid          NOT NULL REFERENCES points_accounts(customer_id),
  type                  varchar(8)    NOT NULL CHECK (type IN ('EARN', 'ADJUST', 'VOID', 'REDEEM', 'REFUND', 'CLOSE')),
  points_delta          integer       NOT NULL CHECK (points_delta <> 0 OR type = 'CLOSE'),
  purchase_amount       numeric(10,2) CHECK (purchase_amount IS NULL OR purchase_amount > 0),
  tier_multiplier       numeric(4,2),
  reason                varchar(200),
  reference_id          uuid,                          -- redemption id for REDEEM / REFUND
  idempotency_key       uuid,
  voids_transaction_id  uuid          REFERENCES transactions(transaction_id),
  created_by            varchar(64)   NOT NULL,
  created_at            timestamptz   NOT NULL DEFAULT now()
);
-- Same request twice -> stored once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_idempotency ON transactions (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- A transaction can be voided at most once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_voids ON transactions (voids_transaction_id) WHERE voids_transaction_id IS NOT NULL;
-- A redemption can be debited once and refunded once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_reference ON transactions (reference_id, type) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tx_customer_time ON transactions (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tx_business_time ON transactions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tx_business_creator ON transactions (business_id, created_by, created_at DESC);

CREATE OR REPLACE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions ledger is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_append_only ON transactions;
CREATE TRIGGER trg_ledger_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
