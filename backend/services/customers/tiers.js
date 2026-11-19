'use strict';
// Membership tier engine + engagement segments (pure functions, no I/O, fully unit-tested).
//
// Business rules (agreed with the team, documented in docs/api.md):
//  - Tier is based on points EARNED in the last 12 months (redemptions do not reduce it).
//      BRONZE 0-999 (x1.00)   SILVER 1,000-4,999 (x1.25)   GOLD 5,000+ (x1.50)
//  - The multiplier is applied by the Points service on every purchase.
//  - Upgrades apply immediately. Downgrades drop ONE level at a time and only if the
//    tier has not changed in the last 30 days (grace period, so one quiet month does
//    not punish a loyal customer).
//  - Engagement: ACTIVE (activity in last 30 days), AT_RISK (31-90), LAPSED (>90 or never).

const TIERS = [
  { name: 'BRONZE', min: 0, multiplier: 1.0 },
  { name: 'SILVER', min: 1000, multiplier: 1.25 },
  { name: 'GOLD', min: 5000, multiplier: 1.5 },
];
const GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function rank(tierName) {
  const i = TIERS.findIndex((t) => t.name === tierName);
  if (i < 0) throw new Error(`Unknown tier ${tierName}`);
  return i;
}

function tierForPoints(points12m) {
  if (!Number.isInteger(points12m) || points12m < 0) throw new Error('points12m must be a non-negative integer');
  let result = TIERS[0];
  for (const t of TIERS) if (points12m >= t.min) result = t;
  return result.name;
}

function multiplierFor(tierName) {
  return TIERS[rank(tierName)].multiplier;
}

/**
 * Decide the tier to store after an evaluation.
 * @returns {{ tier: string, changed: boolean, direction: 'up'|'down'|'none' }}
 */
function decideTier(currentTier, points12m, lastChangedAt, now = new Date()) {
  const earned = tierForPoints(points12m);
  const cur = rank(currentTier);
  const target = rank(earned);
  if (target > cur) return { tier: earned, changed: true, direction: 'up' };
  if (target < cur) {
    const since = lastChangedAt ? now - new Date(lastChangedAt) : Infinity;
    if (since < GRACE_DAYS * DAY_MS) return { tier: currentTier, changed: false, direction: 'none' };
    return { tier: TIERS[cur - 1].name, changed: true, direction: 'down' };
  }
  return { tier: currentTier, changed: false, direction: 'none' };
}

/** How far the customer is from the next tier (for the profile page). */
function progress(points12m) {
  const current = tierForPoints(points12m);
  const next = TIERS[rank(current) + 1];
  return {
    tier: current,
    nextTier: next ? next.name : null,
    pointsToNextTier: next ? next.min - points12m : 0,
  };
}

function engagementSegment(lastActivityAt, now = new Date()) {
  if (!lastActivityAt) return 'LAPSED';
  const days = (now - new Date(lastActivityAt)) / DAY_MS;
  if (days <= 30) return 'ACTIVE';
  if (days <= 90) return 'AT_RISK';
  return 'LAPSED';
}

module.exports = { TIERS, GRACE_DAYS, tierForPoints, multiplierFor, decideTier, progress, engagementSegment };
