#!/usr/bin/env bash
# 04-points.sh (owner: Jana) - Points & Transactions Lambda, DynamoDB idempotency table, role.
# AWS services used by this component: Lambda, DynamoDB, Secrets Manager, CloudWatch
# (Logs + metric filters/alarms in 07-monitoring.sh), lambda:Invoke to call Customers.
source "$(dirname "$0")/00-env.sh"

log "DynamoDB table $IDEMPOTENCY_TABLE (on-demand, items expire after 24 h)"
if ! aws dynamodb describe-table --table-name "$IDEMPOTENCY_TABLE" >/dev/null 2>&1; then
  aws dynamodb create-table --table-name "$IDEMPOTENCY_TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --sse-specification Enabled=true >/dev/null
  aws dynamodb wait table-exists --table-name "$IDEMPOTENCY_TABLE"
fi
aws dynamodb update-time-to-live --table-name "$IDEMPOTENCY_TABLE" \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null 2>&1 || true
ok "table $IDEMPOTENCY_TABLE"

ensure_role loyalty-points-role "$INFRA_DIR/iam/points-policy.json"

ENV_JSON=$(cat <<JSON
{"Variables":{
  "NODE_ENV":"production","SERVICE_NAME":"points",
  "CORS_ORIGINS":"$FRONTEND_ORIGIN",
  "COGNITO_USER_POOL_ID":"$COGNITO_USER_POOL_ID","COGNITO_CLIENT_ID":"$COGNITO_CLIENT_ID","COGNITO_ISSUER":"$COGNITO_ISSUER",
  "DB_SECRET_ID":"loyalty/points/database-url",
  "IDEMPOTENCY_TABLE":"$IDEMPOTENCY_TABLE",
  "CUSTOMERS_FUNCTION":"$FN_CUSTOMERS"
}}
JSON
)
deploy_function "$FN_POINTS" services/points/lambda.handler "$ROOT_DIR/backend/dist/points.zip" \
  loyalty-points-role "$ENV_JSON"
