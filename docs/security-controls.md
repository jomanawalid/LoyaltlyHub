# Security controls (report section 8)

| Control | How we implemented it | Where |
|---|---|---|
| Authentication | Amazon Cognito user pool (password policy, forced change of temporary passwords). The backend verifies every ID token itself: RS256 signature against the pool's JWKS, issuer, audience, `token_use`, expiry. | `infra/scripts/02-cognito.sh`, `backend/shared/jwt.js`, `auth.js` |
| Authorisation (roles) | Cognito groups Owner / Staff / Customer, checked on every route by `requireRole`. The frontend hides buttons only for convenience. | `services/*/routes.js` |
| Ownership checks | Customers can only use their own `custom:customer_id`, whatever id they send; every query is filtered by the caller's `business_id`. | `shared/auth.js` `assertCustomerAccess`, repositories |
| Least privilege (AWS) | One IAM role and policy per Lambda, naming exact resources: its own log group, its own secret, only the queue/table/bucket prefix it uses, only the functions it must invoke, and Cognito admin actions on our pool only for Customers. No `*` actions, no admin policies. | `infra/iam/*.json` |
| Least privilege (database) | One Postgres role per service with table-level grants; the ledger is INSERT/SELECT only and a trigger blocks UPDATE/DELETE. Only the owner role (used from a laptop for migrations) can change the schema. | `database/005_app_role_grants.sql`, `003_points.sql` |
| Service-to-service | IAM decides who may invoke a function; each internal action also has `allowedCallers`. | `shared/lambda-handler.js`, `services/*/internal.js` |
| Secrets handling | Neon URLs and the Brevo key live in Secrets Manager (read at runtime, cached 5 min). `.env` is git-ignored, gitleaks runs over the whole history in CI, the demo password lives only in a shell variable, and nothing secret is in Lambda environment variables or the frontend. | `shared/secrets.js`, `01-foundation.sh`, `.github/workflows/ci.yml` |
| Input validation | JSON Schema (ajv) on body, query, params and headers: types, ranges, lengths, formats, `additionalProperties: false`, safe-text pattern. Body max 10 kB, JSON only. | `shared/validate.js`, `services/*/schemas.js` |
| Safe errors | Users get `{code, message: "Bad request", requestId}`; full details, stacks and SQL errors stay in our logs. | `shared/errors.js`, `app-factory.js` |
| Secure transport | Neon requires TLS (`sslmode=require`); AWS APIs over HTTPS on real AWS; Brevo over HTTPS. (Floci runs on plain HTTP locally; CloudFront + HTTPS is the production plan.) | `shared/db.js` |
| Encryption at rest | Neon encrypts storage; S3 reports with SSE (AES-256); Secrets Manager encrypts with KMS; DynamoDB encrypted by default. | `aws-clients.js`, `01-foundation.sh` |
| Abuse limits | API Gateway throttling, daily points cap, max purchase, monthly reward limit, idempotency, staff-activity flags, alarms. | `06-api-gateway.sh`, `points/rules.js`, `07-monitoring.sh` |
| Browser hardening | Strict Content-Security-Policy, Helmet headers on the API, DOM built with `textContent` (no `innerHTML` with data), CORS allow-list (not counted as a security control). | `frontend/*.html`, `frontend/js/ui.js`, `app-factory.js` |
| Public bucket hygiene | Only an allow-list of `frontend/` files is uploaded; `.env`, `backend/`, zips are refused and checked after deploy. | `08-frontend.sh`, `check-deployment.sh`, S18 |

## Shared responsibility

| The provider (AWS, Neon, Brevo) handles | We (the team) handle |
|---|---|
| Physical security of data centres and hardware | Writing IAM policies with only the permissions each function needs |
| Patching the Lambda runtime, OS and the Postgres engine | Validating input, checking roles and ownership in our code |
| Availability and durability of S3, DynamoDB, SQS and Neon storage | Keeping secrets out of code, git, logs and the public bucket |
| Encryption features (KMS, SSE, TLS endpoints) | Turning those features on and using TLS connection strings |
| Cognito password hashing and token signing | Verifying tokens properly and choosing who belongs to which group |

## Why no broad administrative access

If one Lambda were given `AdministratorAccess` or `"Action": "*"`, any bug in it (an injection, a
leaked dependency) would let an attacker read every secret, delete the buckets or create new
users. With our policies, a compromised Points function can only read the Points database secret,
use the idempotency table and call Customers: it cannot read the Customers or Rewards database secrets,
the Brevo key, the reports bucket or the queue. The same idea applies to the database roles.
