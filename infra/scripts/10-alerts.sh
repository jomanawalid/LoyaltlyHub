#!/usr/bin/env bash
# 10-alerts.sh (owner: Jana) - makes the SNS topic loyalty-alerts do real work.
# The Points service publishes alerts (void, manual adjustment, flagged staff) and the
# CloudWatch alarms publish here too. SNS fans every alert out to:
#   1) Lambda loyalty-alert-handler  -> writes one structured SECURITY log line per alert
#   2) SQS loyalty-alerts-archive    -> keeps the alerts as an audit trail
# (on real AWS the team e-mail is a third subscriber: see ALERT_EMAIL in 07-monitoring.sh)
source "$(dirname "$0")/00-env.sh"

TOPIC_ARN="${ALERT_TOPIC_ARN:?run 04-points.sh first (it creates the topic)}"
FN_ALERTS="loyalty-alert-handler"

ensure_role loyalty-alert-handler-role "$INFRA_DIR/iam/alert-handler-policy.json"
deploy_function "$FN_ALERTS" services/points/alert-handler.handler "$ROOT_DIR/backend/dist/points.zip" \
  loyalty-alert-handler-role '{"Variables":{"NODE_ENV":"production","SERVICE_NAME":"alerts"}}'
aws logs create-log-group --log-group-name "/aws/lambda/$FN_ALERTS" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "/aws/lambda/$FN_ALERTS" --retention-in-days 14

FN_ARN="$(aws lambda get-function --function-name "$FN_ALERTS" --query Configuration.FunctionArn --output text)"
aws lambda add-permission --function-name "$FN_ALERTS" --statement-id sns-invoke \
  --action lambda:InvokeFunction --principal sns.amazonaws.com --source-arn "$TOPIC_ARN" >/dev/null 2>&1 || true
aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol lambda --notification-endpoint "$FN_ARN" >/dev/null
ok "SNS loyalty-alerts -> Lambda $FN_ALERTS"

Q_URL="$(aws sqs create-queue --queue-name loyalty-alerts-archive --query QueueUrl --output text)"
Q_ARN="$(aws sqs get-queue-attributes --queue-url "$Q_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)"
QPOLICY="$(node -e 'const [arn,topic]=process.argv.slice(1);console.log(JSON.stringify({Policy:JSON.stringify({Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"sns.amazonaws.com"},Action:"sqs:SendMessage",Resource:arn,Condition:{ArnEquals:{"aws:SourceArn":topic}}}]})}))' "$Q_ARN" "$TOPIC_ARN")"
aws sqs set-queue-attributes --queue-url "$Q_URL" --attributes "$QPOLICY" >/dev/null 2>&1 || warn "could not set the audit queue policy"
aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$Q_ARN" >/dev/null
save_output ALERTS_QUEUE_URL "$Q_URL"
ok "SNS loyalty-alerts -> SQS loyalty-alerts-archive"
