'use strict';
// Input validation with JSON Schema (ajv). Every route declares a schema for its
// body, query string and path params. Unknown fields are rejected
// (additionalProperties: false), types/ranges/lengths are enforced, and the
// failure reason is logged server-side only: the client just gets 400 "Bad request".

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { badRequest } = require('./errors');

// Bodies: strict, no type coercion ("10" is not a number).
const ajvBody = new Ajv({ allErrors: true, coerceTypes: false, useDefaults: true, strict: true, strictRequired: false, multipleOfPrecision: 6 });
// Query strings and path params are always text, so numbers are coerced.
const ajvQuery = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true, strict: true, strictRequired: false, multipleOfPrecision: 6 });
addFormats(ajvBody);
addFormats(ajvQuery);

// Reusable schema fragments.
const uuid = { type: 'string', format: 'uuid' };
const safeText = (min, max) => ({
  type: 'string',
  minLength: min,
  maxLength: max,
  // Reject control characters and angle brackets: names/descriptions are plain text.
  pattern: '^[^<>\\u0000-\\u001F]*$',
});
const pagination = {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
};

const cache = new WeakMap();
function compile(ajv, schema) {
  if (!cache.has(schema)) cache.set(schema, ajv.compile(schema));
  return cache.get(schema);
}

function check(ajv, schema, data, where) {
  const validateFn = compile(ajv, schema);
  if (!validateFn(data)) {
    const fieldErrors = validateFn.errors.map((e) => `${where}${e.instancePath} ${e.message}`);
    throw badRequest(`Validation failed (${where})`, { fieldErrors });
  }
  return data;
}

/**
 * Express middleware: validate { body, query, params } against the given schemas.
 * Validated + defaulted values are stored on req.valid so controllers never read raw input.
 */
function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    req.valid = {};
    if (body) {
      if (req.body === undefined || req.body === null) throw badRequest('Missing JSON body');
      req.valid.body = check(ajvBody, body, structuredClone(req.body), 'body');
    }
    if (query) req.valid.query = check(ajvQuery, query, { ...req.query }, 'query');
    else if (Object.keys(req.query || {}).length) {
      throw badRequest('Unexpected query parameters', { keys: Object.keys(req.query) });
    }
    if (params) req.valid.params = check(ajvQuery, params, { ...req.params }, 'params');
    next();
  };
}

/** Validate a plain object (used for internal Lambda-to-Lambda payloads). */
function validateObject(schema, data, where = 'payload') {
  return check(ajvBody, schema, data, where);
}

module.exports = { validate, validateObject, uuid, safeText, pagination };
