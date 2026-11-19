'use strict';
// Owner: Jomana. Role checks and validation on the Customers API (rejected before any DB call).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, CUSTOMER_B } = require('../helpers');
const app = require('../../services/customers/app');

let srv;
test.before(async () => { srv = await startApp(app); });
test.after(() => srv.close());
const valid = { fullName: 'Mona Ali', email: 'mona@example.com', phone: '+201001234567' };

test('register: no token 401, customer 403', async () => {
  assert.equal((await srv.request('POST', '/api/customers', { body: valid })).status, 401);
  assert.equal((await srv.request('POST', '/api/customers', { token: 'customerA', body: valid })).status, 403);
});

test('register: invalid e-mail, short name, bad phone, script tag, extra field -> 400', async () => {
  const bad = [
    { ...valid, email: 'not-an-email' },
    { ...valid, fullName: 'M' },
    { ...valid, phone: '12ab' },
    { ...valid, fullName: '<script>alert(1)</script>' },
    { ...valid, role: 'Owner' },
    { fullName: 'Only Name' },
  ];
  for (const body of bad) {
    const r = await srv.request('POST', '/api/customers', { token: 'staff', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.message, 'Bad request');
  }
});

test('status change and erasure are owner-only', async () => {
  const s = await srv.request('PATCH', `/api/customers/${CUSTOMER_B}/status`, { token: 'staff', body: { status: 'suspended', reason: 'Testing only' } });
  assert.equal(s.status, 403);
  assert.equal((await srv.request('DELETE', `/api/customers/${CUSTOMER_B}`, { token: 'staff' })).status, 403);
});

test('customer cannot open another customer record (ownership) and ids must be UUIDs', async () => {
  assert.equal((await srv.request('GET', `/api/customers/${CUSTOMER_B}`, { token: 'customerA' })).status, 403);
  assert.equal((await srv.request('GET', '/api/customers/123', { token: 'staff' })).status, 400);
});

test('/me is only for customers; search rejects unknown filters', async () => {
  assert.equal((await srv.request('GET', '/api/me', { token: 'staff' })).status, 403);
  assert.equal((await srv.request('GET', '/api/customers?sort=password', { token: 'staff' })).status, 400);
  assert.equal((await srv.request('GET', '/api/customers?limit=5000', { token: 'staff' })).status, 400);
});
