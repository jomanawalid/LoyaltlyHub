'use strict';
// Authentication + authorization middleware shared by all three services.
//
// Identity comes ONLY from the verified Cognito token, never from the request body:
//   role       <- "cognito:groups"     (Owner | Staff | Customer)
//   businessId <- "custom:business_id" (tenant isolation: every SQL query filters by it)
//   customerId <- "custom:customer_id" (ownership: customers only see their own records)

const config = require('./config');
const { JwtVerifier } = require('./jwt');
const { unauthorized, forbidden } = require('./errors');
const { logger, setContextFields } = require('./logger');

const ROLES = Object.freeze({ OWNER: 'Owner', STAFF: 'Staff', CUSTOMER: 'Customer' });
const ROLE_PRIORITY = [ROLES.OWNER, ROLES.STAFF, ROLES.CUSTOMER];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let verifier;
function getVerifier() {
  if (!verifier) {
    verifier = new JwtVerifier({
      issuer: config.cognito.issuer,
      audience: config.cognito.clientId,
      jwksUri: config.cognito.jwksUri,
      tokenUse: 'id',
    });
  }
  return verifier;
}

/** Tests replace the verifier with a fake one. */
function setVerifierForTests(fake) {
  verifier = fake;
}

function claimsToUser(claims) {
  const groups = Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [];
  const role = ROLE_PRIORITY.find((r) => groups.includes(r));
  const businessId = claims['custom:business_id'];
  const customerId = claims['custom:customer_id'] || null;
  if (!role) throw new Error('user is in no application group');
  if (!businessId || !UUID_RE.test(businessId)) throw new Error('token has no valid business_id');
  if (role === ROLES.CUSTOMER && (!customerId || !UUID_RE.test(customerId))) {
    throw new Error('customer token has no valid customer_id');
  }
  return { sub: claims.sub, email: claims.email, role, businessId, customerId };
}

/** Requires a valid Bearer token. Sets req.user. 401 otherwise. */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header);
  if (!match) {
    logger.security('AUTH_MISSING_TOKEN', { path: req.path, method: req.method, ip: req.ip });
    throw unauthorized('Missing or malformed Authorization header');
  }
  let claims;
  try {
    claims = await getVerifier().verify(match[1]);
  } catch (err) {
    logger.security('AUTH_INVALID_TOKEN', { reason: err.message, path: req.path, method: req.method, ip: req.ip });
    throw unauthorized(`Token rejected: ${err.message}`);
  }
  try {
    req.user = claimsToUser(claims);
  } catch (err) {
    logger.security('AUTH_BAD_CLAIMS', { reason: err.message, sub: claims.sub });
    throw forbidden(`Token claims rejected: ${err.message}`);
  }
  setContextFields({ userSub: req.user.sub, role: req.user.role, businessId: req.user.businessId });
  next();
}

/** Allow only the listed roles. 403 otherwise (enforced in the backend, not just by hiding buttons). */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) throw unauthorized('requireRole used before authenticate');
    if (!allowed.includes(req.user.role)) {
      logger.security('AUTHZ_ROLE_DENIED', { required: allowed, path: req.path, method: req.method });
      throw forbidden(`Role ${req.user.role} not allowed`, { allowed });
    }
    next();
  };
}

/**
 * Ownership check: a Customer may only act on their own customerId.
 * Staff and Owner may act on any customer, but business isolation still applies
 * because every query also filters by req.user.businessId.
 */
function assertCustomerAccess(user, customerId) {
  if (user.role === ROLES.CUSTOMER && user.customerId !== customerId) {
    logger.security('AUTHZ_OWNERSHIP_DENIED', { requestedCustomerId: customerId, ownCustomerId: user.customerId });
    throw forbidden('Customer tried to access another customer\'s data');
  }
}

module.exports = { ROLES, authenticate, requireRole, assertCustomerAccess, claimsToUser, setVerifierForTests };
