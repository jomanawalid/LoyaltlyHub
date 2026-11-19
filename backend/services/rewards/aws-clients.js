'use strict';
// AWS integrations owned by the Rewards service (Habiba):
//  - Amazon SQS: queue the voucher e-mail for the notifier Lambda.
//  - Amazon S3 (PRIVATE bucket, not the public website bucket): store CSV reports and
//    hand the owner a pre-signed download link that expires after 5 minutes.

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../../shared/config');
const { logger } = require('../../shared/logger');

let sqs;
let s3;
let presignS3;

// Floci returns queue URLs with "localhost", which inside a Lambda container is the
// container itself. Point the URL at the endpoint the SDK uses (AWS_ENDPOINT_URL).
function resolveQueueUrl() {
  if (!config.awsEndpoint) return config.emailQueueUrl;
  return config.awsEndpoint.replace(/\/$/, '') + new URL(config.emailQueueUrl).pathname;
}

async function enqueueVoucherEmail(message) {
  if (config.localServiceCalls && !config.emailQueueUrl) {
    // Local dev without a queue: run the worker in-process after the response is sent.
    const { processMessage } = require('./notifier');
    setImmediate(() => processMessage(message).catch((err) => logger.error('LOCAL_EMAIL_FAILED', { err })));
    return;
  }
  if (!sqs) sqs = new SQSClient({ region: config.region });
  await sqs.send(new SendMessageCommand({ QueueUrl: resolveQueueUrl(), MessageBody: JSON.stringify(message) }));
}

const PRESIGN_SECONDS = 300;

async function storeReportAndSign(businessId, csv) {
  if (!s3) s3 = new S3Client({ region: config.region, forcePathStyle: Boolean(config.awsEndpoint) });
  const key = `reports/${businessId}/redemptions-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.reportsBucket,
      Key: key,
      Body: csv,
      ContentType: 'text/csv; charset=utf-8',
      ServerSideEncryption: 'AES256', // encryption at rest
    }),
  );
  // On Floci the Lambda reaches S3 at an internal address the browser cannot open,
  // so the link is signed for the public endpoint instead (REPORTS_PUBLIC_ENDPOINT).
  if (!presignS3) {
    presignS3 = new S3Client({
      region: config.region,
      forcePathStyle: Boolean(config.awsEndpoint),
      endpoint: process.env.REPORTS_PUBLIC_ENDPOINT || config.awsEndpoint,
    });
  }
  const url = await getSignedUrl(presignS3, new GetObjectCommand({ Bucket: config.reportsBucket, Key: key }), {
    expiresIn: PRESIGN_SECONDS,
  });
  return { downloadUrl: url, expiresIn: PRESIGN_SECONDS, key };
}

module.exports = { enqueueVoucherEmail, storeReportAndSign };
