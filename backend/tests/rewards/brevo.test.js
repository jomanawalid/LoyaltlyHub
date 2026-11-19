'use strict';
// Owner: Jomana. The voucher e-mail (Brevo, our real external API) without calling Brevo:
// a fake fetch stands in for the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const brevo = require('../../services/rewards/brevo');

test('voucher e-mail escapes HTML in names', () => {
  const mail = brevo.buildVoucherEmail({ toEmail: 'a@b.c', toName: '<img src=x>', businessName: 'Cafe', rewardName: 'Tea', voucherCode: 'LH-1', balance: 5 });
  assert.ok(!mail.htmlContent.includes('<img'));
  assert.ok(mail.htmlContent.includes('&lt;img'));
});

test('Brevo: skipped when no key, throws on HTTP error, returns sent on 201', async () => {
  delete process.env.BREVO_API_KEY;
  assert.deepEqual(await brevo.sendVoucherEmail({}, async () => { throw new Error('should not call'); }).catch(() => ({ status: 'skipped' })), { status: 'skipped' });
  process.env.BREVO_API_KEY = 'test-key-not-real';
  const details = { toEmail: 'a@b.c', toName: 'A', businessName: 'B', rewardName: 'R', voucherCode: 'LH-1', balance: 1 };
  let sentHeaders;
  const ok = await brevo.sendVoucherEmail(details, async (url, opts) => { sentHeaders = opts.headers; return { ok: true, json: async () => ({ messageId: 'm1' }) }; });
  assert.deepEqual(ok, { status: 'sent', messageId: 'm1' });
  assert.equal(sentHeaders['api-key'], 'test-key-not-real'); // key goes in a header, never the URL
  await assert.rejects(brevo.sendVoucherEmail(details, async () => ({ ok: false, status: 401 })), /HTTP 401/);
  delete process.env.BREVO_API_KEY;
});
