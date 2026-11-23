# Security and functional testing (report sections 9-10)

All tests target **our own** deployment only (Floci on our laptops). Re-run them on your own
deployment before the demo and paste your output over the tables below, with a screenshot in
`evidence/`.

| Suite | Command | Owner(s) | Last result (Floci) |
|---|---|---|---|
| Deployment check | `bash infra/scripts/check-deployment.sh` | Jana | **18 / 18 pass** |
| Unit + HTTP tests (no AWS needed) | `cd backend && npm test` | all, one folder each | **49 / 49 pass** |
| End-to-end on the deployed API | `DEMO_PASSWORD=... node tests/integration/e2e.mjs` | all | **21 / 21 pass** |
| Security tests on the deployed API | `DEMO_PASSWORD=... node tests/security/run-security-tests.mjs` | S01-S05 Jomana, S06-S11 Jana, S12-S18 Habiba | **18 / 18 pass** |
| Load test (10,000+ seeded members) | `npm run db:seed10k` then `DEMO_PASSWORD=... node tests/load/load-test.mjs 5 30` (also 10 and 20) | Jana | **0 errors at 5 and 10 users; timeouts at 20 users on Floci, see below** |
| All suites in one go | `bash tests/run-all.sh` | Jomana | **ALL SUITES PASSED** |

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
| S12 | T5 | Double redemption race: 300 points, 3 parallel 200-point redemptions | exactly 1 x 201, balance 100 | 201/409/409 balance=100 | PASS |
| S13 | T5 | Duplicate earn: same Idempotency-Key sent 3 times in parallel | points added once | 409/409/201 added=40 | PASS |
| S14 | T5 | Missing Idempotency-Key on earn | 400 | 400 VALIDATION_ERROR | PASS |
| S15 | T7 | Error hygiene: malformed JSON + unknown route reveal no internals | 400/404, no stack or SQL | 400/404 leak=false | PASS |
| S16 | T10 | Voucher fraud: staff fulfils with a wrong code; staff lists show masked codes | 409 + masked | 409 shown=LH-****-****-M5 | PASS |
| S17 | T12 | CORS: unknown origin gets no Access-Control-Allow-Origin | no ACAO header | ACAO=none (CORS is browser-only; S01-S08 are the real controls) | PASS |
| S18 | T6 | Secret exposure review: repo files, API responses, public bucket | nothing found | files=none responseLeak=false bucket/.env=404 | PASS |

## End-to-end tests (E01-E21)

E01 owner sets earn rate; E02 owner creates a 200-point reward; E03 staff registers a customer
(DB + Cognito); E04 search by e-mail; E05 earn 250 points; E06 same request again is not counted
twice; E07 customer first login with forced password change; E08 affordable rewards; E09 redeem;
E10 second redemption with 50 points refused; E11 customer ledger; E12 staff fulfils with the
shown code; E13 fulfilling twice refused; E14 void refused when points were spent; E15 owner
adjustment; E16 void of the adjustment; E17 tier engine; E18 owner dashboard across three
services; E19 report + CSV to private S3; E20 suspend: login disabled, earning blocked;
E21 erasure workflow. **All 21 pass.**

## Unit / HTTP tests (backend/tests)

| Folder | Owner | What is covered |
|---|---|---|
| `shared/` | Habiba | JWT verifier (good token, tampered, wrong alg, expired, wrong audience/issuer), log redaction and e-mail masking, generic client errors, health, security headers, 401/403, malformed JSON 400, 415, 413, 404, CORS allow/deny |
| `customers/` | Jomana | tier thresholds, upgrade/downgrade with grace, progress, segments, status workflow, role checks, validation (e-mail, phone, script tags, extra fields), ownership, UUID ids |
| `points/` | Jana | integer earn maths with tier multipliers, limits, adjustments, void rules, staff-abuse flags, Idempotency-Key required, amount validation, owner-only actions |
| `rewards/` | Habiba | voucher format/uniqueness/masking, status workflow, redeem blockers, CSV formula neutralising, HTML escaping, Brevo client with a fake fetch (skipped / sent / HTTP error, key in header) |

## Load test (10,000+ members)

Run on Floci on one laptop (Docker), against a remote Neon database in Frankfurt, after
`npm run db:seed10k`. Each run is 30 s of virtual "counters" doing a mix of search, balance, tier,
earn, rewards and dashboard calls.

| Virtual users | Requests | Throughput | Overall p50 / p95 | 5xx errors |
|---|---|---|---|---|
| 5 | 410 | 11.9 req/s | 176 ms / 1.3 s | 0 |
| 10 | 321 | 9.7 req/s | 229 ms / 6.4 s | 0 |
| 20 | 93 | 1.9 req/s | 2.1 s / 26.5 s | 17 (HTTP 500) |

Detail at 5 virtual users:

| Request | Count | OK | 4xx (rules) | 429 throttled | 5xx/network | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|---|---|---|
| search customers | 133 | 133 | 0 | 0 | 0 | 168 | 450 | 660 |
| get balance | 114 | 114 | 0 | 0 | 0 | 85 | 238 | 363 |
| membership (2 services) | 44 | 44 | 0 | 0 | 0 | 327 | 2096 | 10253 |
| earn points | 61 | 61 | 0 | 0 | 0 | 960 | 2033 | 4161 |
| browse rewards | 37 | 37 | 0 | 0 | 0 | 161 | 425 | 467 |
| owner dashboard (3 services) | 21 | 21 | 0 | 0 | 0 | 188 | 289 | 457 |

How to read it honestly: with 5 and 10 concurrent users there were no errors, and the typical
request is fast. At 20 users the emulator degrades. Floci starts a new Lambda container for each
concurrent request; one cold container took about 17 s to start in our log, and the Floci log shows
`Function ... timed out after 15s` (our Lambda timeout) for the customers, points and rewards
functions. Those timeouts are the HTTP 500s. Our own functions logged no ERROR lines. The result is
a limit of the local emulator on one laptop, not a measure of AWS. On real AWS, cold starts are
about a second and provisioned concurrency would remove them (see `cost-recovery-limitations.md`).
The `loyalty-server-errors` alarm from `07-monitoring.sh` is the production control for this case.

## Known limitations

- The load test at 20 concurrent users degrades on Floci (above); it was not repeated on real AWS.
- Floci answers anonymous requests to a private bucket with 200, so an anonymous-request test gives a
  false alarm there. `check-deployment.sh` therefore tests the bucket's real settings instead (all four
  public-access blocks on, no bucket policy) and passes 18 / 18 checks.
- The per-service Neon roles (`005_app_role_grants.sql`) are designed but not in use: roles created in
  the Neon Console belong to `neon_superuser`, which bypasses table grants, so all services connect
  with the owner role. The row-level trigger `trg_ledger_append_only` still blocks UPDATE and DELETE
  on the ledger for every role; what is lost is separation between the services' tables and
  protection of the schema and the trigger themselves.
- Voucher e-mail: Brevo answered HTTP 403 in our test environment (account or IP settings). Messages
  are retried and then end in the dead-letter queue, as designed.
