'use strict';
// Owner: Jomana. Tier engine, engagement segments and the status workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const tiers = require('../../services/customers/tiers');
const { canTransition } = require('../../services/customers/status-workflow');

const DAY = 864e5;

test('tier thresholds: Bronze < 1000 <= Silver < 5000 <= Gold', () => {
  assert.equal(tiers.tierForPoints(0), 'BRONZE');
  assert.equal(tiers.tierForPoints(999), 'BRONZE');
  assert.equal(tiers.tierForPoints(1000), 'SILVER');
  assert.equal(tiers.tierForPoints(4999), 'SILVER');
  assert.equal(tiers.tierForPoints(5000), 'GOLD');
  assert.throws(() => tiers.tierForPoints(-1));
});

test('multipliers used by the Points service', () => {
  assert.equal(tiers.multiplierFor('BRONZE'), 1);
  assert.equal(tiers.multiplierFor('SILVER'), 1.25);
  assert.equal(tiers.multiplierFor('GOLD'), 1.5);
});

test('upgrades apply immediately (even two levels)', () => {
  assert.deepEqual(tiers.decideTier('BRONZE', 6000, new Date()), { tier: 'GOLD', changed: true, direction: 'up' });
});

test('downgrade waits for the 30-day grace period, then drops one level only', () => {
  const now = new Date();
  assert.equal(tiers.decideTier('GOLD', 10, new Date(now - 5 * DAY), now).changed, false);
  assert.deepEqual(tiers.decideTier('GOLD', 10, new Date(now - 31 * DAY), now), { tier: 'SILVER', changed: true, direction: 'down' });
});

test('progress to next tier', () => {
  assert.deepEqual(tiers.progress(250), { tier: 'BRONZE', nextTier: 'SILVER', pointsToNextTier: 750 });
  assert.deepEqual(tiers.progress(7000), { tier: 'GOLD', nextTier: null, pointsToNextTier: 0 });
});

test('engagement segments', () => {
  const now = new Date();
  assert.equal(tiers.engagementSegment(new Date(now - 3 * DAY), now), 'ACTIVE');
  assert.equal(tiers.engagementSegment(new Date(now - 45 * DAY), now), 'AT_RISK');
  assert.equal(tiers.engagementSegment(new Date(now - 120 * DAY), now), 'LAPSED');
  assert.equal(tiers.engagementSegment(null, now), 'LAPSED');
});

test('status workflow: only active<->suspended; erased is final', () => {
  assert.equal(canTransition('active', 'suspended'), true);
  assert.equal(canTransition('suspended', 'active'), true);
  assert.equal(canTransition('active', 'active'), false);
  assert.equal(canTransition('erased', 'active'), false);
  assert.equal(canTransition('active', 'erased'), false); // only through the DELETE erasure workflow
});
