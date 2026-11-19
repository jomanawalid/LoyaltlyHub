#!/usr/bin/env bash
# 00-env.sh (owner: Habiba) - shared settings for every deploy script.
# Usage: source infra/scripts/00-env.sh      (the other scripts do this for you)
#
# TARGET=floci (default) deploys to Floci on http://localhost:4566 like Lab 7.
# TARGET=aws   deploys to a real AWS account (your own credentials, NEVER committed).

set -euo pipefail
export MSYS_NO_PATHCONV=1           # Git Bash on Windows: do not rewrite /api/... paths

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"
OUTPUTS_FILE="$INFRA_DIR/.deploy-outputs.env"   # git-ignored: ids/urls created by the scripts

export TARGET="${TARGET:-floci}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

if [ "$TARGET" = "floci" ]; then
  export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"         # Floci accepts any value
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
fi

# Always pass the endpoint explicitly (older AWS CLI versions ignore AWS_ENDPOINT_URL for some services).
aws() {
  if [ -n "${AWS_ENDPOINT_URL:-}" ]; then command aws --endpoint-url "$AWS_ENDPOINT_URL" "$@"; else command aws "$@"; fi
}

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ACCOUNT_ID

# ---- names (one place, used by every script and by the IAM policy templates) ----
export PREFIX="loyalty"
export FN_CUSTOMERS="loyalty-customers-api"
export FN_POINTS="loyalty-points-api"
export FN_REWARDS="loyalty-rewards-api"
export FN_EMAIL="loyalty-email-worker"
export IDEMPOTENCY_TABLE="LoyaltyIdempotency"
export EMAIL_QUEUE="loyalty-email-queue"
export EMAIL_DLQ="loyalty-email-dlq"
export API_NAME="loyalty-http-api"
export LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-nodejs22.x}"   # the runtime we tested on Floci
SUFFIX="${BUCKET_SUFFIX:-}"            # real AWS: bucket names are global, add e.g. your group number
export WEB_BUCKET="loyalty-web${SUFFIX:+-$SUFFIX}"
export REPORTS_BUCKET="loyalty-reports-private${SUFFIX:+-$SUFFIX}"

if [ "$TARGET" = "floci" ]; then
  export FRONTEND_ORIGIN="http://localhost:4566"
  export PUBLIC_ENDPOINT="http://localhost:4566"
else
  export FRONTEND_ORIGIN="http://${WEB_BUCKET}.s3-website-${AWS_REGION}.amazonaws.com"
  export PUBLIC_ENDPOINT=""
fi

# ---- helpers ----
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m OK\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*"; }

save_output() {   # save_output KEY VALUE  -> infra/.deploy-outputs.env
  touch "$OUTPUTS_FILE"
  grep -v "^$1=" "$OUTPUTS_FILE" > "$OUTPUTS_FILE.tmp" || true
  echo "$1=$2" >> "$OUTPUTS_FILE.tmp"
  mv "$OUTPUTS_FILE.tmp" "$OUTPUTS_FILE"
}
load_outputs() { if [ -f "$OUTPUTS_FILE" ]; then set -a; . "$OUTPUTS_FILE"; set +a; fi; }

# Fill the placeholders in an IAM policy template and print the path of the result.
render_policy() {   # render_policy infra/iam/x-policy.json
  local out
  out="$(mktemp)"
  sed -e "s/__REGION__/$AWS_REGION/g" -e "s/__ACCOUNT__/$ACCOUNT_ID/g" \
      -e "s/__POOL_ID__/${COGNITO_USER_POOL_ID:-none}/g" -e "s/__WEB_BUCKET__/$WEB_BUCKET/g" \
      -e "s/__REPORTS_BUCKET__/$REPORTS_BUCKET/g" "$1" > "$out"
  echo "$out"
}

# Create (or update) a Lambda execution role with ONE least-privilege inline policy.
ensure_role() {   # ensure_role role-name policy-template.json
  local role="$1" policy_file
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws iam create-role --role-name "$role" \
      --assume-role-policy-document "file://$INFRA_DIR/iam/trust-lambda.json" >/dev/null
  fi
  policy_file="$(render_policy "$2")"
  aws iam put-role-policy --role-name "$role" --policy-name "${role}-policy" \
    --policy-document "file://$policy_file" >/dev/null
  rm -f "$policy_file"
  ok "IAM role $role with policy $(basename "$2")"
}

# Create or update a Lambda function from backend/dist/<zip>.
deploy_function() {   # deploy_function name handler zip role env-json
  local name="$1" handler="$2" zip="$3" role="$4" env="$5"
  local role_arn="arn:aws:iam::${ACCOUNT_ID}:role/${role}"
  if aws lambda get-function --function-name "$name" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$name" --zip-file "fileb://$zip" >/dev/null
    aws lambda wait function-updated --function-name "$name" 2>/dev/null || sleep 3
    aws lambda update-function-configuration --function-name "$name" --handler "$handler" \
      --role "$role_arn" --timeout 15 --memory-size 512 --environment "$env" >/dev/null
  else
    aws lambda create-function --function-name "$name" --runtime "$LAMBDA_RUNTIME" \
      --handler "$handler" --role "$role_arn" --zip-file "fileb://$zip" \
      --timeout 15 --memory-size 512 --environment "$env" >/dev/null
  fi
  aws lambda wait function-active --function-name "$name" 2>/dev/null || sleep 3
  ok "Lambda $name ($handler)"
}

load_outputs
