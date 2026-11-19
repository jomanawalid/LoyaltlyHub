'use strict';
// External API integration (owner: Jomana): Brevo transactional e-mail (https://developers.brevo.com).
// Real job in the app: after a redemption, the customer receives the voucher code,
// reward name and remaining points by e-mail.
// The API key is read from AWS Secrets Manager at runtime (never in code, env files
// on Lambda, the repository or logs). Only the notifier Lambda's IAM role can read it.

const config = require('../../shared/config');
const { getBrevoApiKey } = require('../../shared/secrets');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function buildVoucherEmail({ toEmail, toName, businessName, rewardName, voucherCode, balance }) {
  const subject = `Your ${businessName} voucher: ${rewardName}`;
  const text =
    `Hi ${toName},\n\nYou redeemed "${rewardName}". Show this code at the counter: ${voucherCode}\n` +
    `Points remaining: ${balance}.\n\nThank you for being a ${businessName} member.`;
  const html =
    `<p>Hi ${escapeHtml(toName)},</p><p>You redeemed <strong>${escapeHtml(rewardName)}</strong>.</p>` +
    `<p>Show this code at the counter:</p><p style="font-size:22px;font-family:monospace">${escapeHtml(voucherCode)}</p>` +
    `<p>Points remaining: ${Number(balance)}</p><p>Thank you for being a ${escapeHtml(businessName)} member.</p>`;
  return {
    sender: { email: config.emailSender, name: businessName },
    to: [{ email: toEmail, name: toName }],
    subject,
    textContent: text,
    htmlContent: html,
  };
}

/**
 * @returns {Promise<{ status: 'sent'|'skipped', messageId?: string }>}
 * Throws on HTTP/network errors so the SQS message is retried.
 */
async function sendVoucherEmail(details, fetchFn = globalThis.fetch) {
  const apiKey = (await getBrevoApiKey().catch(() => '')).trim();
  if (!apiKey || apiKey === 'disabled') return { status: 'skipped' };

  const res = await fetchFn(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(buildVoucherEmail(details)),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    // Status only: Brevo's error body can echo request data, so it is not logged.
    throw new Error(`Brevo answered HTTP ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  return { status: 'sent', messageId: body.messageId };
}

module.exports = { sendVoucherEmail, buildVoucherEmail, escapeHtml };
