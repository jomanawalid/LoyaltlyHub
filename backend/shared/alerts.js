'use strict';
// (owner: Jana) Publishes business/security alerts to the SNS topic loyalty-alerts.
// Subscribers (infra/scripts/10-alerts.sh): the alert-handler Lambda, an SQS audit
// queue, and the team e-mail on real AWS. A failure here never breaks the user's request.
// Messages carry ids only: no names, e-mails, phone numbers or free-text reasons.

const config = require('./config');
const { logger } = require('./logger');

let sns;

async function publishAlert(kind, details = {}) {
  if (!config.alertTopicArn) return false; // local dev / tests: nothing to publish to
  try {
    const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
    sns = sns || new SNSClient({ region: config.region });
    await sns.send(
      new PublishCommand({
        TopicArn: config.alertTopicArn,
        Subject: `LoyaltyHub alert: ${kind}`.slice(0, 100),
        Message: JSON.stringify({ kind, at: new Date().toISOString(), ...details }),
        MessageAttributes: { kind: { DataType: 'String', StringValue: kind } },
      }),
    );
    logger.info('ALERT_PUBLISHED', { kind });
    return true;
  } catch (err) {
    logger.warn('ALERT_PUBLISH_FAILED', { kind, reason: err.name });
    return false;
  }
}

module.exports = { publishAlert };
