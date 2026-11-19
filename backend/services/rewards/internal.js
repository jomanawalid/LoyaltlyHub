'use strict';
// Internal actions for other services (lambda:Invoke only).
const repo = require('./repository');
const schemas = require('./schemas');

module.exports = {
  // Customers' erasure workflow refuses to erase someone who still holds unused vouchers.
  countOpenVouchers: {
    allowedCallers: ['customers'],
    schema: schemas.internalCustomerRef,
    handler: async ({ businessId, customerId }) => ({ openVouchers: await repo.countOpenVouchers(businessId, customerId) }),
  },
};
