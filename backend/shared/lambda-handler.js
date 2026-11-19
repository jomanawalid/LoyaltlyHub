'use strict';
// One Lambda entry point per service that accepts two kinds of events:
//  1. HTTP events from API Gateway (payload v2.0) -> run the Express app (serverless-http).
//  2. Internal service-to-service events sent with lambda:Invoke by another of OUR
//     Lambdas, e.g. Rewards -> Points "debitPoints". These never come from the internet:
//     API Gateway always builds events with requestContext.http, and only the roles in
//     infra/iam/*-policy.json are allowed lambda:InvokeFunction on this function.

const serverless = require('serverless-http');
const { AppError, toClientBody } = require('./errors');
const { logger, runWithContext } = require('./logger');
const { validateObject } = require('./validate');

const INTERNAL_SOURCE = 'loyalty.internal';

function isInternalEvent(event) {
  return event && event.source === INTERNAL_SOURCE && !event.requestContext;
}

/**
 * Run one internal action. Shared by Lambda and by the local dev-server (in-process calls).
 * @param {object} actions  { actionName: { allowedCallers: [...], schema, handler } }
 */
async function runInternalAction(actions, event, requestId) {
  return runWithContext({ requestId: event.requestId || requestId }, async () => {
    const { action, caller, payload } = event;
    try {
      const def = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
      if (!def) throw new AppError(404, 'NOT_FOUND', `Unknown internal action ${action}`);
      if (!def.allowedCallers.includes(caller)) {
        logger.security('INTERNAL_CALLER_DENIED', { action, caller });
        throw new AppError(403, 'FORBIDDEN', `Caller ${caller} may not run ${action}`);
      }
      const input = def.schema ? validateObject(def.schema, payload || {}) : payload;
      const data = await def.handler(input, { caller });
      logger.info('INTERNAL_CALL_OK', { action, caller });
      return { ok: true, data };
    } catch (err) {
      const { status, body } = toClientBody(err, event.requestId);
      if (status >= 500) logger.error('INTERNAL_CALL_FAILED', { action, caller, err });
      else logger.warn('INTERNAL_CALL_REJECTED', { action, caller, status, code: body.error.code, reason: err.message });
      return { ok: false, error: { status, code: body.error.code } };
    }
  });
}

function createHandler(app, internalActions = {}) {
  const http = serverless(app, {
    request(req, event, context) {
      req.lambdaRequestId = context && context.awsRequestId;
    },
  });
  return async (event, context) => {
    if (isInternalEvent(event)) return runInternalAction(internalActions, event, context.awsRequestId);
    return http(event, context);
  };
}

module.exports = { createHandler, runInternalAction, INTERNAL_SOURCE };
