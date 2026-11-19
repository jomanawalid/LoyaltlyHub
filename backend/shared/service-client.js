'use strict';
// Calls another service's internal action.
//  - On AWS/Floci: lambda:Invoke (RequestResponse). The caller's IAM role must allow
//    lambda:InvokeFunction on exactly that target function (least privilege).
//  - Locally (dev-server.js, LOCAL_SERVICE_CALLS=true): calls the action in-process,
//    through the same validation and caller checks.
// Errors come back as { ok:false, error:{status, code} } and are re-thrown as AppError,
// so e.g. Points' 409 INSUFFICIENT_POINTS reaches the Rewards client unchanged.

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const config = require('./config');
const { AppError } = require('./errors');
const { logger } = require('./logger');
const { INTERNAL_SOURCE, runInternalAction } = require('./lambda-handler');

let lambda;
const localRegistry = {}; // service name -> actions (filled by dev-server.js)

function registerLocalService(name, actions) {
  localRegistry[name] = actions;
}

async function invoke(target, event) {
  if (config.localServiceCalls) {
    const actions = localRegistry[target];
    if (!actions) throw new Error(`Local service ${target} not registered`);
    return runInternalAction(actions, event, event.requestId);
  }
  if (!lambda) lambda = new LambdaClient({ region: config.region });
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: config.functions[target],
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
  if (res.FunctionError) throw new Error(`${target} raised ${res.FunctionError}`);
  return JSON.parse(Buffer.from(res.Payload).toString('utf8'));
}

/**
 * @param {string} caller   name of the calling service (checked against allowedCallers)
 * @param {'customers'|'points'|'rewards'} target
 * @param {string} action   e.g. 'debitPoints'
 * @param {object} payload
 * @param {object} [opts]   { requestId }
 */
async function callService(caller, target, action, payload, opts = {}) {
  const event = { source: INTERNAL_SOURCE, caller, action, payload, requestId: opts.requestId };
  const started = Date.now();
  let result;
  try {
    result = await invoke(target, event);
  } catch (err) {
    logger.error('SERVICE_CALL_FAILED', { target, action, err });
    throw new AppError(502, 'UPSTREAM_ERROR', `Call to ${target}.${action} failed: ${err.message}`);
  }
  logger.info('SERVICE_CALL', { target, action, ok: result && result.ok, ms: Date.now() - started });
  if (!result || !result.ok) {
    const status = (result && result.error && result.error.status) || 502;
    const code = (result && result.error && result.error.code) || 'UPSTREAM_ERROR';
    throw new AppError(status, code, `${target}.${action} answered ${status} ${code}`);
  }
  return result.data;
}

/** Bind the caller name once per service: const callService = serviceClient('rewards'). */
function serviceClient(caller) {
  return (target, action, payload, opts) => callService(caller, target, action, payload, opts);
}

module.exports = { serviceClient, registerLocalService };
