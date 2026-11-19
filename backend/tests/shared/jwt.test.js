'use strict';
// Owner: Habiba. Real RS256 signature checks with a locally generated key pair.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JwtVerifier } = require('../../shared/jwt');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const fetchFn = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const ISS = 'http://localhost:4566/us-east-1_test';
const AUD = 'client123';

function sign(claims, { alg = 'RS256', kid = 'k1', key = privateKey } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ iss: ISS, aud: AUD, token_use: 'id', sub: 'u1', exp: now() + 600, iat: now() });
const verifier = new JwtVerifier({ issuer: ISS, audience: AUD, jwksUri: 'http://x/jwks.json', fetchFn });

test('accepts a correctly signed, unexpired ID token', async () => {
  const claims = await verifier.verify(sign(good()));
  assert.equal(claims.sub, 'u1');
});

test('rejects a token whose payload was changed after signing', async () => {
  const [h, , s] = sign(good()).split('.');
  const forged = Buffer.from(JSON.stringify({ ...good(), 'cognito:groups': ['Owner'] })).toString('base64url');
  await assert.rejects(verifier.verify(`${h}.${forged}.${s}`), /bad signature/);
});

test('rejects a token signed by another key', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifier.verify(sign(good(), { key: other })), /bad signature/);
});

test('rejects expired, wrong issuer, wrong audience and access tokens', async () => {
  await assert.rejects(verifier.verify(sign({ ...good(), exp: now() - 120 })), /expired/);
  await assert.rejects(verifier.verify(sign({ ...good(), iss: 'https://evil' })), /issuer/);
  await assert.rejects(verifier.verify(sign({ ...good(), aud: 'other' })), /audience/);
  await assert.rejects(verifier.verify(sign({ ...good(), token_use: 'access' })), /token_use/);
});

test('rejects alg=none and garbage', async () => {
  await assert.rejects(verifier.verify(sign(good(), { alg: 'none' })), /alg/);
  await assert.rejects(verifier.verify('not-a-jwt'), /JWS/);
});
