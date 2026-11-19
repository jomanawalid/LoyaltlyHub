'use strict';
// JSON Schemas for every Customers & Membership request (validated by shared/validate.js).
const { uuid, safeText, pagination } = require('../../shared/validate');

const email = { type: 'string', format: 'email', maxLength: 254 };
// Egyptian / international phone: optional +, 8-15 digits.
const phone = { type: 'string', pattern: '^\\+?[0-9]{8,15}$' };
const fullName = safeText(2, 100);

module.exports = {
  idParams: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: uuid } },

  register: {
    type: 'object',
    required: ['fullName', 'email', 'phone'],
    additionalProperties: false,
    properties: { fullName, email, phone },
  },

  update: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { fullName, email, phone },
  },

  statusChange: {
    type: 'object',
    required: ['status', 'reason'],
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['active', 'suspended'] },
      reason: safeText(5, 200),
    },
  },

  search: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: safeText(1, 100),
      status: { type: 'string', enum: ['active', 'suspended', 'erased'] },
      tier: { type: 'string', enum: ['BRONZE', 'SILVER', 'GOLD'] },
      ...pagination,
    },
  },

  activeReport: {
    type: 'object',
    additionalProperties: false,
    properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
  },

  // Internal (service-to-service) payloads
  internalCustomerRef: {
    type: 'object',
    required: ['customerId', 'businessId'],
    additionalProperties: false,
    properties: { customerId: uuid, businessId: uuid },
  },
  internalEarnActivity: {
    type: 'object',
    required: ['customerId', 'businessId', 'points12m'],
    additionalProperties: false,
    properties: { customerId: uuid, businessId: uuid, points12m: { type: 'integer', minimum: 0 } },
  },
  internalSummary: {
    type: 'object',
    required: ['businessId'],
    additionalProperties: false,
    properties: { businessId: uuid, days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
  },
};
