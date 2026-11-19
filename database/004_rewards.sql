-- 004_rewards.sql  (owner: Habiba - Rewards & Redemption service)

CREATE TABLE IF NOT EXISTS rewards (
  reward_id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid          NOT NULL REFERENCES businesses(business_id),
  name                    varchar(80)   NOT NULL,
  description             varchar(500)  NOT NULL DEFAULT '',
  points_cost             integer       NOT NULL CHECK (points_cost > 0 AND points_cost <= 1000000),
  stock                   integer       NOT NULL CHECK (stock >= 0),   -- can never go below zero
  max_per_customer_month  integer       NOT NULL DEFAULT 5 CHECK (max_per_customer_month BETWEEN 1 AND 100),
  status                  varchar(8)    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by              varchar(64)   NOT NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rewards_business_name ON rewards (business_id, lower(name)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_rewards_business_status ON rewards (business_id, status, points_cost);

CREATE TABLE IF NOT EXISTS redemptions (
  redemption_id   uuid         PRIMARY KEY,
  business_id     uuid         NOT NULL REFERENCES businesses(business_id),
  customer_id     uuid         NOT NULL,                -- owned by service 1
  reward_id       uuid         NOT NULL REFERENCES rewards(reward_id),
  transaction_id  uuid         NOT NULL,                -- the REDEEM ledger row in service 2
  points_spent    integer      NOT NULL CHECK (points_spent > 0),
  voucher_code    varchar(20)  NOT NULL UNIQUE,
  status          varchar(10)  NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'FULFILLED', 'CANCELLED')),
  email_status    varchar(10)  NOT NULL DEFAULT 'queued' CHECK (email_status IN ('queued', 'sent', 'failed', 'skipped')),
  created_by      varchar(64)  NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  fulfilled_by    varchar(64),
  fulfilled_at    timestamptz,
  cancel_reason   varchar(200)
);
CREATE INDEX IF NOT EXISTS ix_redemptions_customer_time ON redemptions (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_redemptions_business_time ON redemptions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_redemptions_business_status ON redemptions (business_id, status);
