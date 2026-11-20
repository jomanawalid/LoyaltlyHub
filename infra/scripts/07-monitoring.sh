#!/usr/bin/env bash
# 07-monitoring.sh (owner: Jana - logging & monitoring lead)
# CloudWatch: 14-day log retention, metric filters on our structured JSON logs,
# alarms that fire on suspicious patterns, and an SNS topic for the alerts.
source "$(dirname "$0")/00-env.sh"

NS="LoyaltyHub"
TOPIC_ARN="$(aws sns create-topic --name loyalty-alerts --query TopicArn --output text)"
save_output ALERT_TOPIC_ARN "$TOPIC_ARN"
if [ -n "${ALERT_EMAIL:-}" ]; then
  aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
fi
ok "SNS topic loyalty-alerts"

for fn in "$FN_CUSTOMERS" "$FN_POINTS" "$FN_REWARDS" "$FN_EMAIL"; do
  group="/aws/lambda/$fn"
  aws logs create-log-group --log-group-name "$group" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$group" --retention-in-days 14
done
ok "log groups kept for 14 days (cost control + privacy)"

metric_filter() {   # metric_filter log-group filter-name metric-name pattern
  aws logs put-metric-filter --log-group-name "$1" --filter-name "$2" --filter-pattern "$4" \
    --metric-transformations "metricName=$3,metricNamespace=$NS,metricValue=1,defaultValue=0"
}

for fn in "$FN_CUSTOMERS" "$FN_POINTS" "$FN_REWARDS"; do
  g="/aws/lambda/$fn"
  metric_filter "$g" "${fn}-denied"  DeniedRequests '{ $.level = "SECURITY" && $.event = "HTTP_DENIED" }'
  metric_filter "$g" "${fn}-5xx"     ServerErrors   '{ $.msg = "HTTP_5XX" || $.msg = "UNHANDLED_ERROR" }'
  metric_filter "$g" "${fn}-ownership" OwnershipViolations '{ $.event = "AUTHZ_OWNERSHIP_DENIED" }'
done
metric_filter "/aws/lambda/$FN_POINTS"  points-ledger-corrections LedgerCorrections \
  '{ $.event = "TRANSACTION_VOIDED" || $.event = "POINTS_ADJUSTED" }'
metric_filter "/aws/lambda/$FN_REWARDS" rewards-voucher-mismatch VoucherMismatches '{ $.event = "VOUCHER_CODE_MISMATCH" }'
metric_filter "/aws/lambda/$FN_EMAIL"   email-failures EmailFailures '{ $.msg = "VOUCHER_EMAIL_FAILED" }'
ok "metric filters in namespace $NS"

alarm() {   # alarm name metric threshold period-seconds description
  aws cloudwatch put-metric-alarm --alarm-name "$1" --namespace "$NS" --metric-name "$2" \
    --statistic Sum --period "$4" --evaluation-periods 1 --threshold "$3" \
    --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching \
    --alarm-description "$5" --alarm-actions "$TOPIC_ARN"
}
alarm loyalty-many-denied-requests DeniedRequests 10 300 "10+ requests rejected with 401/403 in 5 minutes: token guessing or role probing"
alarm loyalty-ownership-violations OwnershipViolations 3 300 "Customers trying to read other customers' data"
alarm loyalty-server-errors ServerErrors 1 300 "Any 5xx error"
alarm loyalty-ledger-corrections LedgerCorrections 5 3600 "5+ voids/adjustments in an hour: possible staff abuse"
alarm loyalty-voucher-mismatch VoucherMismatches 3 900 "Wrong voucher codes tried at the counter"
alarm loyalty-email-failures EmailFailures 3 900 "Brevo e-mails failing"
ok "alarms -> SNS loyalty-alerts"
