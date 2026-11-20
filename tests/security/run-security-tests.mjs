// Controlled security tests against OUR OWN deployed application (Floci or AWS).
// Prints a PASS/FAIL table you can paste into docs/security-tests.md as evidence.
//
// Run:  DEMO_PASSWORD='...' node tests/security/run-security-tests.mjs
// Owners: S01-S05 Jomana (identity/roles), S06-S11 Jana (ownership/input/integrity),
//         S12-S18 Habiba (redemption races, errors, CORS, secrets)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO, DEMO_PASSWORD, API_URL, api, login, uuid, createRunner, expectStatus } from '../lib.mjs';

if (!DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD');
const t = createRunner('Security tests');
const run = Date.now().toString(36);

// ---------- setup: two customers in Demo Cafe, one reward, tokens for every role ----------
const owner = await login(DEMO.owner, DEMO_PASSWORD);
const staff = await login(DEMO.staff, DEMO_PASSWORD);
const otherOwner = await login(DEMO.otherOwner, DEMO_PASSWORD);

async function newCustomer(tag, points) {
  const email = `sec.${tag}.${run}@example.test`;
  const r = await api('POST', '/api/customers', { token: staff, body: { fullName: `Sec ${tag}`, email, phone: '+201112223334' } });
  if (r.status !== 201) throw new Error(`setup: register ${tag} -> ${r.status}`);
  if (points) {
    await api('POST', '/api/transactions', {
      token: staff,
      headers: { 'Idempotency-Key': uuid() },
      body: { customerId: r.body.customer.customerId, purchaseAmount: points },
    });
  }
  const token = await login(email, r.body.login.temporaryPassword, `Sec${tag}${run}Pass1`);
  return { id: r.body.customer.customerId, token };
}
const custA = await newCustomer('a', 300);
const custB = await newCustomer('b', 0);
const reward = (await api('POST', '/api/rewards', { token: owner, body: { name: `Sec Reward ${run}`, pointsCost: 200, stock: 10 } })).body;

// ---------- Ownership, tenant isolation, input validation ----------
await t.test('S06', 'Ownership: Customer B reads Customer A balance by changing the id', '403', async () =>
  expectStatus(await api('GET', `/api/customers/${custA.id}/balance`, { token: custB.token }), 403));

await t.test('S07', 'Ownership: Customer B redeems using Customer A id in the body', '403', async () =>
  expectStatus(await api('POST', '/api/redemptions', { token: custB.token, body: { rewardId: reward.rewardId, customerId: custA.id } }), 403));

await t.test('S08', 'Tenant isolation: owner of another business opens a Demo Cafe customer', '404', async () =>
  expectStatus(await api('GET', `/api/customers/${custA.id}`, { token: otherOwner }), 404));

await t.test('S09', 'Invalid input: negative / huge / 3-decimal purchase amounts', '400 x3, generic message', async () => {
  const bad = [-50, 99999999, 10.123];
  const res = await Promise.all(bad.map((amount) => api('POST', '/api/transactions', {
    token: staff, headers: { 'Idempotency-Key': uuid() }, body: { customerId: custA.id, purchaseAmount: amount },
  })));
  const ok = res.every((r) => r.status === 400 && r.body.error.message === 'Bad request' && !JSON.stringify(r.body).includes('purchaseAmount'));
  return { pass: ok, text: res.map((r) => r.status).join('/') };
});

await t.test('S10', 'Mass assignment: extra field "role":"Owner" / "balance" in body', '400', async () => {
  const r1 = await api('PUT', `/api/customers/${custA.id}`, { token: staff, body: { fullName: 'Ok Name', role: 'Owner' } });
  const r2 = await api('POST', '/api/rewards', { token: owner, body: { name: 'X reward', pointsCost: 1, stock: 1, status: 'retired', businessId: uuid() } });
  return { pass: r1.status === 400 && r2.status === 400, text: `${r1.status}/${r2.status}` };
});

await t.test('S11', 'Injection: <script> in name rejected; SQL in search treated as text', '400 + 200 (0 rows)', async () => {
  const xss = await api('POST', '/api/customers', { token: staff, body: { fullName: '<script>alert(1)</script>', email: `xss${run}@x.test`, phone: '+201000000001' } });
  const sqli = await api('GET', `/api/customers?q=${encodeURIComponent("' OR '1'='1")}`, { token: staff });
  return { pass: xss.status === 400 && sqli.status === 200 && sqli.body.total === 0, text: `${xss.status}/${sqli.status} rows=${sqli.body.total}` };
});


t.finish();
