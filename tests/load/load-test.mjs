// Load test (owner: Jana). Simulates a busy day for a business with 10,000+ members:
// many counters searching customers, checking balances and adding points at once,
// plus the owner opening the dashboard. No dependencies (Node 20+ fetch).
//
// Before: npm run db:seed10k (from backend/) so the database has 10,000+ customers.
// Run:    DEMO_PASSWORD='...' node tests/load/load-test.mjs [virtualUsers] [seconds]
//         e.g. node tests/load/load-test.mjs 50 60
//
// Prints throughput, latency percentiles per request type, and how many requests the
// API Gateway throttle (429) turned away. Copy the table into docs/ (evidence).
import { DEMO, DEMO_PASSWORD, api, login, uuid } from '../lib.mjs';

if (!DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD');
const VUS = Number(process.argv[2] || 25);
const SECONDS = Number(process.argv[3] || 30);

const staff = await login(DEMO.staff, DEMO_PASSWORD);
const owner = await login(DEMO.owner, DEMO_PASSWORD);

// Pick real seeded customers to work on.
const sample = await api('GET', '/api/customers?q=Mona&status=active&limit=100', { token: staff });
if (sample.status !== 200 || !sample.body.items.length) throw new Error(`Need seeded customers first (npm run db:seed10k). Got ${sample.status}`);
const ids = sample.body.items.map((c) => c.customerId);
const total = sample.body.total;
console.log(`Load test: ${VUS} virtual users for ${SECONDS}s against ${total}+ matching customers`);

const names = ['Mona', 'Omar', 'Sara', 'Youssef', 'Nour', 'Karim', 'Laila', 'Ahmed', 'Hana', 'Ziad'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Realistic mix: mostly reads at the counter, some earns, a little owner reporting.
const actions = [
  { name: 'search customers', weight: 35, run: () => api('GET', `/api/customers?q=${pick(names)}&limit=20`, { token: staff }) },
  { name: 'get balance', weight: 25, run: () => api('GET', `/api/customers/${pick(ids)}/balance`, { token: staff }) },
  { name: 'membership (2 services)', weight: 10, run: () => api('GET', `/api/customers/${pick(ids)}/membership`, { token: staff }) },
  { name: 'earn points', weight: 15, run: () => api('POST', '/api/transactions', { token: staff, headers: { 'Idempotency-Key': uuid() }, body: { customerId: pick(ids), purchaseAmount: 25 + Math.floor(Math.random() * 100) } }) },
  { name: 'browse rewards', weight: 10, run: () => api('GET', '/api/rewards', { token: staff }) },
  { name: 'owner dashboard (3 services)', weight: 5, run: () => api('GET', '/api/dashboard?days=30', { token: owner }) },
];
const totalWeight = actions.reduce((s, a) => s + a.weight, 0);
function chooseAction() {
  let r = Math.random() * totalWeight;
  for (const a of actions) if ((r -= a.weight) < 0) return a;
  return actions[0];
}

const stats = new Map(actions.map((a) => [a.name, { lat: [], ok: 0, throttled: 0, expected4xx: 0, errors: 0 }]));
const deadline = Date.now() + SECONDS * 1000;
const serverCodes = {}; // which 5xx codes we saw (502/503/504 = gateway / Lambda start-up, 500 = our code)

async function virtualUser() {
  while (Date.now() < deadline) {
    const a = chooseAction();
    const s = stats.get(a.name);
    const t0 = performance.now();
    try {
      const res = await a.run();
      s.lat.push(performance.now() - t0);
      if (res.status < 400) s.ok += 1;
      else if (res.status === 429) s.throttled += 1;
      else if (res.status < 500) s.expected4xx += 1; // e.g. daily cap reached for a customer
      else { s.errors += 1; serverCodes[res.status] = (serverCodes[res.status] || 0) + 1; }
    } catch {
      s.errors += 1;
      serverCodes.network = (serverCodes.network || 0) + 1;
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: VUS }, virtualUser));
const elapsed = (Date.now() - started) / 1000;

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
let all = [];
let errors = 0;
let throttled = 0;
console.log('\n| Request | Count | OK | 4xx (rules) | 429 throttled | 5xx/network | p50 ms | p95 ms | p99 ms |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, s] of stats) {
  all = all.concat(s.lat);
  errors += s.errors;
  throttled += s.throttled;
  console.log(`| ${name} | ${s.lat.length} | ${s.ok} | ${s.expected4xx} | ${s.throttled} | ${s.errors} | ${pct(s.lat, 50).toFixed(0)} | ${pct(s.lat, 95).toFixed(0)} | ${pct(s.lat, 99).toFixed(0)} |`);
}
console.log(`\nTotal ${all.length} requests in ${elapsed.toFixed(1)}s = ${(all.length / elapsed).toFixed(1)} req/s; p50 ${pct(all, 50).toFixed(0)} ms, p95 ${pct(all, 95).toFixed(0)} ms; 5xx/network errors ${errors} ${JSON.stringify(serverCodes)}; throttled ${throttled}`);
console.log('Tip: long p99 values on Floci are new Lambda containers starting (cold starts); compare p50/p95 between runs.');
process.exitCode = errors > all.length * 0.01 ? 1 : 0; // fail if more than 1% server errors
