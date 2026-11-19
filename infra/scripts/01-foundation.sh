#!/usr/bin/env bash
# 01-foundation.sh (owner: Habiba) - Secrets Manager secrets + the PRIVATE reports bucket.
#
# Secrets are read from backend/.env on YOUR laptop and written straight into Secrets
# Manager. They never appear in the repository, in Lambda environment variables or in logs.
#   CUSTOMERS_DATABASE_URL / POINTS_DATABASE_URL / REWARDS_DATABASE_URL  (one Neon role each)
#   (falls back to DATABASE_URL for all three if the per-service ones are not set)
#   BREVO_API_KEY  (empty -> "disabled": e-mails are skipped, redemptions still work)
source "$(dirname "$0")/00-env.sh"

ENV_FILE="$ROOT_DIR/backend/.env"
[ -f "$ENV_FILE" ] || { warn "backend/.env not found: copy backend/.env.example first"; exit 1; }
env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

put_secret() {   # put_secret name value   (value passed through a private temp file, not argv)
  local name="$1" tmp
  tmp="$(mktemp)"; chmod 600 "$tmp"
  printf '%s' "$2" > "$tmp"
  if aws secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "file://$tmp" >/dev/null
  else
    aws secretsmanager create-secret --name "$name" --secret-string "file://$tmp" \
      --description "LoyaltyHub $name (managed by infra/scripts/01-foundation.sh)" >/dev/null
  fi
  rm -f "$tmp"
  ok "secret $name stored (value not printed)"
}

log "Secrets Manager"
DEFAULT_DB="$(env_value DATABASE_URL)"
[ -n "$DEFAULT_DB" ] || { warn "DATABASE_URL missing in backend/.env"; exit 1; }
for svc in customers points rewards; do
  upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]')"
  value="$(env_value "${upper}_DATABASE_URL")"
  put_secret "loyalty/$svc/database-url" "${value:-$DEFAULT_DB}"
done
BREVO="$(env_value BREVO_API_KEY)"
put_secret "loyalty/brevo-api-key" "${BREVO:-disabled}"

log "Private S3 bucket for CSV reports: $REPORTS_BUCKET"
aws s3api head-bucket --bucket "$REPORTS_BUCKET" 2>/dev/null || aws s3api create-bucket --bucket "$REPORTS_BUCKET" >/dev/null
aws s3api put-public-access-block --bucket "$REPORTS_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$REPORTS_BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$REPORTS_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-reports","Status":"Enabled","Filter":{"Prefix":"reports/"},"Expiration":{"Days":7}}]}' >/dev/null \
  || warn "lifecycle rule not supported here (fine on Floci)"
save_output REPORTS_BUCKET "$REPORTS_BUCKET"
ok "reports bucket is private, encrypted, reports expire after 7 days"
