# Security and functional testing (report sections 9-10)

All tests target **our own** deployment only (Floci on our laptops). Re-run them on your own
deployment before the demo and paste your output over the tables below, with a screenshot in
`evidence/`.

| Suite | Command | Owner(s) | Last result (Floci) |
|---|---|---|---|
| Unit + HTTP tests (no AWS needed) | `cd backend && npm test` | all, one folder each | **49 / 49 pass** |
| End-to-end on the deployed API | `DEMO_PASSWORD=... node tests/integration/e2e.mjs` | all | **21 / 21 pass** |
| Security tests on the deployed API | `DEMO_PASSWORD=... node tests/security/run-security-tests.mjs` | S01-S05 Jomana, S06-S11 Jana, S12-S18 Habiba | **18 / 18 pass** |
| Load test (10,000+ seeded members) | `npm run db:seed10k` then `DEMO_PASSWORD=... node tests/load/load-test.mjs 20 30` | Jana | see below |

## Security tests (S01-S18)

| ID | Threat | Scenario | Expected | Actual | Result |
|----|----|----------|----------|--------|--------|
| S01 | T1 | Unauthenticated: list customers with no token | 401 | 401 UNAUTHORIZED | PASS |
| S02 | T1 | Tampered token: payload changed to Owner, signature kept | 401 | 401 UNAUTHORIZED | PASS |
| S03 | T1 | Garbage / unsigned token (alg none) | 401 | 401/401 | PASS |
| S04 | T2 | Unauthorized role: Customer tries to register a customer | 403 | 403 FORBIDDEN | PASS |
| S05 | T2 | Unauthorized role: Staff tries to change the earn rate / void | 403 | 403/403 | PASS |
| S06 | T3 | Ownership: Customer B reads Customer A balance by changing the id | 403 | 403 FORBIDDEN | PASS |
| S07 | T3 | Ownership: Customer B redeems using Customer A id in the body | 403 | 403 FORBIDDEN | PASS |
| S08 | T3 | Tenant isolation: owner of another business opens a Demo Cafe customer | 404 | 404 NOT_FOUND | PASS |
| S09 | T4 | Invalid input: negative / huge / 3-decimal purchase amounts | 400 x3, generic message | 400/400/400 | PASS |
| S10 | T4 | Mass assignment: extra field "role":"Owner" / "balance" in body | 400 | 400/400 | PASS |
| S11 | T4 | Injection: `<script>` in name rejected; SQL in search treated as text | 400 + 200 (0 rows) | 400/200 rows=0 | PASS |
| S12 | T5 | Double redemption race: 300 points, 3 parallel 200-point redemptions | exactly 1 x 201, balance 100 | 409/201/409 balance=100 | PASS |
| S13 | T5 | Duplicate earn: same Idempotency-Key sent 3 times in parallel | points added once | 409/201/409 added=40 | PASS |
| S14 | T5 | Missing Idempotency-Key on earn | 400 | 400 VALIDATION_ERROR | PASS |
| S15 | T7 | Error hygiene: malformed JSON + unknown route reveal no internals | 400/404, no stack or SQL | 400/404 leak=false | PASS |
| S16 | T10 | Voucher fraud: staff fulfils with a wrong code; staff lists show masked codes | 409 + masked | 409 shown=LH-****-****-AW | PASS |
| S17 | T12 | CORS: unknown origin gets no Access-Control-Allow-Origin | no ACAO header | ACAO=none | PASS |
| S18 | T6 | Secret exposure review: repo files, API responses, public bucket | nothing found | files=none responseLeak=false bucket/.env=404 | PASS |

## End-to-end tests (E01-E21)

E01 owner sets earn rate · E02 owner creates a 200-point reward · E03 staff registers a customer
(DB + Cognito) · E04 search by e-mail · E05 earn 250 points · E06 same request again is not counted
twice · E07 customer first login with forced password change · E08 affordable rewards · E09 redeem ·
E10 second redemption with 50 points refused · E11 customer ledger · E12 staff fulfils with the
shown code · E13 fulfilling twice refused · E14 void refused when points were spent · E15 owner
adjustment · E16 void of the adjustment · E17 tier engine · E18 owner dashboard across three
services · E19 report + CSV to private S3 · E20 suspend: login disabled, earning blocked ·
E21 erasure workflow. **All 21 pass.**

## Unit / HTTP tests (backend/tests)

| Folder | Owner | What is covered |
|---|---|---|
| `shared/` | Habiba | JWT verifier (good token, tampered, wrong alg, expired, wrong audience/issuer), log redaction and e-mail masking, generic client errors, health, security headers, 401/403, malformed JSON 400, 415, 413, 404, CORS allow/deny |
| `customers/` | Jomana | tier thresholds, upgrade/downgrade with grace, progress, segments, status workflow, role checks, validation (e-mail, phone, script tags, extra fields), ownership, UUID ids |
| `points/` | Jana | integer earn maths with tier multipliers, limits, adjustments, void rules, staff-abuse flags, Idempotency-Key required, amount validation, owner-only actions |
| `rewards/` | Habiba | voucher format/uniqueness/masking, status workflow, redeem blockers, CSV formula neutralising, HTML escaping, Brevo client with a fake fetch (skipped / sent / HTTP error, key in header) |

## Load test (10,000+ members)

Run on Floci on one laptop, 20 parallel "counters" for 30 s, after `npm run db:seed10k`:

| Request | Count | OK | 4xx (rules) | 429 throttled | 5xx/network | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|---|---|---|
| search customers | 605 | 605 | 0 | 0 | 0 | 15 | 82 | 16205 |
| get balance | 460 | 460 | 0 | 0 | 0 | 7 | 86 | 17207 |
| membership (2 services) | 186 | 182 | 0 | 0 | 2 | 18 | 270 | 28872 |
| earn points | 266 | 258 | 0 | 0 | 4 | 39 | 490 | 29025 |
| browse rewards | 193 | 193 | 0 | 0 | 0 | 8 | 60 | 125 |
| owner dashboard (3 services) | 88 | 86 | 0 | 0 | 1 | 42 | 154 | 18274 |

Total 1,791 requests in 46 s; p50 15 ms, p95 134 ms; 7 server errors (0.4 %).

How to read it honestly: p50/p95 show the code and indexes are fast at 10,000+ members. The very
long p99 values and the few 500s happen when Floci starts **new Lambda containers** under load:
a nested service call (e.g. earn -> Customers) waits for a cold container and hits the 15 s
Lambda timeout. Our application logged no ERROR lines in that run. On real AWS, cold starts are
around a second; provisioned concurrency would remove them (see `cost-recovery-limitations.md`).
