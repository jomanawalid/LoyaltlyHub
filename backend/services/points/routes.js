'use strict';
// Points & Transactions routes: role checks and validation enforced in the backend.
const express = require('express');
const { authenticate, requireRole, ROLES } = require('../../shared/auth');
const { validate } = require('../../shared/validate');
const schemas = require('./schemas');
const c = require('./controller');

const { OWNER, STAFF, CUSTOMER } = ROLES;
const router = express.Router();

router.use(['/transactions', '/customers/:id/balance', '/adjustments', '/earn-rules', '/reports/staff-activity'], authenticate);

router.post('/transactions', requireRole(STAFF, OWNER), validate({ body: schemas.earn }), c.earn);
router.get('/transactions', requireRole(STAFF, OWNER, CUSTOMER), validate({ query: schemas.history }), c.history);
router.get('/customers/:id/balance', requireRole(STAFF, OWNER, CUSTOMER), validate({ params: schemas.idParams }), c.balance);
router.post(
  '/transactions/:id/reversals',
  requireRole(OWNER),
  validate({ params: schemas.idParams, body: schemas.reversal }),
  c.reverse,
);
router.post('/adjustments', requireRole(OWNER), validate({ body: schemas.adjustment }), c.adjust);
router.get('/earn-rules', requireRole(STAFF, OWNER), validate({}), c.getRule);
router.put('/earn-rules', requireRole(OWNER), validate({ body: schemas.earnRule }), c.putRule);
router.get('/reports/staff-activity', requireRole(OWNER), validate({ query: schemas.days }), c.staffActivity);

module.exports = router;
