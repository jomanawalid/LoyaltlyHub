# API and roles (report sections 5-6)

Base URL: the `API_URL` printed by `infra/scripts/06-api-gateway.sh`. Every route except
`GET /api/health` needs `Authorization: Bearer <Cognito ID token>`. Bodies are JSON
(max 10 kB); unknown fields are rejected.

## Roles

| Role | Who | How it is enforced |
|---|---|---|
| **Owner** | Business owner | Cognito group `Owner`; `requireRole(OWNER)` on every owner route |
| **Staff** | Counter staff | Cognito group `Staff` |
| **Customer** | Loyalty member | Cognito group `Customer` + `custom:customer_id`. **Ownership**: a customer can only read or act on their own id (`assertCustomerAccess`), whatever id they put in the URL or body |

Every query also filters by the caller's `custom:business_id` (tenant isolation): an owner of
another business gets 404 for our customers.

## Routes (26)

### Customers & Membership (Jomana)
| Method | Path | Roles | What it does |
|---|---|---|---|
| POST | /api/customers | Staff, Owner | Register: DB row + Cognito login (deleted again if the DB insert fails) |
| GET | /api/customers?q=&status=&tier=&limit=&offset= | Staff, Owner | Search by name / e-mail / phone with filters |
| GET | /api/customers/:id | Staff, Owner, Customer (own) | Profile with tier and engagement segment |
| PUT | /api/customers/:id | Staff, Owner | Edit details (e-mail change also updates the Cognito login) |
| PATCH | /api/customers/:id/status | Owner | Suspend / reactivate with a reason (disables / enables the login, history kept) |
| DELETE | /api/customers/:id | Owner | Erasure workflow: refused with open vouchers; closes the points account, anonymises, deletes the login |
| GET | /api/customers/:id/membership | Staff, Owner, Customer (own) | **Tier engine**: 12-month points from Points, tier decision, progress to next tier |
| GET | /api/me | Customer | Own profile + membership |
| GET | /api/reports/active-members?days= | Owner | Active / new / at-risk / lapsed members, by tier |

### Points & Transactions (Jana)
| Method | Path | Roles | What it does |
|---|---|---|---|
| POST | /api/transactions | Staff, Owner | Earn for a purchase. Header `Idempotency-Key: <uuid>` required. Replay returns the first result with `Idempotent-Replay: true` |
| GET | /api/transactions?customerId=&type=&from=&to= | Staff, Owner, Customer (own) | Ledger with filters |
| GET | /api/customers/:id/balance | Staff, Owner, Customer (own) | Balance and account status |
| POST | /api/transactions/:id/reversals | Owner | Void an EARN/ADJUST with a reason (refused if the points were already spent) |
| POST | /api/adjustments | Owner | Manual +/- points with a reason, never below 0 |
| GET | /api/earn-rules | Staff, Owner | Earn rate, max purchase, daily cap |
| PUT | /api/earn-rules | Owner | Change them |
| GET | /api/reports/staff-activity?days= | Owner | Per-staff earns/voids/adjustments with abuse flags |

### Rewards & Redemption (Habiba)
| Method | Path | Roles | What it does |
|---|---|---|---|
| GET | /api/rewards | all | Catalogue; for customers also balance, `affordable`, `pointsNeeded` |
| POST | /api/rewards | Owner | Create a reward (cost, stock, monthly limit) |
| PUT | /api/rewards/:id | Owner | Edit cost / stock / limit |
| DELETE | /api/rewards/:id | Owner | Retire (kept for history) |
| POST | /api/redemptions | Customer (own), Staff, Owner | Redeem: stock reserved, points debited in Points, voucher issued, e-mail queued; refund if anything fails |
| GET | /api/redemptions?status=&voucherCode= | all (customer: own) | Vouchers; staff/owner see masked codes |
| PATCH | /api/redemptions/:id/status | Staff, Owner (cancel: Owner) | `FULFILLED` needs the code the customer shows; `CANCELLED` needs a reason and refunds points + stock |
| GET | /api/reports/redemptions?from=&to=&format=json\|csv | Owner | Report; CSV goes to the private bucket, answer is a 5-minute presigned link |
| GET | /api/dashboard?days= | Owner | One call that combines all three services |

Plus `GET /api/health` (public, no data) on each service.

## Errors

Users only ever see a short generic message; the full detail is in our logs with the same
`requestId`, so we can find it when a user reports a problem.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Bad request", "requestId": "5f1c..." } }
```

| Status | code | message shown |
|---|---|---|
| 400 | VALIDATION_ERROR | Bad request |
| 401 | UNAUTHORIZED | Unauthorized |
| 403 | FORBIDDEN | Forbidden |
| 404 | NOT_FOUND | Not found |
| 409 | e.g. INSUFFICIENT_POINTS, OUT_OF_STOCK, DUPLICATE, CUSTOMER_NOT_ACTIVE | Conflict |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | Payload too large / Unsupported media type |
| 429 | (API Gateway throttling) | Too Many Requests |
| 500 | INTERNAL_ERROR | Something went wrong |

The 409 `code` lets the frontend show a friendly sentence (`frontend/js/api.js`) without the
backend revealing internals.
