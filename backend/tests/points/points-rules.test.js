'use strict';
// Owner: Jana. Earn calculation, limits, voids and staff-abuse flags.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../services/points/rules');

test('points = floor(amount x rate x tier multiplier), no floating point drift', () => {
  assert.equal(rules.calculateEarnPoints(250, 1, 1), 250);
  assert.equal(rules.calculateEarnPoints(99.99, 1, 1), 99);
  assert.equal(rules.calculateEarnPoints(100, 1, 1.25), 125);
  assert.equal(rules.calculateEarnPoints(0.3, 10, 1), 3); // 0.1+0.2 style issue avoided
  assert.equal(rules.calculateEarnPoints(80, 1.5, 1.5), 180);
  assert.throws(() => rules.calculateEarnPoints(0, 1));
});

test('earn limits: max purchase, too small, daily cap', () => {
  const base = { maxPurchase: 1000, dailyCap: 500, earnedToday: 0 };
  assert.equal(rules.checkEarnLimits({ ...base, purchaseAmount: 1500, points: 1500 }), 'PURCHASE_OVER_LIMIT');
  assert.equal(rules.checkEarnLimits({ ...base, purchaseAmount: 0.5, points: 0 }), 'PURCHASE_TOO_SMALL');
  assert.equal(rules.checkEarnLimits({ ...base, purchaseAmount: 300, points: 300, earnedToday: 300 }), 'DAILY_CAP_REACHED');
  assert.equal(rules.checkEarnLimits({ ...base, purchaseAmount: 200, points: 200, earnedToday: 300 }), null);
});

test('adjustments never make the balance negative and cannot be zero', () => {
  assert.equal(rules.adjustmentAllowed(100, -100), true);
  assert.equal(rules.adjustmentAllowed(100, -101), false);
  assert.equal(rules.adjustmentAllowed(100, 0), false);
});

test('void rules', () => {
  assert.equal(rules.voidCheck({ type: 'REDEEM', pointsDelta: -200 }, 500), 'NOT_VOIDABLE');
  assert.equal(rules.voidCheck({ type: 'EARN', pointsDelta: 250, voidedBy: 'x' }, 500), 'ALREADY_VOIDED');
  assert.equal(rules.voidCheck({ type: 'EARN', pointsDelta: 250 }, 50), 'POINTS_ALREADY_SPENT');
  assert.equal(rules.voidCheck({ type: 'EARN', pointsDelta: 250 }, 250), null);
  assert.equal(rules.voidCheck({ type: 'ADJUST', pointsDelta: -50 }, 0), null); // voiding a negative adjust adds points back
});

test('staff-abuse flags', () => {
  const rows = [
    { staffId: 'a', earns: 10, pointsGiven: 1000, voidedEarns: 5, adjustments: 0, voids: 0 },
    { staffId: 'b', earns: 15, pointsGiven: 300, voidedEarns: 0, adjustments: 0, voids: 0 },
  ];
  const [a, b] = rules.flagStaff(rows);
  assert.ok(a.flags.includes('VOID_RATE'));
  assert.ok(a.flags.includes('HIGH_SHARE'));
  assert.deepEqual(b.flags, []);
});
