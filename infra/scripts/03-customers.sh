#!/usr/bin/env bash
# 03-customers.sh (owner: Jomana) - Customers & Membership Lambda + its least-privilege role.
# AWS services used by this component: Lambda, Cognito, Secrets Manager, CloudWatch Logs
# (and lambda:Invoke to call Points and Rewards).
source "$(dirname "$0")/00-env.sh"
: "${COGNITO_USER_POOL_ID:?run 02-cognito.sh first}"

ensure_role loyalty-customers-role "$INFRA_DIR/iam/customers-policy.json"

ENV_JSON=$(cat <<JSON
{"Variables":{
  "NODE_ENV":"production","SERVICE_NAME":"customers",
  "CORS_ORIGINS":"$FRONTEND_ORIGIN",
  "COGNITO_USER_POOL_ID":"$COGNITO_USER_POOL_ID","COGNITO_CLIENT_ID":"$COGNITO_CLIENT_ID","COGNITO_ISSUER":"$COGNITO_ISSUER",
  "DB_SECRET_ID":"loyalty/customers/database-url",
  "CUSTOMER_INVITE_MODE":"$( [ "$TARGET" = aws ] && echo email || echo handover )",
  "POINTS_FUNCTION":"$FN_POINTS","REWARDS_FUNCTION":"$FN_REWARDS"
}}
JSON
)
deploy_function "$FN_CUSTOMERS" services/customers/lambda.handler "$ROOT_DIR/backend/dist/customers.zip" \
  loyalty-customers-role "$ENV_JSON"
