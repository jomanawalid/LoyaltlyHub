'use strict';
// Owner: Jana. Role checks and validation on the Points API (rejected before any DB call).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, CUSTOMER_A, CUSTOMER_B } = require('../helpers');
const app = require('../../services/points/app');

let srv;
test.before(async () => { srv = await startApp(app); });
test.after(() => srv.close());
const key = { 'Idempotency-Key': '6f1c1c52-7c2f-4a49-9a0e-2d6a2f1b5c11' };

test('earn needs staff/owner and an Idempotency-Key UUID', async () => {
  const body = { customerId: CUSTOMER_A, purchaseAmount: 100 };
  assert.equal((await srv.request('POST', '/api/transactions', { body, headers: key })).status, 401);
  assert.equal((await srv.request('POST', '/api/transactions', { token: 'customerA', body, headers: key })).status, 403);
  assert.equal((await srv.request('POST', '/api/transactions', { token: 'staff', body })).status, 400);
  assert.equal((await srv.request('POST', '/api/transactions', { token: 'staff', body, headers: { 'Idempotency-Key': 'abc' } })).status, 400);
});

test('earn rejects negative, zero, huge, string and 3-decimal amounts', async () => {
  for (const purchaseAmount of [-5, 0, 2000000, '100', 10.555]) {
    const r = await srv.request('POST', '/api/transactions', { token: 'staff', headers: key, body: { customerId: CUSTOMER_A, purchaseAmount } });
    assert.equal(r.status, 400, String(purchaseAmount));
  }
});

test('voids, adjustments and earn-rule changes are owner-only', async () => {
  assert.equal((await srv.request('POST', `/api/transactions/${CUSTOMER_A}/reversals`, { token: 'staff', body: { reason: 'Mistake here' } })).status, 403);
  assert.equal((await srv.request('POST', '/api/adjustments', { token: 'staff', body: { customerId: CUSTOMER_A, pointsDelta: 10, reason: 'Gift points' } })).status, 403);
  assert.equal((await srv.request('PUT', '/api/earn-rules', { token: 'staff', body: { pointsPerUnit: 99, maxPurchase: 1, dailyPointsCap: 1 } })).status, 403);
});

test('adjustment of 0 points or without a reason -> 400', async () => {
  assert.equal((await srv.request('POST', '/api/adjustments', { token: 'owner', body: { customerId: CUSTOMER_A, pointsDelta: 0, reason: 'Nothing at all' } })).status, 400);
  assert.equal((await srv.request('POST', '/api/adjustments', { token: 'owner', body: { customerId: CUSTOMER_A, pointsDelta: 5 } })).status, 400);
});

test("customer cannot read another customer's balance", async () => {
  assert.equal((await srv.request('GET', `/api/customers/${CUSTOMER_B}/balance`, { token: 'customerA' })).status, 403);
});
