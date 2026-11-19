# Design decisions and changes from the proposal (report section 3 / 16)

## Changes made because of the TA and lecturer feedback

| Feedback | What we changed |
|---|---|
| "Customer & Membership is CRUD plus a report. Give it a real function." | Jomana's service now owns the **membership tier engine** (Bronze/Silver/Gold from the last 12 months of points; upgrades at once, downgrades one level after a 30-day grace period; the tier multiplier changes how many points Points gives), the **membership status workflow** (suspend/reactivate with reasons and history, which also disables/enables the Cognito login and blocks earning and redeeming), **engagement segments** (active / at risk / lapsed) and a **GDPR-style erasure workflow** that coordinates with Points and Rewards. |
| "Get the shared setup (SAM, Cognito, Neon) done early." | Habiba's first bulk of work is the whole shared foundation (shared backend modules, database foundation, Secrets/S3 scripts, frontend shell), so Jomana and Jana build on a working base. We used CLI scripts instead of SAM (see below). |
| Floci, at least 4 integrated AWS services that talk to each other | 9 AWS services: API Gateway, Lambda (4 functions), Cognito, Secrets Manager, DynamoDB, SQS (+DLQ), S3 (2 buckets), CloudWatch (logs, metrics, alarms), SNS. The services call each other with `lambda:Invoke`, plus SQS for e-mails. Each student uses at least 3 in their own component (`architecture.md`). |
| Neon database | Neon Postgres, TLS, one Postgres role per service. |
| About 10,000 users | Indexes, pagination, serverless driver, `seed-10k.js` and a load test. |
| More than one IAM policy | Five Lambda policies (one per function) plus the public-read website bucket policy, each limited to exact resources. |
| CORS is not a security feature | CORS only allows our frontend origin, and we say clearly it is not a control; authentication, roles and ownership checks in the backend are (S01-S08, S17). |
| S3 bucket is public, so only frontend files | The website bucket gets an allow-list of files from `frontend/` only; reports go to a separate private bucket; zips refuse `.env`; `check-deployment.sh` and S18 verify `.env`, `backend/` and `*.zip` are not in the bucket. |
| No passwords in plaintext anywhere | Cognito stores passwords; demo password only in a shell variable; DB and Brevo secrets in Secrets Manager; logger redacts them; gitleaks in CI. |
| Full errors logged on our side, generic errors to users ("Bad request") | `shared/errors.js` + `shared/logger.js`; users get `{code, message: "Bad request", requestId}`. |

## Other decisions

| Decision | Why |
|---|---|
| Express 5 inside Lambda with `serverless-http` | Same pattern as Lab 7; one codebase runs locally (`npm run dev`) and on Lambda. |
| AWS CLI scripts instead of SAM | They run unchanged on Floci, every resource is visible, and each person owns their scripts. Idempotent, so re-running is safe. |
| Our own small JWT verifier (`shared/jwt.js`) | The usual library only fetches keys over HTTPS, but Floci serves the Cognito keys over HTTP. Ours uses Node's crypto and checks the same claims. |
| Lambda-to-Lambda calls instead of HTTP between services | Calls stay inside AWS, are authorised by IAM, and cannot be reached from the internet. |
| One database, one role per service | Neon free plan; the roles still stop a service from touching another service's tables. |
| Idempotency in DynamoDB **and** a unique DB index | DynamoDB answers fast replays with the stored result; the unique index is the final guarantee. |
| Redemption as a saga with compensation | Points live in another service, so there is no shared transaction; every failure path refunds points and stock. |
| SQS for e-mails | Redeeming does not wait for Brevo; failures retry and end in a DLQ. |
| Masked voucher codes for staff | Staff can only fulfil when the customer shows the real code, so a staff member cannot redeem a customer's voucher themselves. |
| Plain HTML/CSS/JS frontend | Allowed by the brief, no build step, strict CSP possible. |
