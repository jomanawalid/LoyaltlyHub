'use strict';
// Owner: Jana. The shared HTTP behaviour every service gets from app-factory.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const app = require('../../services/rewards/app');

let srv;
test.before(async () => { srv = await startApp(app); });
test.after(() => srv.close());

test('GET /api/health is public and returns no data', async () => {
  const r = await srv.request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('security headers are set and x-powered-by is hidden', async () => {
  const r = await srv.request('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('x-request-id'));
});

test('no token -> 401, unknown token -> 401, user in no group -> 403', async () => {
  assert.equal((await srv.request('GET', '/api/rewards')).status, 401);
  assert.equal((await srv.request('GET', '/api/rewards', { token: 'forged' })).status, 401);
  assert.equal((await srv.request('GET', '/api/rewards', { token: 'nogroup' })).status, 403);
});

test('malformed JSON -> 400 Bad request, wrong content type -> 415', async () => {
  const r = await srv.request('POST', '/api/rewards', { token: 'owner', raw: '{"name":' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.message, 'Bad request');
  const t = await srv.request('POST', '/api/rewards', { token: 'owner', raw: 'name=x', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(t.status, 415);
});

test('body over 10 kB -> 413', async () => {
  const r = await srv.request('POST', '/api/rewards', { token: 'owner', body: { name: 'x'.repeat(20000) } });
  assert.equal(r.status, 413);
});

test('unknown route -> JSON 404', async () => {
  const r = await srv.request('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});

test('CORS: our origin allowed, any other origin gets no CORS header', async () => {
  const ok = await srv.request('OPTIONS', '/api/rewards', { headers: { Origin: 'http://localhost:4566', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:4566');
  const evil = await srv.request('OPTIONS', '/api/rewards', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});
