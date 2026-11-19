'use strict';
// Owner: Habiba. Role checks and validation on the Rewards API (rejected before any DB call).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, CUSTOMER_A, CUSTOMER_B } = require('../helpers');
const app = require('../../services/rewards/app');

let srv;
test.before(async () => { srv = await startApp(app); });
test.after(() => srv.close());
const reward = { name: 'Free Tea', pointsCost: 100, stock: 10 };

test('only the owner manages the catalogue', async () => {
  assert.equal((await srv.request('POST', '/api/rewards', { token: 'staff', body: reward })).status, 403);
  assert.equal((await srv.request('POST', '/api/rewards', { token: 'customerA', body: reward })).status, 403);
  assert.equal((await srv.request('DELETE', `/api/rewards/${CUSTOMER_A}`, { token: 'staff' })).status, 403);
});

test('reward validation: cost > 0, stock >= 0, no unknown fields', async () => {
  for (const body of [{ ...reward, pointsCost: 0 }, { ...reward, stock: -1 }, { ...reward, status: 'retired' }, { name: 'X' }]) {
    assert.equal((await srv.request('POST', '/api/rewards', { token: 'owner', body })).status, 400, JSON.stringify(body));
  }
});

test('customer cannot redeem for another customer or list their vouchers', async () => {
  const r = await srv.request('POST', '/api/redemptions', { token: 'customerA', body: { rewardId: CUSTOMER_A, customerId: CUSTOMER_B } });
  assert.equal(r.status, 403);
  assert.equal((await srv.request('GET', `/api/redemptions?customerId=${CUSTOMER_B}`, { token: 'customerA' })).status, 403);
});

test('fulfil needs a well-formed voucher code; cancel needs a reason', async () => {
  const path = `/api/redemptions/${CUSTOMER_A}/status`;
  assert.equal((await srv.request('PATCH', path, { token: 'staff', body: { status: 'FULFILLED' } })).status, 400);
  assert.equal((await srv.request('PATCH', path, { token: 'staff', body: { status: 'FULFILLED', voucherCode: "' OR 1=1--" } })).status, 400);
  assert.equal((await srv.request('PATCH', path, { token: 'owner', body: { status: 'CANCELLED' } })).status, 400);
});

test('reports and dashboard are owner-only; dates validated', async () => {
  assert.equal((await srv.request('GET', '/api/dashboard', { token: 'staff' })).status, 403);
  assert.equal((await srv.request('GET', '/api/reports/redemptions?from=2026-01-01&to=2026-02-01', { token: 'staff' })).status, 403);
  assert.equal((await srv.request('GET', '/api/reports/redemptions?from=yesterday&to=2026-02-01', { token: 'owner' })).status, 400);
});
