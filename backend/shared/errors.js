'use strict';
// One error type for the whole API. The client only ever sees a generic message
// for the status code ("Bad request", "Forbidden", ...) plus a safe machine code
// and the requestId. The real reason (logMessage + details) is logged server-side.

const GENERIC_MESSAGES = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  429: 'Too many requests',
  500: 'Internal server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
};

class AppError extends Error {
  /**
   * @param {number} status     HTTP status code
   * @param {string} code       Safe, stable code the frontend can switch on (e.g. INSUFFICIENT_POINTS)
   * @param {string} logMessage Detailed reason. Logged on the server, NEVER sent to the client.
   * @param {object} [details]  Extra context for the logs (field errors, ids). NEVER sent to the client.
   */
  constructor(status, code, logMessage, details) {
    super(logMessage || code);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500; // 4xx codes are safe to show; 5xx always become INTERNAL_ERROR
  }
}

const badRequest = (log, details) => new AppError(400, 'VALIDATION_ERROR', log, details);
const unauthorized = (log) => new AppError(401, 'UNAUTHORIZED', log);
const forbidden = (log, details) => new AppError(403, 'FORBIDDEN', log, details);
const notFound = (log, details) => new AppError(404, 'NOT_FOUND', log, details);
const conflict = (code, log, details) => new AppError(409, code || 'CONFLICT', log, details);

function genericMessage(status) {
  return GENERIC_MESSAGES[status] || GENERIC_MESSAGES[500];
}

/** Shape every error response the same way: { error: { code, message, requestId } } */
function toClientBody(err, requestId) {
  const status = err && err.status ? err.status : 500;
  const code = err instanceof AppError && err.expose ? err.code : 'INTERNAL_ERROR';
  return {
    status: err instanceof AppError ? status : 500,
    body: { error: { code, message: genericMessage(err instanceof AppError ? status : 500), requestId } },
  };
}

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  genericMessage,
  toClientBody,
};
