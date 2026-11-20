# LoyaltyHub

A cloud-native, secure points-based loyalty system for small businesses (cafes, salons, shops).
Staff register customers and add points at the counter, customers sign in to track points and
redeem rewards, and the owner controls earn rates, rewards and reports.

Group 23 - Cloud Computing & Cloud Security: Habiba Elmallah (Rewards & Redemption),
Jomana Walid (Customer & Membership), Jana Moheyeldeen (Points & Transactions).

## What is inside

| | |
|---|---|
| Frontend | HTML/CSS/JavaScript, hosted in a public S3 website bucket (frontend files only) |
| Backend | Node.js 22 + Express 5 on AWS Lambda, one function per service + an SQS e-mail worker |
| AWS (Floci) | API Gateway, Lambda, Cognito, Secrets Manager, DynamoDB, SQS + DLQ, S3 (public website + private reports), CloudWatch Logs/Metrics/Alarms, SNS, IAM (5 least-privilege policies) |
| Database | Neon Postgres (TLS, one role per service, append-only points ledger) |
| External API | Brevo transactional e-mail (voucher e-mails) |
| Scale | indexed queries, pagination, 10,000-member seed and load test |

The three services call each other (Lambda-to-Lambda with IAM + caller checks, and SQS):
earning points asks Customers for the tier multiplier, redeeming debits points in Points, the
owner dashboard combines all three, and erasing a customer closes their points account.

## Quick start (Floci)

```bash
cp backend/.env.example backend/.env        # fill in your Neon URL (never commit .env)
cd backend && npm ci && npm run db:migrate && npm run db:seed && cd ..
docker compose -f infra/floci/docker-compose.yml up -d
read -s -p "Demo password: " DEMO_PASSWORD; export DEMO_PASSWORD
bash infra/scripts/deploy-all.sh
```

Open the printed website URL and sign in as `owner@democafe.test` or `staff@democafe.test`.
Full steps: [docs/deployment.md](docs/deployment.md).

## Tests

| Command | Result on our Floci deployment |
|---|---|
| `cd backend && npm test` | 49 / 49 unit + HTTP tests pass |
| `node tests/integration/e2e.mjs` | 21 / 21 end-to-end steps pass |
| `node tests/security/run-security-tests.mjs` | 18 / 18 security tests pass |
| `node tests/load/load-test.mjs 20 30` | see [docs/security-tests.md](docs/security-tests.md) |

## Documentation

| Doc | Report section |
|---|---|
| [architecture.md](docs/architecture.md) | 1-2 problem, architecture diagram, AWS services per student |
| [api.md](docs/api.md) | 3-4 service/API list, role matrix, errors |
| [data-model.md](docs/data-model.md) | 3 data model (ER diagram) |
| [deployment.md](docs/deployment.md) | 6 deployment approach |
| [threat-model.md](docs/threat-model.md) | 7 threat model (12 threats) |
| [security-controls.md](docs/security-controls.md) | 8 security controls, shared responsibility |
| [monitoring.md](docs/monitoring.md) | 11 logs, metrics, alarms, queries |
| [security-tests.md](docs/security-tests.md) | 12-13 security tests, integrated tests, load test |
| [cost-recovery-limitations.md](docs/cost-recovery-limitations.md) | 14-16 cost, recovery, limitations |
| [decisions.md](docs/decisions.md) | changes from the proposal, design decisions |
| [demo-plan.md](docs/demo-plan.md) | demo and video plan |
| [WORK_PLAN.md](WORK_PLAN.md) | who does what, in which order, with which commits |

## Security rules we follow

- No secrets in the repo, logs, Lambda environment variables or the public bucket (Secrets
  Manager + gitleaks in CI).
- Users only see generic errors ("Bad request"); full details are logged on our side with a
  request id.
- Roles and ownership are enforced in the backend. CORS only allows our frontend origin and is
  **not** treated as a security control.
