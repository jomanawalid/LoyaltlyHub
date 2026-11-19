# Demo plan (live demo and the 5-minute video)

Before: `deploy-all.sh` done, `npm run db:seed10k` done, three browser windows (Owner, Staff,
Customer in a private window), the Floci console open on CloudWatch Logs.

## 1. End-to-end scenario (about 3 minutes)

| # | Who shows it | Step | Shows |
|---|---|---|---|
| 1 | Jana | Owner signs in, opens **Earn rules**, sets 1 point per EGP | role-based navigation, owner-only setting |
| 2 | Habiba | Owner creates a reward "Free Coffee - 200 points", stock 10 | catalogue |
| 3 | Jomana | Staff registers a customer; the temporary password is shown once | Customers service + Cognito |
| 4 | Jana | Staff adds a 250 EGP purchase: +250 points; clicks twice, still counted once | idempotency, ledger |
| 5 | Jomana | Customer signs in, must change the password, sees tier Bronze and progress | tier engine |
| 6 | Habiba | Customer redeems Free Coffee: voucher code shown, balance 50, e-mail arrives | saga across Rewards -> Points, SQS -> Brevo |
| 7 | Habiba | Staff fulfils the voucher by typing the code the customer shows | voucher workflow, masked codes |
| 8 | Jana | Owner dashboard: numbers from all three services; staff-activity report | integration |

## 2. Security scenarios (about 2 minutes)

| # | Who | Scenario | Expected |
|---|---|---|---|
| S-a | Jomana | Call `/api/customers` with no token, then with a tampered token | 401 Unauthorized |
| S-b | Jomana | Staff tries to change the earn rate | 403 Forbidden |
| S-c | Jana | Customer changes the id in `/api/customers/<other id>/balance` | 403 + SECURITY log line |
| S-d | Jana | Purchase amount `-5` or `10.555` | 400 "Bad request" (details only in logs) |
| S-e | Habiba | Customer with 300 points fires 3 redemptions at once | only one succeeds |
| S-f | Habiba | Open `<website>/.env` and `<website>/backend/` in the public bucket | 404 |
| S-g | all | CloudWatch: filter `SECURITY`, show the alarm for many denied requests | monitoring evidence |

Each student then shows their own service's code path for one request (frontend -> route ->
validation -> business rule -> SQL -> response) and one test from `backend/tests/<service>/`.
