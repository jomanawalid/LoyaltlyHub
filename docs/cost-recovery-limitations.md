# Cost, backup/recovery and limitations (report sections 13-15)

## Cost (estimate for one business with 10,000 members on real AWS, per month)

Assumption: 2,000 API requests per day (earns, lookups, redemptions), 300 voucher e-mails.

| Service | Usage | Cost |
|---|---|---|
| Lambda | ~60,000 invocations, 512 MB, ~100 ms | free tier (1M requests) |
| API Gateway HTTP API | ~60,000 requests | ~$0.06 |
| Cognito | < 10,000 monthly active users | free tier (Essentials up to 10,000 MAU) |
| DynamoDB on-demand | ~15,000 writes, TTL deletes free | < $0.05 |
| SQS | ~10,000 requests | free tier |
| S3 | a few MB website + reports | < $0.05 |
| Secrets Manager | 4 secrets | ~$1.60 ($0.40 each) - the biggest line item |
| CloudWatch | logs < 1 GB with 14-day retention, 6 alarms | ~$0.60 |
| Neon | free plan (0.5 GB storage) | $0 |
| Brevo | free plan (300 e-mails/day) | $0 |

Roughly **$2-3 per month**. On Floci everything is free. Cost controls: 14-day log retention,
TTL on idempotency records, on-demand capacity, `destroy-all.sh` after demos, pagination limits.

## Backup and recovery

- **Neon**: point-in-time restore (history retention on the free plan) and branches: before a
  risky migration, create a branch, test on it, then apply to main.
- **Ledger** is append-only, so balances can always be rebuilt from `transactions`
  (`SELECT customer_id, sum(points_delta) ... GROUP BY customer_id`).
- **Infrastructure** is fully re-creatable from the scripts (`deploy-all.sh`), secrets from the
  team's local `.env` files.
- **E-mails**: failed messages wait in the DLQ for 14 days and can be redriven.
- **Redemption saga**: if the debit, the voucher insert or the queue fails, points and stock are
  given back automatically; a cancelled voucher refunds both.

## Limitations and what we would do next

| Limitation | Next step |
|---|---|
| Floci cold starts make p99 latency very long under load (see load test) | provisioned concurrency for Points on real AWS |
| One shared Neon database (separate roles, not separate databases) | one Neon project or schema per service if the team grows |
| Temporary customer password is shown once to staff (handover mode) | `CUSTOMER_INVITE_MODE=email` makes Cognito e-mail it instead (needs SES on real AWS) |
| No MFA for owners | enable Cognito TOTP MFA for the `Owner` group |
| The frontend keeps the ID token in `sessionStorage` (XSS would expose it; CSP reduces the risk) | Cognito Hosted UI + HttpOnly cookie through a backend-for-frontend |
| Alarms go to SNS but nobody is subscribed on Floci | subscribe the team e-mail on real AWS |
| No WAF in front of API Gateway | AWS WAF managed rules (cost ~$5+/month) |
| Website bucket served over HTTP on Floci | CloudFront with HTTPS and Origin Access Control on real AWS |
