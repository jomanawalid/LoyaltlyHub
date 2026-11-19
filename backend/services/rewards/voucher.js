'use strict';
// Voucher codes and redemption rules (pure, unit-tested).
const crypto = require('node:crypto');

// No 0/O/1/I/L so codes are easy to read out loud at the counter.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. LH-7KQ2-MX9P-R4 (cryptographically random, ~50 bits). */
function generateVoucherCode() {
  let raw = '';
  for (let i = 0; i < 10; i += 1) raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `LH-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Staff lists show only the last 2 characters; the customer sees the full code. */
function maskVoucher(code) {
  return code ? `LH-****-****-${code.slice(-2)}` : code;
}

/** Redemption status workflow: ISSUED -> FULFILLED, ISSUED -> CANCELLED. Both final. */
const TRANSITIONS = { ISSUED: ['FULFILLED', 'CANCELLED'], FULFILLED: [], CANCELLED: [] };
function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

/** Why a reward cannot be redeemed right now, or null if it can. */
function redeemBlocker(reward, recentCount) {
  if (reward.status !== 'active') return 'REWARD_RETIRED';
  if (reward.stock <= 0) return 'OUT_OF_STOCK';
  if (recentCount >= reward.maxPerCustomerMonth) return 'REDEMPTION_LIMIT_REACHED';
  return null;
}

/** Minimal CSV writer: quotes every field and neutralises spreadsheet formulas (CSV injection). */
function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
}

module.exports = { generateVoucherCode, maskVoucher, canTransition, redeemBlocker, toCsv, ALPHABET };
