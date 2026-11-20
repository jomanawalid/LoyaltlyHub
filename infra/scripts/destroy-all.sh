#!/usr/bin/env bash
# destroy-all.sh (owner: Jana) - delete every resource after the demo (cost control).
# Neon data is NOT touched. Secrets are deleted without recovery only on Floci.
source "$(dirname "$0")/00-env.sh"
set +e
read -r -p "Delete ALL LoyaltyHub resources in $TARGET? Type yes: " answer
[ "$answer" = "yes" ] || { echo "Cancelled."; exit 0; }

[ -n "${API_ID:-}" ] && aws apigatewayv2 delete-api --api-id "$API_ID"
for m in $(aws lambda list-event-source-mappings --function-name "$FN_EMAIL" --query 'EventSourceMappings[].UUID' --output text); do
  aws lambda delete-event-source-mapping --uuid "$m" >/dev/null
done
for fn in "$FN_CUSTOMERS" "$FN_POINTS" "$FN_REWARDS" "$FN_EMAIL"; do aws lambda delete-function --function-name "$fn"; done
for role in loyalty-customers-role loyalty-points-role loyalty-rewards-role loyalty-email-worker-role; do
  aws iam delete-role-policy --role-name "$role" --policy-name "${role}-policy"
  aws iam delete-role --role-name "$role"
done
aws dynamodb delete-table --table-name "$IDEMPOTENCY_TABLE" >/dev/null
for q in "$EMAIL_QUEUE" "$EMAIL_DLQ"; do
  url="$(aws sqs get-queue-url --queue-name "$q" --query QueueUrl --output text)" && aws sqs delete-queue --queue-url "$url"
done
aws s3 rb "s3://$WEB_BUCKET" --force
aws s3 rb "s3://$REPORTS_BUCKET" --force
FORCE=$( [ "$TARGET" = floci ] && echo "--force-delete-without-recovery" || echo "--recovery-window-in-days 7" )
for s in loyalty/customers/database-url loyalty/points/database-url loyalty/rewards/database-url loyalty/brevo-api-key; do
  aws secretsmanager delete-secret --secret-id "$s" $FORCE >/dev/null
done
[ -n "${COGNITO_USER_POOL_ID:-}" ] && aws cognito-idp delete-user-pool --user-pool-id "$COGNITO_USER_POOL_ID"
aws cloudwatch delete-alarms --alarm-names loyalty-many-denied-requests loyalty-ownership-violations \
  loyalty-server-errors loyalty-ledger-corrections loyalty-voucher-mismatch loyalty-email-failures
[ -n "${ALERT_TOPIC_ARN:-}" ] && aws sns delete-topic --topic-arn "$ALERT_TOPIC_ARN"
: > "$OUTPUTS_FILE"
echo "Done. Re-create everything with: bash infra/scripts/deploy-all.sh"
