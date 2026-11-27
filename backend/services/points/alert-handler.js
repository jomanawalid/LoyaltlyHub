'use strict';
// (owner: Jana) Lambda subscribed to the SNS topic loyalty-alerts. Receives alerts from the
// Points service (voids, adjustments, flagged staff) and CloudWatch alarms, and writes
// one structured SECURITY log line per alert so it is searchable in CloudWatch Logs.

const { logger } = require('../../shared/logger');

function describe(message) {
  let body;
  try {
    body = JSON.parse(message);
  } catch {
    return { source: 'unknown', note: String(message).slice(0, 200) };
  }
  if (body && body.AlarmName) {
    return { source: 'cloudwatch-alarm', alarm: body.AlarmName, state: body.NewStateValue };
  }
  return {
    source: 'points-service',
    kind: body.kind,
    businessId: body.businessId,
    customerId: body.customerId,
    transactionId: body.transactionId,
    by: body.by,
  };
}

async function handler(event) {
  const records = (event && event.Records) || [];
  for (const record of records) {
    const sns = record.Sns || {};
    logger.security('ALERT_RECEIVED', describe(sns.Message));
  }
  return { received: records.length };
}

module.exports = { handler, describe };
