'use strict';
// Internal actions for other services (lambda:Invoke only, never through API Gateway).
const repo = require('./repository');
const service = require('./service');
const schemas = require('./schemas');

module.exports = {
  // Rewards: take the reward's cost from the balance (conditional: balance >= cost).
  debitPoints: {
    allowedCallers: ['rewards'],
    schema: schemas.debit,
    handler: (p) => service.debitForRedemption(p),
  },
  // Rewards: give points back if a redemption fails or is cancelled.
  creditPoints: {
    allowedCallers: ['rewards'],
    schema: schemas.debit,
    handler: (p) => service.refundRedemption(p),
  },
  getBalance: {
    allowedCallers: ['customers', 'rewards', 'rewards-notifier'],
    schema: schemas.customerRef,
    handler: async ({ businessId, customerId }) => {
      const acct = await repo.getAccount(businessId, customerId);
      return { balance: acct ? acct.balance : 0, status: acct ? acct.status : 'open' };
    },
  },
  // Customers' tier engine.
  getEarnSummary: {
    allowedCallers: ['customers'],
    schema: schemas.customerRef,
    handler: ({ businessId, customerId }) => repo.earnSummary(businessId, customerId),
  },
  // Customers' erasure workflow.
  closeAccount: {
    allowedCallers: ['customers'],
    schema: schemas.close,
    handler: ({ businessId, customerId, closedBy }) => repo.closeAccount(businessId, customerId, closedBy),
  },
  // Owner dashboard (Rewards).
  getPointsSummary: {
    allowedCallers: ['rewards'],
    schema: schemas.summary,
    handler: ({ businessId, days }) => repo.businessSummary(businessId, days),
  },
};
