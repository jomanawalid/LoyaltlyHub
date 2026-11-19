'use strict';
// E-mail worker Lambda (owner: Jomana -- customer communication) (handler = services/rewards/notifier.handler), triggered by the
// SQS queue loyalty-email-queue. Why a queue: the redemption answers the customer
// immediately, and a slow or failing Brevo API never blocks or breaks a redemption.
// Failed messages are retried by SQS (up to 3 receives), then moved to the dead-letter
// queue loyalty-email-dlq, and the redemption shows email_status = failed.

const repo = require('./repository');
const brevo = require('./brevo');
const schemas = require('./schemas');
const callService = require('../../shared/service-client').serviceClient('rewards-notifier');
const { validateObject } = require('../../shared/validate');
const { logger, runWithContext } = require('../../shared/logger');

const MAX_ATTEMPTS = 3;

/** Send the voucher e-mail for one redemption. Returns the final email_status. */
async function processMessage({ redemptionId, businessId }, attempt = 1) {
  const r = await repo.findForEmail(businessId, redemptionId);
  if (!r) {
    logger.warn('EMAIL_REDEMPTION_MISSING', { redemptionId });
    return 'skipped';
  }
  if (r.emailStatus === 'sent') return 'sent'; // SQS can deliver twice: never e-mail twice

  const contact = await callService('customers', 'getContact', { customerId: r.customerId, businessId });
  if (!contact.email) {
    await repo.setEmailStatus(redemptionId, 'skipped');
    return 'skipped';
  }
  const { balance } = await callService('points', 'getBalance', { customerId: r.customerId, businessId }).catch(() => ({
    balance: '-',
  }));
  try {
    const result = await brevo.sendVoucherEmail({
      toEmail: contact.email,
      toName: contact.fullName,
      businessName: r.businessName,
      rewardName: r.rewardName,
      voucherCode: r.voucherCode,
      balance,
    });
    await repo.setEmailStatus(redemptionId, result.status);
    logger.audit('VOUCHER_EMAIL', { redemptionId, status: result.status, messageId: result.messageId });
    return result.status;
  } catch (err) {
    logger.error('VOUCHER_EMAIL_FAILED', { redemptionId, attempt, reason: err.message });
    if (attempt >= MAX_ATTEMPTS) {
      await repo.setEmailStatus(redemptionId, 'failed');
      return 'failed';
    }
    throw err; // let SQS retry
  }
}

/** SQS batch handler with partial batch failure reporting. */
async function handler(event, context) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    await runWithContext({ requestId: context && context.awsRequestId }, async () => {
      try {
        const message = validateObject(schemas.emailMessage, JSON.parse(record.body), 'sqs message');
        const attempt = Number(record.attributes && record.attributes.ApproximateReceiveCount) || 1;
        await processMessage(message, attempt);
      } catch (err) {
        logger.error('EMAIL_MESSAGE_FAILED', { messageId: record.messageId, reason: err.message });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }
  return { batchItemFailures };
}

module.exports = { handler, processMessage };
