'use strict';
// Test helpers (owner: Habiba). Tests run with `npm test` (node:test, no extra libraries)
// and need NO database, AWS or network: they exercise the logic and the HTTP layer up to
// the point where a request would reach the database.

process.env.CORS_ORIGINS = 'http://localhost:4566';
process.env.NODE_ENV = 'test';

const { setVerifierForTests } = require('../shared/auth');

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CUSTOMER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

// Fake tokens: the string is the role. Real signature checks are tested in shared/jwt.test.js.
const CLAIMS = {
  owner: { sub: 'owner-sub', 'cognito:groups': ['Owner'], 'custom:business_id': BUSINESS },
  staff: { sub: 'staff-sub', 'cognito:groups': ['Staff'], 'custom:business_id': BUSINESS },
  customerA: { sub: 'cust-a', 'cognito:groups': ['Customer'], 'custom:business_id': BUSINESS, 'custom:customer_id': CUSTOMER_A },
  nogroup: { sub: 'nobody', 'cognito:groups': [], 'custom:business_id': BUSINESS },
};

setVerifierForTests({
  async verify(token) {
    if (!CLAIMS[token]) throw new Error('bad signature');
    return CLAIMS[token];
  },
});

/** Start an Express app on a random port; returns { request, close }. */
async function startApp(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, path, { token, body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let payload;
    if (raw !== undefined) { payload = raw; h['Content-Type'] = h['Content-Type'] || 'application/json'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  return { request, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startApp, BUSINESS, CUSTOMER_A, CUSTOMER_B };
