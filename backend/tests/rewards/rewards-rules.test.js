'use strict';
// Owner: Habiba. Vouchers, redemption rules and CSV safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../services/rewards/voucher');

test('voucher codes: format, readable alphabet, unique', () => {
  const codes = new Set(Array.from({ length: 2000 }, () => v.generateVoucherCode()));
  assert.equal(codes.size, 2000);
  for (const c of codes) assert.match(c, /^LH-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{2}$/);
  assert.equal(v.maskVoucher('LH-ABCD-EFGH-JK'), 'LH-****-****-JK');
});

test('redemption status workflow', () => {
  assert.equal(v.canTransition('ISSUED', 'FULFILLED'), true);
  assert.equal(v.canTransition('ISSUED', 'CANCELLED'), true);
  assert.equal(v.canTransition('FULFILLED', 'CANCELLED'), false);
  assert.equal(v.canTransition('CANCELLED', 'FULFILLED'), false);
});

test('redeem blockers: retired, out of stock, monthly limit', () => {
  const r = { status: 'active', stock: 3, maxPerCustomerMonth: 2 };
  assert.equal(v.redeemBlocker(r, 0), null);
  assert.equal(v.redeemBlocker({ ...r, status: 'retired' }, 0), 'REWARD_RETIRED');
  assert.equal(v.redeemBlocker({ ...r, stock: 0 }, 0), 'OUT_OF_STOCK');
  assert.equal(v.redeemBlocker(r, 2), 'REDEMPTION_LIMIT_REACHED');
});

test('CSV export neutralises formula injection and quotes', () => {
  const csv = v.toCsv([{ name: '=HYPERLINK("http://evil")', n: 3 }, { name: 'Say "hi"', n: 1 }], ['name', 'n']);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(csv.includes('"Say ""hi"""'));
});
