#!/usr/bin/env bash
# 05-rewards.sh (owner: Habiba) - Rewards & Redemption Lambda, e-mail worker Lambda,
# SQS queue + dead-letter queue, and the event source mapping between them.
# AWS services used by this component: Lambda, SQS, S3 (private reports), Secrets Manager
# (DB + Brevo key), CloudWatch Logs, lambda:Invoke to Customers and Points.
source "$(dirname "$0")/00-env.sh"

log "SQS queues"
DLQ_URL="$(aws sqs create-queue --queue-name "$EMAIL_DLQ" --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text)"
DLQ_ARN="arn:aws:sqs:${AWS_REGION}:${ACCOUNT_ID}:${EMAIL_DLQ}"
QUEUE_URL="$(aws sqs create-queue --queue-name "$EMAIL_QUEUE" --query QueueUrl --output text)"
ATTRS="$(mktemp)"
cat > "$ATTRS" <<JSON
{"VisibilityTimeout":"60","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"$DLQ_ARN\\",\\"maxReceiveCount\\":\\"3\\"}"}
JSON
aws sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes "file://$ATTRS"
rm -f "$ATTRS"
save_output EMAIL_QUEUE_URL "$QUEUE_URL"
ok "queue $EMAIL_QUEUE -> DLQ $EMAIL_DLQ after 3 failed attempts"

ensure_role loyalty-rewards-role "$INFRA_DIR/iam/rewards-policy.json"
ensure_role loyalty-email-worker-role "$INFRA_DIR/iam/notifier-policy.json"

COMMON="\"NODE_ENV\":\"production\",\"CORS_ORIGINS\":\"$FRONTEND_ORIGIN\",\"COGNITO_USER_POOL_ID\":\"$COGNITO_USER_POOL_ID\",\"COGNITO_CLIENT_ID\":\"$COGNITO_CLIENT_ID\",\"COGNITO_ISSUER\":\"$COGNITO_ISSUER\",\"DB_SECRET_ID\":\"loyalty/rewards/database-url\",\"CUSTOMERS_FUNCTION\":\"$FN_CUSTOMERS\",\"POINTS_FUNCTION\":\"$FN_POINTS\""

deploy_function "$FN_REWARDS" services/rewards/lambda.handler "$ROOT_DIR/backend/dist/rewards.zip" \
  loyalty-rewards-role "{\"Variables\":{$COMMON,\"SERVICE_NAME\":\"rewards\",\"EMAIL_QUEUE_URL\":\"$QUEUE_URL\",\"REPORTS_BUCKET\":\"$REPORTS_BUCKET\",\"REPORTS_PUBLIC_ENDPOINT\":\"$PUBLIC_ENDPOINT\"}}"

deploy_function "$FN_EMAIL" services/rewards/notifier.handler "$ROOT_DIR/backend/dist/rewards.zip" \
  loyalty-email-worker-role "{\"Variables\":{$COMMON,\"SERVICE_NAME\":\"rewards-notifier\",\"BREVO_SECRET_ID\":\"loyalty/brevo-api-key\",\"EMAIL_SENDER\":\"${EMAIL_SENDER:-no-reply@loyaltyhub.example}\"}}"

log "SQS -> e-mail worker trigger"
QUEUE_ARN="arn:aws:sqs:${AWS_REGION}:${ACCOUNT_ID}:${EMAIL_QUEUE}"
if [ -z "$(aws lambda list-event-source-mappings --function-name "$FN_EMAIL" --event-source-arn "$QUEUE_ARN" --query 'EventSourceMappings[0].UUID' --output text | grep -v None)" ]; then
  aws lambda create-event-source-mapping --function-name "$FN_EMAIL" --event-source-arn "$QUEUE_ARN" \
    --batch-size 5 --function-response-types ReportBatchItemFailures >/dev/null
fi
ok "event source mapping $EMAIL_QUEUE -> $FN_EMAIL"
