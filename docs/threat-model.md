# Threat model (report section 7)

Assets: customer personal data (name, e-mail, phone), points balances (they are money for the
business), voucher codes, staff/owner accounts, database and Brevo credentials.

Actors: anonymous internet user; signed-in customer trying to get more than they own; dishonest
staff member; owner of another business on the same system; someone who finds a leaked file.

| # | Threat (STRIDE) | Where | Control in our code | Evidence |
|---|---|---|---|---|
| T1 | **Spoofing**: forged or tampered JWT (e.g. change group to Owner, `alg: none`) | every route | `shared/jwt.js` verifies RS256 signature against the Cognito JWKS, issuer, audience/client, `token_use=id`, expiry; only RS256 accepted | S02, S03, unit `jwt.test.js` |
| T2 | **Elevation of privilege**: customer or staff calls owner actions (void, adjust, earn rate, erase, reports) | owner routes | `requireRole` on every route, from Cognito groups in the verified token; frontend hiding buttons is not relied on | S04, S05, unit `*-api.test.js` |
| T3 | **Information disclosure (IDOR)**: customer changes the id in the URL/body to see or spend someone else's points | customers/:id, balance, redemptions | `assertCustomerAccess`: a customer's own `custom:customer_id` must match; tenant filter `business_id` on every query | S06, S07, S08 |
| T4 | **Tampering**: injection (SQL, script tags, CSV formulas), mass assignment (`"balance": 99999`) | all inputs, CSV export | Parameterised SQL only; ajv schemas with `additionalProperties:false`, length limits and safe-text pattern; CSV cells starting with `= + - @` are neutralised; HTML escaped in e-mails; CSP in the frontend | S10, S11, unit tests |
| T5 | **Tampering / race**: double redemption or double earn (double click, parallel requests, network retry) | redeem, earn | Atomic conditional SQL (`balance >= cost`, `stock > 0`) + `CHECK (balance >= 0)`; Idempotency-Key in DynamoDB + unique index; saga refunds on failure | S12, S13, S14, E06, E10 |
| T6 | **Information disclosure**: secrets or passwords in code, git, logs, or the public bucket | repo, logs, S3 | Secrets in Secrets Manager (one per service); `.env` git-ignored; gitleaks in CI over full history; logger redacts passwords/tokens/connection strings and masks e-mails; public bucket gets an allow-list of frontend files only; zips refuse `.env` | S18, CI, unit `logging-errors.test.js` |
| T7 | **Information disclosure**: detailed errors (stack, SQL) sent to users | every error | `errors.toClientBody` returns only `code`, generic `message`, `requestId`; details logged on our side | S15, unit test |
| T8 | **Elevation of privilege between services**: a compromised Lambda reads other tables or calls actions it should not | Lambdas, Neon | One IAM policy per Lambda (own secret, own queue/table/bucket, only the functions it needs); `allowedCallers` per internal action; one Postgres role per service with table-level grants; ledger has no UPDATE/DELETE | `infra/iam/*`, `005_app_role_grants.sql`, `events/customers/internal-denied-caller.json` |
| T9 | **Denial of service**: flood of requests or huge bodies | API | API Gateway throttling (100 rps, burst 200); 10 kB body limit; pagination max 100; Lambda timeout 15 s | S15/413 unit test, load test |
| T10 | **Repudiation / fraud by staff**: fake purchases for friends, voiding, wrong voucher codes | points, vouchers | Every change is an AUDIT log line with the staff `sub`; append-only ledger; voids/adjustments owner-only with reasons; staff-activity flags; voucher must match the code the customer shows; staff see masked codes; CloudWatch alarms | S16, `GET /api/reports/staff-activity`, alarms |
| T11 | **Information disclosure**: report files in S3 readable by anyone | reports | Separate PRIVATE bucket, server-side encryption, presigned GET for 5 minutes only | E19 |
| T12 | **Cross-site requests from other websites** | browser | CORS allow-list only for our frontend origin. We do **not** count CORS as protection: it only limits browsers; T1-T3 are the real controls | S17 |

Residual risks are in `cost-recovery-limitations.md`.
