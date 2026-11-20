# Logging and monitoring (report section 11)

## What we log

Every Lambda writes one JSON object per line (`backend/shared/logger.js`) to CloudWatch Logs
(`/aws/lambda/loyalty-*`, kept 14 days).

| level | When | Example `msg` / `event` |
|---|---|---|
| INFO | every request (method, route pattern, status, latencyMs), internal calls | `HTTP_REQUEST`, `INTERNAL_CALL_OK` |
| WARN | request refused for a business reason or bad input | `REQUEST_REJECTED` (with the full validation detail) |
| SECURITY | authentication / authorisation failures | `HTTP_DENIED`, `AUTH_INVALID_TOKEN`, `AUTHZ_ROLE_DENIED`, `AUTHZ_OWNERSHIP_DENIED`, `INTERNAL_CALLER_DENIED`, `VOUCHER_CODE_MISMATCH`, and ledger corrections `TRANSACTION_VOIDED`, `POINTS_ADJUSTED` (field `event`) |
| AUDIT | every change to business data, with the actor's Cognito `sub` (field `action`) | `CUSTOMER_REGISTERED`, `CUSTOMER_STATUS_CHANGED`, `CUSTOMER_ERASED`, `TIER_CHANGED`, `POINTS_EARNED`, `EARN_RULE_UPDATED`, `REWARD_REDEEMED`, `VOUCHER_FULFILLED`, `VOUCHER_CANCELLED`, `REPORT_EXPORTED` |
| ERROR | unexpected failures, with stack trace (never sent to the user) | `UNHANDLED_ERROR`, `INTERNAL_CALL_FAILED`, `VOUCHER_EMAIL_FAILED` |

Every line has `requestId` (also returned to the user in error bodies), `service`, `userSub`,
`role`, `businessId`. **Never logged**: passwords, tokens, the `Authorization` header, connection
strings, API keys (redacted by key name and by value pattern). E-mails and phones are masked
(`m***@example.com`).

## Metric filters and alarms (`infra/scripts/07-monitoring.sh`)

| Metric (namespace LoyaltyHub) | Filter | Alarm | Threshold |
|---|---|---|---|
| DeniedRequests | `$.level = "SECURITY" && $.event = "HTTP_DENIED"` | loyalty-many-denied-requests | 10 in 5 min |
| OwnershipViolations | `$.event = "AUTHZ_OWNERSHIP_DENIED"` | loyalty-ownership-violations | 3 in 5 min |
| ServerErrors | `HTTP_5XX` or `UNHANDLED_ERROR` | loyalty-server-errors | 1 in 5 min |
| LedgerCorrections | `TRANSACTION_VOIDED` or `POINTS_ADJUSTED` | loyalty-ledger-corrections | 5 in 1 h |
| VoucherMismatches | `VOUCHER_CODE_MISMATCH` | loyalty-voucher-mismatch | 3 in 15 min |
| EmailFailures | `VOUCHER_EMAIL_FAILED` | loyalty-email-failures | 3 in 15 min |

All alarms notify the SNS topic `loyalty-alerts` (subscribe your e-mail on real AWS).
The SQS dead-letter queue `loyalty-email-dlq` holds e-mails that failed 3 times.

## Useful CloudWatch Logs Insights queries

```
# Who was refused, and why (last hour)
fields @timestamp, service, event, role, userSub, route, status
| filter level = "SECURITY"
| sort @timestamp desc

# Full detail of an error a user reported (they give us the requestId)
fields @timestamp, level, msg, err.message, err.stack
| filter requestId = "PASTE-REQUEST-ID"

# Staff who voided or adjusted the most points
fields userSub, event
| filter event in ["TRANSACTION_VOIDED", "POINTS_ADJUSTED"]
| stats count() as changes by userSub
| sort changes desc

# Slowest routes
fields route, latencyMs
| filter msg = "HTTP_REQUEST"
| stats avg(latencyMs), pct(latencyMs, 95) by route
```

On Floci, the same logs are readable with
`aws --endpoint-url http://localhost:4566 logs filter-log-events --log-group-name /aws/lambda/loyalty-points-api --filter-pattern SECURITY`.

## Evidence to capture (`evidence/`)

Screenshots of: a SECURITY line from S06, an AUDIT line from E05, a `[REDACTED]` field, the six
alarms in the Floci console, and the DLQ attributes.
