-- 002_customers.sql  (owner: Jomana - Customer & Membership service)

CREATE TABLE IF NOT EXISTS customers (
  customer_id        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid         NOT NULL REFERENCES businesses(business_id),
  full_name          varchar(100) NOT NULL,
  email              varchar(254),                      -- NULL after erasure
  phone              varchar(20),                       -- NULL after erasure
  status             varchar(10)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'erased')),
  status_reason      varchar(200),
  tier               varchar(10)  NOT NULL DEFAULT 'BRONZE'
                     CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD')),
  tier_evaluated_at  timestamptz,
  cognito_sub        varchar(64)  UNIQUE,               -- link to the Cognito login
  created_by         varchar(64)  NOT NULL,             -- Cognito sub of the staff/owner who registered them
  joined_at          timestamptz  NOT NULL DEFAULT now(),
  last_activity_at   timestamptz,
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- Business rule: one e-mail per customer inside the same business (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_business_email
  ON customers (business_id, lower(email)) WHERE email IS NOT NULL;
-- Indexed lookups used by search, filters and the active-members report.
CREATE INDEX IF NOT EXISTS ix_customers_business_status   ON customers (business_id, status);
CREATE INDEX IF NOT EXISTS ix_customers_business_phone    ON customers (business_id, phone);
CREATE INDEX IF NOT EXISTS ix_customers_business_activity ON customers (business_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS ix_customers_name_trgm         ON customers USING gin (lower(full_name) gin_trgm_ops);

-- Audit trail for the membership status workflow (who changed what, when, why).
CREATE TABLE IF NOT EXISTS customer_status_history (
  id           bigserial    PRIMARY KEY,
  customer_id  uuid         NOT NULL REFERENCES customers(customer_id),
  business_id  uuid         NOT NULL REFERENCES businesses(business_id),
  from_status  varchar(10)  NOT NULL,
  to_status    varchar(10)  NOT NULL,
  reason       varchar(200) NOT NULL,
  changed_by   varchar(64)  NOT NULL,
  changed_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_status_history_customer ON customer_status_history (customer_id, changed_at DESC);

-- Tier changes made by the tier engine (upgrade / downgrade with the points that caused it).
CREATE TABLE IF NOT EXISTS tier_history (
  id                bigserial   PRIMARY KEY,
  customer_id       uuid        NOT NULL REFERENCES customers(customer_id),
  business_id       uuid        NOT NULL REFERENCES businesses(business_id),
  from_tier         varchar(10) NOT NULL,
  to_tier           varchar(10) NOT NULL,
  points_12_months  integer     NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tier_history_customer ON tier_history (customer_id, changed_at DESC);
