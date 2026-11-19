// (owner: Jomana) End-to-end scenario across ALL THREE services, run against the deployed API
// (Floci or real AWS). It is the proposal's final demo, as an automated test:
//
//   owner sets 1 point / EGP and creates a 200-point reward -> staff registers a customer
//   and adds 250 points -> customer logs in, sees 250, redeems -> 50 left + voucher e-mail
//   queued -> staff fulfils the voucher -> owner checks dashboard + report.
//
// Run:  DEMO_PASSWORD='...' node tests/integration/e2e.mjs
import { DEMO, DEMO_PASSWORD, api, login, uuid, createRunner, expectStatus } from '../lib.mjs';

const t = createRunner('Integrated end-to-end test');
if (!DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD');

const ownerToken = await login(DEMO.owner, DEMO_PASSWORD);
const staffToken = await login(DEMO.staff, DEMO_PASSWORD);
const run = Date.now().toString(36);
const customerEmail = `e2e.${run}@example.test`;
const customerNewPassword = `Cust${run}Pass9`;
let customer;
let tempPassword;
let customerToken;
let rewardId;
let redemption;
let earnTx;
const earnKey = uuid();

await t.test('E01', 'Owner sets earn rate 1 point per EGP', '200', async () => {
  const r = await api('PUT', '/api/earn-rules', { token: ownerToken, body: { pointsPerUnit: 1, maxPurchase: 10000, dailyPointsCap: 5000 } });
  return expectStatus(r, 200, r.body.pointsPerUnit === 1);
});

await t.test('E02', 'Owner creates a 200-point reward', '201', async () => {
  const r = await api('POST', '/api/rewards', {
    token: ownerToken,
    body: { name: `E2E Coffee ${run}`, description: 'Integration test reward', pointsCost: 200, stock: 5 },
  });
  rewardId = r.body.rewardId;
  return expectStatus(r, 201);
});

await t.test('E03', 'Staff registers a customer (DB row + Cognito login)', '201', async () => {
  const r = await api('POST', '/api/customers', {
    token: staffToken,
    body: { fullName: 'Mona E2E', email: customerEmail, phone: '+201001234567' },
  });
  customer = r.body.customer;
  tempPassword = r.body.login && r.body.login.temporaryPassword;
  return expectStatus(r, 201, customer && customer.status === 'active' && customer.tier === 'BRONZE');
});

await t.test('E04', 'Staff finds the customer by e-mail search', '200 + 1 result', async () => {
  const r = await api('GET', `/api/customers?q=${encodeURIComponent(customerEmail)}`, { token: staffToken });
  return expectStatus(r, 200, r.body.total === 1);
});

await t.test('E05', 'Staff adds 250 points for a 250 EGP purchase', '201, balance 250', async () => {
  const r = await api('POST', '/api/transactions', {
    token: staffToken,
    headers: { 'Idempotency-Key': earnKey },
    body: { customerId: customer.customerId, purchaseAmount: 250 },
  });
  earnTx = r.body.transaction;
  return { ...expectStatus(r, 201, r.body.balance === 250), text: `${r.status} balance=${r.body.balance}` };
});

await t.test('E06', 'Same request again (double click) is not counted twice', '200 replay, balance 250', async () => {
  const r = await api('POST', '/api/transactions', {
    token: staffToken,
    headers: { 'Idempotency-Key': earnKey },
    body: { customerId: customer.customerId, purchaseAmount: 250 },
  });
  return { pass: r.status === 200 && r.body.balance === 250 && r.headers.get('idempotent-replay') === 'true', text: `${r.status} balance=${r.body.balance}` };
});

await t.test('E07', 'Customer first login (forced password change) and /me', '200, balance 250', async () => {
  customerToken = await login(customerEmail, tempPassword, customerNewPassword);
  const r = await api('GET', '/api/me', { token: customerToken });
  return { pass: r.status === 200 && r.body.membership.balance === 250, text: `${r.status} balance=${r.body.membership && r.body.membership.balance} tier=${r.body.membership && r.body.membership.tier}` };
});

await t.test('E08', 'Customer browses rewards and sees what is affordable', '200, reward affordable', async () => {
  const r = await api('GET', '/api/rewards?limit=100', { token: customerToken });
  const item = r.body.items.find((i) => i.rewardId === rewardId);
  return expectStatus(r, 200, item && item.affordable === true);
});

await t.test('E09', 'Customer redeems the 200-point reward', '201, balance 50, voucher', async () => {
  const r = await api('POST', '/api/redemptions', { token: customerToken, body: { rewardId } });
  redemption = r.body.redemption;
  return { pass: r.status === 201 && r.body.balance === 50 && /^LH-/.test(redemption.voucherCode), text: `${r.status} balance=${r.body.balance}` };
});

await t.test('E10', 'Second redemption with only 50 points is refused', '409 INSUFFICIENT_POINTS', async () => {
  const r = await api('POST', '/api/redemptions', { token: customerToken, body: { rewardId } });
  return expectStatus(r, 409, r.body.error.code === 'INSUFFICIENT_POINTS');
});

await t.test('E11', 'Customer sees own transaction ledger', '200, EARN + REDEEM', async () => {
  const r = await api('GET', '/api/transactions', { token: customerToken });
  const types = r.body.items.map((i) => i.type).sort().join(',');
  return { pass: r.status === 200 && types === 'EARN,REDEEM', text: `${r.status} ${types}` };
});

await t.test('E12', 'Staff fulfils the voucher with the code the customer shows', '200 FULFILLED', async () => {
  const r = await api('PATCH', `/api/redemptions/${redemption.redemptionId}/status`, {
    token: staffToken,
    body: { status: 'FULFILLED', voucherCode: redemption.voucherCode },
  });
  return expectStatus(r, 200, r.body.status === 'FULFILLED');
});

await t.test('E13', 'Fulfilling the same voucher twice is refused', '409', async () => {
  const r = await api('PATCH', `/api/redemptions/${redemption.redemptionId}/status`, {
    token: staffToken,
    body: { status: 'FULFILLED', voucherCode: redemption.voucherCode },
  });
  return expectStatus(r, 409);
});

await t.test('E14', 'Owner cannot void an earn whose points were already spent', '409 POINTS_ALREADY_SPENT', async () => {
  const r = await api('POST', `/api/transactions/${earnTx.transactionId}/reversals`, { token: ownerToken, body: { reason: 'Test void' } });
  return expectStatus(r, 409, r.body.error.code === 'POINTS_ALREADY_SPENT');
});

let adjustTx;
await t.test('E15', 'Owner manual adjustment +100 with a reason', '201, balance 150', async () => {
  const r = await api('POST', '/api/adjustments', {
    token: ownerToken,
    body: { customerId: customer.customerId, pointsDelta: 100, reason: 'Goodwill for late order' },
  });
  adjustTx = r.body.transaction;
  return { ...expectStatus(r, 201, r.body.balance === 150), text: `${r.status} balance=${r.body.balance}` };
});

await t.test('E16', 'Owner voids the adjustment (ledger keeps both rows)', '201, balance 50', async () => {
  const r = await api('POST', `/api/transactions/${adjustTx.transactionId}/reversals`, { token: ownerToken, body: { reason: 'Entered by mistake' } });
  return { ...expectStatus(r, 201, r.body.balance === 50), text: `${r.status} balance=${r.body.balance}` };
});

await t.test('E17', 'Membership tier engine answers with tier and progress', '200 BRONZE, 750 to SILVER', async () => {
  const r = await api('GET', `/api/customers/${customer.customerId}/membership`, { token: staffToken });
  return { pass: r.status === 200 && r.body.tier === 'BRONZE' && r.body.pointsToNextTier === 750, text: `${r.status} ${r.body.tier} next=${r.body.pointsToNextTier}` };
});

await t.test('E18', 'Owner dashboard combines all three services', '200', async () => {
  const r = await api('GET', '/api/dashboard?days=30', { token: ownerToken });
  return expectStatus(r, 200, r.body.members && r.body.points && r.body.redemptions);
});

await t.test('E19', 'Owner redemption report (JSON) and CSV export to private S3', '200 + download link', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const json = await api('GET', `/api/reports/redemptions?from=${today}&to=${today}`, { token: ownerToken });
  const csv = await api('GET', `/api/reports/redemptions?from=${today}&to=${today}&format=csv`, { token: ownerToken });
  return { pass: json.status === 200 && csv.status === 200 && Boolean(csv.body.downloadUrl), text: `${json.status}/${csv.status}` };
});

await t.test('E20', 'Owner suspends the customer: login disabled, earning blocked', '409 CUSTOMER_NOT_ACTIVE', async () => {
  await api('PATCH', `/api/customers/${customer.customerId}/status`, { token: ownerToken, body: { status: 'suspended', reason: 'Testing suspension' } });
  const r = await api('POST', '/api/transactions', {
    token: staffToken,
    headers: { 'Idempotency-Key': uuid() },
    body: { customerId: customer.customerId, purchaseAmount: 10 },
  });
  return expectStatus(r, 409, r.body.error.code === 'CUSTOMER_NOT_ACTIVE');
});

await t.test('E21', 'Erasure workflow: reactivate, then owner erases (no open vouchers)', '204', async () => {
  await api('PATCH', `/api/customers/${customer.customerId}/status`, { token: ownerToken, body: { status: 'active', reason: 'Testing reactivation' } });
  const r = await api('DELETE', `/api/customers/${customer.customerId}`, { token: ownerToken });
  const after = await api('GET', `/api/customers/${customer.customerId}`, { token: ownerToken });
  return { pass: r.status === 204 && after.body.email === null && after.body.status === 'erased', text: `${r.status} then ${after.body.status}` };
});

t.finish();
