# Sample Lambda events

Use these to invoke a function directly on Floci (or AWS) without the browser, e.g.

```bash
aws --endpoint-url http://localhost:4566 lambda invoke \
  --function-name loyalty-points-api \
  --cli-binary-format raw-in-base64-out \
  --payload file://backend/events/points/internal-debitPoints.json out.json && cat out.json
```

`--cli-binary-format raw-in-base64-out` is for AWS CLI v2; leave it out on CLI v1.

- `*/<route>.json` - API Gateway HTTP API (payload v2.0) events. Replace `<ID_TOKEN_FROM_COGNITO>`
  with a real ID token, otherwise the answer is `401 Unauthorized` (which is itself a useful test).
- `*/internal-*.json` - service-to-service events (`source: loyalty.internal`). Only the Lambda
  roles in `infra/iam/` may invoke these functions, and each action also checks `caller`.
  `customers/internal-denied-caller.json` shows that check: `points` may not read contact details,
  so the answer is `{ ok: false, error: { status: 403 } }` and a SECURITY log line.
- `rewards/sqs-voucher-email.json` - the SQS batch the e-mail worker (`loyalty-email-worker`) receives.

Owners: customers/ Jomana, points/ Jana, rewards/ Habiba. The ids are placeholders, not real data.
