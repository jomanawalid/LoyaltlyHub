'use strict';
// Rewards & Redemption routes: role checks and validation enforced in the backend.
const express = require('express');
const { authenticate, requireRole, ROLES } = require('../../shared/auth');
const { validate } = require('../../shared/validate');
const schemas = require('./schemas');
const c = require('./controller');

const { OWNER, STAFF, CUSTOMER } = ROLES;
const router = express.Router();

router.use(['/rewards', '/redemptions', '/reports/redemptions', '/dashboard'], authenticate);

router.get('/rewards', requireRole(CUSTOMER, STAFF, OWNER), validate({ query: schemas.listRewards }), c.list);
router.post('/rewards', requireRole(OWNER), validate({ body: schemas.createReward }), c.create);
router.put('/rewards/:id', requireRole(OWNER), validate({ params: schemas.idParams, body: schemas.updateReward }), c.update);
router.delete('/rewards/:id', requireRole(OWNER), validate({ params: schemas.idParams }), c.retire);

router.post('/redemptions', requireRole(CUSTOMER, STAFF, OWNER), validate({ body: schemas.redeem }), c.redeem);
router.get('/redemptions', requireRole(CUSTOMER, STAFF, OWNER), validate({ query: schemas.listRedemptions }), c.listRedemptions);
router.patch(
  '/redemptions/:id/status',
  requireRole(STAFF, OWNER), // CANCELLED is further restricted to OWNER in the service
  validate({ params: schemas.idParams, body: schemas.changeRedemptionStatus }),
  c.changeStatus,
);

router.get('/reports/redemptions', requireRole(OWNER), validate({ query: schemas.report }), c.report);
router.get('/dashboard', requireRole(OWNER), validate({ query: schemas.dashboard }), c.dashboard);

module.exports = router;
