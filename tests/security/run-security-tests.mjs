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

// ---------- Identity & roles ----------
await t.test('S01', 'Unauthenticated: list customers with no token', '401', async () =>
  expectStatus(await api('GET', '/api/customers'), 401));

await t.test('S02', 'Tampered token: payload changed to Owner, signature kept', '401', async () => {
  const [h, p, s] = custA.token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  claims['cognito:groups'] = ['Owner'];
  const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
  return expectStatus(await api('GET', '/api/dashboard', { token: forged }), 401);
});

await t.test('S03', 'Garbage / unsigned token (alg none)', '401', async () => {
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
  const r1 = await api('GET', '/api/rewards', { token: 'abc.def.ghi' });
  const r2 = await api('GET', '/api/rewards', { headers: { Authorization: `Bearer ${none}` } });
  return { pass: r1.status === 401 && r2.status === 401, text: `${r1.status}/${r2.status}` };
});

await t.test('S04', 'Unauthorized role: Customer tries to register a customer', '403', async () =>
  expectStatus(await api('POST', '/api/customers', { token: custA.token, body: { fullName: 'Hacker', email: `x${run}@x.test`, phone: '+201000000000' } }), 403));

await t.test('S05', 'Unauthorized role: Staff tries to change the earn rate / void', '403', async () => {
  const r1 = await api('PUT', '/api/earn-rules', { token: staff, body: { pointsPerUnit: 50, maxPurchase: 10000, dailyPointsCap: 5000 } });
  const r2 = await api('POST', `/api/transactions/${uuid()}/reversals`, { token: staff, body: { reason: 'Steal points' } });
  return { pass: r1.status === 403 && r2.status === 403, text: `${r1.status}/${r2.status}` };
});

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


// ---------- Integrity, races, errors, configuration ----------
await t.test('S12', 'Double redemption race: 300 points, 3 parallel 200-point redemptions', 'exactly 1 x 201, balance 100', async () => {
  const res = await Promise.all([1, 2, 3].map(() => api('POST', '/api/redemptions', { token: custA.token, body: { rewardId: reward.rewardId } })));
  const created = res.filter((r) => r.status === 201).length;
  const bal = await api('GET', `/api/customers/${custA.id}/balance`, { token: custA.token });
  return { pass: created === 1 && bal.body.balance === 100, text: `${res.map((r) => r.status).join('/')} balance=${bal.body.balance}` };
});

await t.test('S13', 'Duplicate earn: same Idempotency-Key sent 3 times in parallel', 'points added once', async () => {
  const key = uuid();
  const before = (await api('GET', `/api/customers/${custB.id}/balance`, { token: staff })).body.balance;
  const res = await Promise.all([1, 2, 3].map(() => api('POST', '/api/transactions', {
    token: staff, headers: { 'Idempotency-Key': key }, body: { customerId: custB.id, purchaseAmount: 40 },
  })));
  const after = (await api('GET', `/api/customers/${custB.id}/balance`, { token: staff })).body.balance;
  return { pass: after - before === 40, text: `${res.map((r) => r.status).join('/')} added=${after - before}` };
});

await t.test('S14', 'Missing Idempotency-Key on earn', '400', async () =>
  expectStatus(await api('POST', '/api/transactions', { token: staff, body: { customerId: custB.id, purchaseAmount: 5 } }), 400));

await t.test('S15', 'Error hygiene: malformed JSON + unknown route reveal no internals', '400/404, no stack or SQL', async () => {
  const r1 = await api('POST', '/api/rewards', { token: owner, raw: '{"name": "x",' });
  const r2 = await api('GET', `/api/customers/${uuid()}`, { token: staff });
  const text = JSON.stringify([r1.body, r2.body]);
  const leak = /(stack|select |insert |postgres|node_modules|at \/)/i.test(text);
  return { pass: r1.status === 400 && r2.status === 404 && !leak, text: `${r1.status}/${r2.status} leak=${leak}` };
});

await t.test('S16', 'Voucher fraud: staff fulfils with a wrong code; staff lists show masked codes', '409 + masked', async () => {
  const list = await api('GET', `/api/redemptions?customerId=${custA.id}`, { token: staff });
  const red = list.body.items[0];
  const r = await api('PATCH', `/api/redemptions/${red.redemptionId}/status`, { token: staff, body: { status: 'FULFILLED', voucherCode: 'LH-AAAA-BBBB-CC' } });
  return { pass: r.status === 409 && red.voucherCode.startsWith('LH-****'), text: `${r.status} shown=${red.voucherCode}` };
});

await t.test('S17', 'CORS: unknown origin gets no Access-Control-Allow-Origin', 'no ACAO header', async () => {
  const res = await fetch(`${API_URL}/api/rewards`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  const acao = res.headers.get('access-control-allow-origin');
  return { pass: !acao, text: `ACAO=${acao || 'none'} (CORS is browser-only; S01-S08 are the real controls)` };
});

await t.test('S18', 'Secret exposure review: repo files, API responses, public bucket', 'nothing found', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const patterns = [/postgres(ql)?:\/\/[^\s:]+:[^@\s]+@(?!HOST)/, /xkeysib-[a-f0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /BEGIN (RSA|EC) PRIVATE KEY/];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(e.name) || e.name === '.env' || e.name === '.deploy-outputs.env') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.statSync(p).size < 2_000_000) {
        const text = fs.readFileSync(p, 'utf8');
        if (patterns.some((re) => re.test(text)) && !p.endsWith('.gitleaks.toml')) hits.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  const me = await api('GET', '/api/me', { token: custA.token });
  const responseLeak = /cognitoSub|cognito_sub|password/i.test(JSON.stringify(me.body));
  const web = process.env.WEB_URL ? await fetch(process.env.WEB_URL.replace('index.html', '.env')) : { status: 404 };
  return { pass: hits.length === 0 && !responseLeak && web.status !== 200, text: `files=${hits.join(',') || 'none'} responseLeak=${responseLeak} bucket/.env=${web.status}` };
});

t.finish();
