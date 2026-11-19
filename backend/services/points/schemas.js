'use strict';
const { uuid, safeText, pagination } = require('../../shared/validate');

const customerRef = {
  type: 'object',
  required: ['customerId', 'businessId'],
  additionalProperties: false,
  properties: { customerId: uuid, businessId: uuid },
};

module.exports = {
  idParams: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: uuid } },

  earn: {
    type: 'object',
    required: ['customerId', 'purchaseAmount'],
    additionalProperties: false,
    properties: {
      customerId: uuid,
      // Money: positive, at most 2 decimals, hard ceiling (the earn rule may be lower).
      purchaseAmount: { type: 'number', exclusiveMinimum: 0, maximum: 1000000, multipleOf: 0.01 },
    },
  },

  idempotencyHeader: uuid,

  history: {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerId: uuid,
      type: { type: 'string', enum: ['EARN', 'ADJUST', 'VOID', 'REDEEM', 'REFUND', 'CLOSE'] },
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
      ...pagination,
    },
  },

  reversal: {
    type: 'object',
    required: ['reason'],
    additionalProperties: false,
    properties: { reason: safeText(5, 200) },
  },

  adjustment: {
    type: 'object',
    required: ['customerId', 'pointsDelta', 'reason'],
    additionalProperties: false,
    properties: {
      customerId: uuid,
      pointsDelta: { type: 'integer', minimum: -10000, maximum: 10000, not: { const: 0 } },
      reason: safeText(5, 200),
    },
  },

  earnRule: {
    type: 'object',
    required: ['pointsPerUnit', 'maxPurchase', 'dailyPointsCap'],
    additionalProperties: false,
    properties: {
      pointsPerUnit: { type: 'number', exclusiveMinimum: 0, maximum: 100, multipleOf: 0.01 },
      maxPurchase: { type: 'number', exclusiveMinimum: 0, maximum: 1000000, multipleOf: 0.01 },
      dailyPointsCap: { type: 'integer', minimum: 1, maximum: 1000000 },
    },
  },

  days: {
    type: 'object',
    additionalProperties: false,
    properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
  },

  // internal
  customerRef,
  debit: {
    type: 'object',
    required: ['customerId', 'businessId', 'points', 'redemptionId', 'createdBy'],
    additionalProperties: false,
    properties: {
      customerId: uuid,
      businessId: uuid,
      points: { type: 'integer', minimum: 1, maximum: 1000000 },
      redemptionId: uuid,
      createdBy: { type: 'string', minLength: 1, maxLength: 64 },
      reason: { type: 'string', maxLength: 200 },
    },
  },
  close: {
    type: 'object',
    required: ['customerId', 'businessId', 'closedBy'],
    additionalProperties: false,
    properties: { customerId: uuid, businessId: uuid, closedBy: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  summary: {
    type: 'object',
    required: ['businessId'],
    additionalProperties: false,
    properties: { businessId: uuid, days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
  },
};
