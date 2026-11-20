# Deployment (report section 12)

We deploy with plain AWS CLI scripts (`infra/scripts/`), the same commands as Lab 7, so every
resource is visible and each person owns their own script. They run against **Floci** by default
and against a real AWS account with `TARGET=aws`.

## 0. Tools (each laptop)

Docker Desktop, Node.js 22, AWS CLI (v1 or v2), Git, and a free Neon account. Git Bash or WSL on
Windows.

## 1. Neon database (Jana; once per team)

1. Create a Neon project (region close to you), database `neondb`.
2. Copy the **owner** connection string (`...?sslmode=require`) into `backend/.env` as
   `DATABASE_URL` (copy `backend/.env.example` to `backend/.env` first). Never commit `.env`.
3. Install and migrate:
   ```bash
   cd backend
   npm ci
   npm run db:migrate      # 001-005
   npm run db:seed         # Demo Cafe + Other Salon, earn rules, 4 rewards
   npm run db:seed10k      # 10,000 customers for the load test / report
   ```
4. Least privilege: in the Neon Console, **Roles -> New role**: `loyalty_customers_svc`,
   `loyalty_points_svc`, `loyalty_rewards_svc` (Neon generates the passwords). Run
   `npm run db:migrate` again so `005_app_role_grants.sql` grants each role only its own tables.
   Put each role's connection string in `backend/.env` as `CUSTOMERS_DATABASE_URL`,
   `POINTS_DATABASE_URL`, `REWARDS_DATABASE_URL`. Share them with teammates privately
   (not in the repo, not in a group chat screenshot).

## 2. Brevo (Habiba)

Create a free Brevo account, verify a sender address, create an API key and put it in
`backend/.env` as `BREVO_API_KEY`, with the verified sender as `EMAIL_SENDER`.
Leave the key empty to skip e-mails (redemptions still work; `email_status = skipped`).

## 3. Start Floci and deploy everything

```bash
docker compose -f infra/floci/docker-compose.yml up -d
read -s -p "Demo password: " DEMO_PASSWORD; export DEMO_PASSWORD   # e.g. 12+ chars, upper, lower, digit
bash infra/scripts/deploy-all.sh
```

`deploy-all.sh` runs, in order:

| Script | Owner | Creates |
|---|---|---|
| `npm run zip` | Habiba | one zip per Lambda in `backend/dist/` (production dependencies only; refuses `.env`, `*.zip`, tests) |
| `01-foundation.sh` | Habiba | Secrets Manager secrets from your `.env`; private, encrypted reports bucket |
| `02-cognito.sh` | Jomana | user pool, groups, app client, demo Owner/Staff users (password from `$DEMO_PASSWORD`) |
| `03-customers.sh` | Jomana | IAM role + policy, Lambda `loyalty-customers-api` |
| `04-points.sh` | Jana | DynamoDB idempotency table (TTL), IAM role + policy, Lambda `loyalty-points-api` |
| `05-rewards.sh` | Habiba | SQS queue + DLQ, IAM roles + policies, Lambdas `loyalty-rewards-api` and `loyalty-email-worker`, SQS trigger |
| `06-api-gateway.sh` | Jana | HTTP API, routes, integrations, throttling, CORS-free gateway (CORS is in Express) |
| `07-monitoring.sh` | Jana | log retention, metric filters, alarms, SNS topic |
| `08-frontend.sh` | Habiba | public website bucket with **only** the frontend files, `js/env.js` with the API URL |
| `check-deployment.sh` | Jana | checks every resource and that `.env` / zips are NOT in the public bucket |

Each script can be re-run on its own (they update what already exists). Ids and URLs are saved
in `infra/.deploy-outputs.env` (git-ignored).

Open the website URL printed at the end (`http://localhost:4566/loyalty-web/index.html`) and
sign in as `owner@democafe.test` or `staff@democafe.test` with your demo password.

If Floci cannot pull the Lambda image (`public.ecr.aws/lambda/nodejs:22`), pull it from Docker
Hub and tag it:
`docker pull amazon/aws-lambda-nodejs:22 && docker tag amazon/aws-lambda-nodejs:22 public.ecr.aws/lambda/nodejs:22`.

## 4. Run the tests

```bash
(cd backend && npm test)                                   # unit + HTTP, no AWS needed
node tests/integration/e2e.mjs                             # needs DEMO_PASSWORD exported
node tests/security/run-security-tests.mjs
node tests/load/load-test.mjs 20 30
```

## 5. Local development without deploying

```bash
cd backend && npm run dev          # all three services on http://localhost:3000, in-process calls
npx http-server ../frontend -p 8080   # or any static server; open http://localhost:8080
```
Floci must still be running for Cognito, and `frontend/js/env.js` needs the Cognito client id.

## 6. Real AWS (optional)

```bash
export TARGET=aws AWS_PROFILE=your-profile AWS_REGION=eu-central-1 BUCKET_SUFFIX=group23
bash infra/scripts/deploy-all.sh
```
Differences handled by the scripts: real endpoints, global bucket names with the suffix, S3
website endpoint as the CORS origin. Use credentials from `aws configure` only; never put keys
in files in the repo.

## 7. Tear down

`bash infra/scripts/destroy-all.sh` (asks for confirmation; Neon data is kept).

## Note on SAM

The proposal planned AWS SAM. We used CLI scripts instead because they run unchanged on Floci
(Lab 7) and let each member own the script for their own services. The scripts are the IaC for
this project and are idempotent.
