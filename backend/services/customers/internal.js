'use strict';
// Internal actions other services may call (via lambda:Invoke). Each lists which
// caller is allowed. These are NOT reachable from API Gateway.

const repo = require('./repository');
const service = require('./service');
const tiers = require('./tiers');
const schemas = require('./schemas');
const { notFound } = require('../../shared/errors');

async function load(businessId, customerId) {
  const c = await repo.findById(businessId, customerId);
  if (!c) throw notFound('Customer not found', { customerId });
  return c;
}

module.exports = {
  // Points asks before every earn; Rewards asks before every redemption.
  getMembership: {
    allowedCallers: ['points', 'rewards'],
    schema: schemas.internalCustomerRef,
    handler: async ({ customerId, businessId }) => {
      const c = await load(businessId, customerId);
      return { status: c.status, tier: c.tier, multiplier: tiers.multiplierFor(c.tier) };
    },
  },

  // Points reports a successful earn: update activity date and re-evaluate the tier.
  applyEarnActivity: {
    allowedCallers: ['points'],
    schema: schemas.internalEarnActivity,
    handler: async ({ customerId, businessId, points12m }) => {
      const c = await load(businessId, customerId);
      await repo.touchActivity(businessId, customerId);
      const decision = await service.evaluateTier(businessId, c, points12m);
      return { tier: decision.tier, changed: decision.changed, multiplier: tiers.multiplierFor(decision.tier) };
    },
  },

  // The e-mail worker needs the address to send the voucher e-mail.
  getContact: {
    allowedCallers: ['rewards', 'rewards-notifier'],
    schema: schemas.internalCustomerRef,
    handler: async ({ customerId, businessId }) => {
      const c = await load(businessId, customerId);
      return { fullName: c.fullName, email: c.email, status: c.status };
    },
  },

  // Owner dashboard (Rewards) shows membership numbers next to redemption numbers.
  getActiveMembersSummary: {
    allowedCallers: ['rewards'],
    schema: schemas.internalSummary,
    handler: async ({ businessId, days }) => repo.membershipReport(businessId, days),
  },
};
