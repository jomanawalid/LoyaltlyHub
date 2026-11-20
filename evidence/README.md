# Evidence (screenshots for the final report)

Put screenshots here as `NN-owner-what.png`, e.g. `07-jana-load-test.png`. Never include a
password, token, connection string or API key in a screenshot (crop or blur them).

| # | Screenshot | Owner |
|---|---|---|
| 01 | `deploy-all.sh` finishing with all OK lines and `check-deployment.sh` | Jana |
| 02 | Floci console: the 4 Lambdas, API routes, Cognito pool with the 3 groups | Jana |
| 03 | Public website bucket listing: only frontend files | Habiba |
| 04 | Private reports bucket + a presigned CSV download | Habiba |
| 05 | Secrets Manager list (names only, values hidden) | Habiba |
| 06 | `npm test` 49/49 | each owner, their folder |
| 07 | `e2e.mjs` 21/21 | Jomana |
| 08 | `run-security-tests.mjs` 18/18 table | all (each their S-tests) |
| 09 | Load test table + `db:seed10k` output | Jana |
| 10 | CloudWatch: a SECURITY log line (S06), an AUDIT line (E05), a `[REDACTED]` field | Jomana |
| 11 | CloudWatch alarms list + SQS DLQ attributes | Jana |
| 12 | UI: staff registers a customer and adds points | Jomana / Jana |
| 13 | UI: customer redeems, voucher code shown; e-mail received (Brevo) | Habiba |
| 14 | UI: owner dashboard, staff-activity flags, tier badges | all |
| 15 | GitHub: commit history per person, CI green (gitleaks + tests) | all |
