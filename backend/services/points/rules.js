'use strict';
// Points business rules (pure functions, no I/O, unit-tested in tests/points).

/**
 * Points for a purchase = floor(amount x pointsPerUnit x tierMultiplier).
 * Integer maths on hundredths avoids floating-point errors (e.g. 0.1 + 0.2).
 */
function calculateEarnPoints(purchaseAmount, pointsPerUnit, tierMultiplier = 1) {
  if (!(purchaseAmount > 0)) throw new Error('purchaseAmount must be > 0');
  const cents = Math.round(purchaseAmount * 100);
  const rate = Math.round(Number(pointsPerUnit) * 100);
  const mult = Math.round(Number(tierMultiplier) * 100);
  return Math.floor((cents * rate * mult) / 1_000_000);
}

/** Returns the reason code if the earn breaks a rule, otherwise null. */
function checkEarnLimits({ purchaseAmount, maxPurchase, points, earnedToday, dailyCap }) {
  if (purchaseAmount > Number(maxPurchase)) return 'PURCHASE_OVER_LIMIT';
  if (points < 1) return 'PURCHASE_TOO_SMALL';
  if (earnedToday + points > dailyCap) return 'DAILY_CAP_REACHED';
  return null;
}

/** A manual adjustment may never make the balance negative. */
function adjustmentAllowed(balance, delta) {
  return delta !== 0 && balance + delta >= 0;
}

/** Only EARN and ADJUST rows can be voided; the void must not make the balance negative. */
function voidCheck(original, balance) {
  if (!['EARN', 'ADJUST'].includes(original.type)) return 'NOT_VOIDABLE';
  if (original.voidedBy) return 'ALREADY_VOIDED';
  if (balance - original.pointsDelta < 0) return 'POINTS_ALREADY_SPENT';
  return null;
}

/**
 * Staff-abuse heuristics for the owner's staff-activity report (threat T10, repudiation/fraud):
 *  - VOID_RATE: more than 20% of a staff member's earns were later voided
 *  - HIGH_SHARE: one staff member gave more than 60% of all points (with 20+ earns overall)
 *  - LARGE_AVERAGE: average points per earn is more than 3x the business average
 */
function flagStaff(rows) {
  const totalPoints = rows.reduce((s, r) => s + r.pointsGiven, 0);
  const totalEarns = rows.reduce((s, r) => s + r.earns, 0);
  const avgAll = totalEarns ? totalPoints / totalEarns : 0;
  return rows.map((r) => {
    const flags = [];
    if (r.earns >= 5 && r.voidedEarns / r.earns > 0.2) flags.push('VOID_RATE');
    if (totalEarns >= 20 && totalPoints && r.pointsGiven / totalPoints > 0.6 && rows.length > 1) flags.push('HIGH_SHARE');
    if (r.earns >= 3 && avgAll && r.pointsGiven / r.earns > 3 * avgAll) flags.push('LARGE_AVERAGE');
    return { ...r, flags };
  });
}

module.exports = { calculateEarnPoints, checkEarnLimits, adjustmentAllowed, voidCheck, flagStaff };
