'use strict';
const { uuid, safeText, pagination } = require('../../shared/validate');

const rewardFields = {
  name: safeText(2, 80),
  description: safeText(0, 500),
  pointsCost: { type: 'integer', minimum: 1, maximum: 1000000 },
  stock: { type: 'integer', minimum: 0, maximum: 100000 },
  maxPerCustomerMonth: { type: 'integer', minimum: 1, maximum: 100 },
};
const voucherCode = { type: 'string', pattern: '^LH-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{2}$' };

module.exports = {
  idParams: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: uuid } },

  createReward: {
    type: 'object',
    required: ['name', 'pointsCost', 'stock'],
    additionalProperties: false,
    properties: rewardFields,
  },
  updateReward: { type: 'object', minProperties: 1, additionalProperties: false, properties: rewardFields },

  listRewards: {
    type: 'object',
    additionalProperties: false,
    properties: { status: { type: 'string', enum: ['active', 'retired'], default: 'active' }, ...pagination },
  },

  redeem: {
    type: 'object',
    required: ['rewardId'],
    additionalProperties: false,
    properties: { rewardId: uuid, customerId: uuid },
  },

  listRedemptions: {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerId: uuid,
      status: { type: 'string', enum: ['ISSUED', 'FULFILLED', 'CANCELLED'] },
      voucherCode,
      ...pagination,
    },
  },

  changeRedemptionStatus: {
    type: 'object',
    required: ['status'],
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['FULFILLED', 'CANCELLED'] },
      voucherCode,
      reason: safeText(5, 200),
    },
    // FULFILLED needs the code the customer shows; CANCELLED needs a reason.
    allOf: [
      { if: { properties: { status: { const: 'FULFILLED' } } }, then: { required: ['voucherCode'] } },
      { if: { properties: { status: { const: 'CANCELLED' } } }, then: { required: ['reason'] } },
    ],
  },

  report: {
    type: 'object',
    required: ['from', 'to'],
    additionalProperties: false,
    properties: {
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
      format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
    },
  },

  dashboard: {
    type: 'object',
    additionalProperties: false,
    properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
  },

  internalCustomerRef: {
    type: 'object',
    required: ['customerId', 'businessId'],
    additionalProperties: false,
    properties: { customerId: uuid, businessId: uuid },
  },

  emailMessage: {
    type: 'object',
    required: ['redemptionId', 'businessId'],
    additionalProperties: false,
    properties: { redemptionId: uuid, businessId: uuid },
  },
};
