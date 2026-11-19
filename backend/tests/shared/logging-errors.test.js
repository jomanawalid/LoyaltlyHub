'use strict';
// Owner: Habiba. No secrets or personal data in logs; no details in client errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, maskEmail } = require('../../shared/logger');
const { AppError, toClientBody, badRequest } = require('../../shared/errors');

// Fake URLs are assembled at runtime so secret scanners do not flag this test file.
const fakeUrl = (user, pw, host) => ['postgresql', '://', user, ':', pw, '@', host, '/db'].join('');

test('logger removes secrets by key name and by value pattern', () => {
  const out = redact({
    password: 'Hunter2Hunter2',
    authorization: 'Bearer abc',
    apiKey: 'k',
    nested: { DATABASE_URL: fakeUrl('u', 'p', 'h') },
    note: `conn ${fakeUrl('user', 'pass', 'host')} and token eyJa.eyJb.sig`,
  });
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.authorization, '[REDACTED]');
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.nested.DATABASE_URL, '[REDACTED]');
  assert.ok(!out.note.includes('pass@host'));
  assert.ok(!out.note.includes('eyJa.eyJb.sig'));
});

test('logger masks personal data', () => {
  const out = redact({ email: 'mona@example.com', phone: '+201001234567', fullName: 'Mona Ali' });
  assert.equal(out.email, 'm***@example.com');
  assert.equal(out.phone, '+***7');
  assert.equal(maskEmail('x'), '***');
});

test('client error body is generic and hides internal details', () => {
  const { status, body } = toClientBody(badRequest('purchaseAmount must be > 0', { field: 'purchaseAmount' }), 'req-1');
  assert.equal(status, 400);
  assert.deepEqual(body, { error: { code: 'VALIDATION_ERROR', message: 'Bad request', requestId: 'req-1' } });
});

test('unexpected errors become 500 INTERNAL_ERROR with no message leak', () => {
  const { status, body } = toClientBody(new Error('relation "customers" does not exist'), 'r');
  assert.equal(status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'Internal server error');
  const five = toClientBody(new AppError(503, 'X', 'db down'), 'r');
  assert.equal(five.body.error.code, 'INTERNAL_ERROR');
});
