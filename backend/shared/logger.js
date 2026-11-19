'use strict';
// Structured JSON logger. On Lambda, every console line goes to CloudWatch Logs
// (/aws/lambda/<function>), where metric filters count SECURITY events and 5xx.
//
// Rules this file enforces:
//  - Never log passwords, tokens, API keys, connection strings or Authorization headers.
//  - Personal data (email, phone, name) is masked before it reaches a log line.
//  - Every line carries the requestId so one request can be followed across services.

const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();

// Keys whose values are removed entirely.
const SECRET_KEY = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|database[-_]?url|connection|credential|session|voucher[-_]?code)/i;
// Keys whose values are masked (personal data).
const PII_KEY = /^(email|phone|name|fullName|full_name)$/i;
// Values that look like secrets even if the key name is innocent.
const SECRET_VALUE = /(postgres(ql)?:\/\/\S+|xkeysib-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|AKIA[0-9A-Z]{16})/g;

function maskEmail(email) {
  const s = String(email);
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return `${s[0]}***@${s.slice(at + 1)}`;
}

function maskValue(key, value) {
  if (value == null) return value;
  if (/email/i.test(key)) return maskEmail(value);
  const s = String(value);
  return s.length <= 2 ? '**' : `${s[0]}***${s.slice(-1)}`;
}

function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), code: value.code, stack: redact(value.stack) };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) out[k] = '[REDACTED]';
      else if (PII_KEY.test(k)) out[k] = maskValue(k, v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level, msg, fields = {}) {
  const ctx = context.getStore() || {};
  const line = {
    level,
    time: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'local',
    requestId: ctx.requestId,
    userSub: ctx.userSub,
    role: ctx.role,
    businessId: ctx.businessId,
    msg,
    ...redact(fields),
  };
  const text = JSON.stringify(line);
  if (level === 'ERROR') console.error(text);
  else if (level === 'WARN' || level === 'SECURITY') console.warn(text);
  else console.log(text);
}

const logger = {
  info: (msg, fields) => write('INFO', msg, fields),
  warn: (msg, fields) => write('WARN', msg, fields),
  error: (msg, fields) => write('ERROR', msg, fields),
  /** Security-relevant event (401/403, failed ownership check, void, adjustment...). */
  security: (event, fields) => write('SECURITY', event, { event, ...fields }),
  /** Business audit event (points added, reward redeemed...). */
  audit: (action, fields) => write('AUDIT', action, { action, ...fields }),
};

/** Run fn with a request-scoped logging context. */
function runWithContext(store, fn) {
  return context.run(store, fn);
}

/** Add fields (e.g. user info after auth) to the current request's context. */
function setContextFields(fields) {
  const store = context.getStore();
  if (store) Object.assign(store, fields);
}

module.exports = { logger, redact, maskEmail, runWithContext, setContextFields };
