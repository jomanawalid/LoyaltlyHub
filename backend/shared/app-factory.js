'use strict';
// Builds the Express app used by every service, so all three behave the same:
// security headers, CORS allow-list, body limits, request logging, a public
// /api/health route, a JSON 404, and ONE error handler that logs full details
// server-side but only returns generic messages to the client.

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { AppError, toClientBody } = require('./errors');
const { logger, runWithContext } = require('./logger');
const { PG } = require('./db');

function corsOptions() {
  // CORS is NOT a security control: it only stops *browsers* on other sites from
  // reading our responses. curl/Postman ignore it. Real protection = Cognito token
  // + role + ownership checks. We still keep it tight: only our frontend origin.
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, false); // non-browser client: no CORS headers needed
      return cb(null, config.corsOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replay'],
    maxAge: 600,
  };
}

function requestContext(req, res, next) {
  const requestId =
    req.lambdaRequestId || req.headers['x-amzn-requestid'] || req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  req.requestId = requestId;
  runWithContext({ requestId }, () => next());
}

function accessLog(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const fields = {
      method: req.method,
      route: req.route ? req.baseUrl + req.route.path : req.path, // route pattern, no ids or query strings
      status: res.statusCode,
      latencyMs: Number(process.hrtime.bigint() - start) / 1e6,
    };
    if (res.statusCode === 401 || res.statusCode === 403) logger.security('HTTP_DENIED', fields);
    else if (res.statusCode >= 500) logger.error('HTTP_5XX', fields);
    else logger.info('HTTP_REQUEST', fields);
  });
  next();
}

function requireJsonForWrites(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0') {
    if (!req.is('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Content-Type was ${req.headers['content-type']}`);
    }
  }
  next();
}

function notFoundHandler(req, res) {
  logger.warn('ROUTE_NOT_FOUND', { method: req.method, path: req.path });
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.requestId } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;
  // Translate well-known library/database errors into safe client errors.
  if (err.type === 'entity.parse.failed') error = new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body');
  else if (err.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Body over limit');
  else if (err.code === PG.UNIQUE_VIOLATION) error = new AppError(409, 'DUPLICATE', `Unique constraint: ${err.constraint}`);
  else if (err.code === PG.CHECK_VIOLATION) error = new AppError(409, 'RULE_VIOLATION', `Check constraint: ${err.constraint}`);
  else if (err.code === '22P02') error = new AppError(400, 'VALIDATION_ERROR', 'Invalid input syntax for a column');

  const { status, body } = toClientBody(error, req.requestId);
  // Full detail goes to OUR logs only (CloudWatch). Secrets are redacted by the logger.
  const logFields = { status, code: body.error.code, reason: error.message, details: error.details, method: req.method, path: req.path };
  if (status >= 500) logger.error('UNHANDLED_ERROR', { ...logFields, err });
  else logger.warn('REQUEST_REJECTED', logFields);

  if (res.headersSent) return;
  res.status(status).json(body);
}

/**
 * @param {object}   opts
 * @param {string}   opts.serviceName  customers | points | rewards | dev
 * @param {Array}    opts.routers      express.Router instances mounted under /api
 */
function createApp({ serviceName, routers }) {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME || serviceName;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('query parser', 'simple'); // no nested objects from ?a[b]=c

  app.use(requestContext);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(cors(corsOptions()));
  app.use(accessLog);
  app.use(requireJsonForWrites);
  app.use(express.json({ limit: '10kb', strict: true }));

  // Public health check. Returns no data, so it is safe without a token.
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: serviceName, runtime: config.isLambda ? 'lambda' : 'pc' });
  });

  for (const router of routers) app.use('/api', router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, errorHandler };
