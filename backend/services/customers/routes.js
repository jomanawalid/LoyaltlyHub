'use strict';
// Customers & Membership routes. Each line reads: who may call it (authenticate +
// requireRole, enforced HERE in the backend), what input is accepted (validate),
// and which controller handles it.

const express = require('express');
const { authenticate, requireRole, ROLES } = require('../../shared/auth');
const { validate } = require('../../shared/validate');
const schemas = require('./schemas');
const c = require('./controller');

const { OWNER, STAFF, CUSTOMER } = ROLES;
const router = express.Router();

router.use(['/customers', '/me', '/reports/active-members'], authenticate);

router.post('/customers', requireRole(STAFF, OWNER), validate({ body: schemas.register }), c.register);
router.get('/customers', requireRole(STAFF, OWNER), validate({ query: schemas.search }), c.search);
router.get('/customers/:id', requireRole(STAFF, OWNER, CUSTOMER), validate({ params: schemas.idParams }), c.getOne);
router.put('/customers/:id', requireRole(STAFF, OWNER), validate({ params: schemas.idParams, body: schemas.update }), c.update);
router.patch(
  '/customers/:id/status',
  requireRole(OWNER),
  validate({ params: schemas.idParams, body: schemas.statusChange }),
  c.changeStatus,
);
router.delete('/customers/:id', requireRole(OWNER), validate({ params: schemas.idParams }), c.erase);
router.get(
  '/customers/:id/membership',
  requireRole(STAFF, OWNER, CUSTOMER),
  validate({ params: schemas.idParams }),
  c.membership,
);
router.get('/me', requireRole(CUSTOMER), validate({}), c.me);
router.get('/reports/active-members', requireRole(OWNER), validate({ query: schemas.activeReport }), c.activeMembers);

module.exports = router;
