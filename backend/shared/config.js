'use strict';
// Central configuration. Every value comes from the environment (Lambda env vars
// set by infra/scripts, or backend/.env on your laptop). Nothing secret lives here:
// secrets (DATABASE_URL, BREVO_API_KEY) are fetched at runtime from Secrets Manager
// by shared/secrets.js, or read from .env during local development only.

function list(value, fallback = '') {
  return String(value || fallback)
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
// On Floci, Lambda containers get AWS_ENDPOINT_URL injected automatically; the AWS SDK
// uses it without any code. On real AWS this is unset and the SDK uses real endpoints.
const awsEndpoint = process.env.AWS_ENDPOINT_URL || undefined;

const userPoolId = process.env.COGNITO_USER_POOL_ID || '';

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isLambda: Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
  region,
  awsEndpoint,

  // CORS allow-list: ONLY the deployed frontend origin(s). Not a security control on its own.
  corsOrigins: list(process.env.CORS_ORIGINS, 'http://localhost:8080'),

  cognito: {
    userPoolId,
    clientId: process.env.COGNITO_CLIENT_ID || '',
    // The issuer must match the "iss" claim inside the token exactly.
    // Real AWS: https://cognito-idp.<region>.amazonaws.com/<poolId>
    // Floci:    http://localhost:4566/<poolId>
    issuer:
      process.env.COGNITO_ISSUER ||
      (userPoolId ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` : ''),
    // Where to download the public signing keys. Inside a Floci Lambda container
    // "localhost" is the container itself, so we use AWS_ENDPOINT_URL instead.
    jwksUri:
      process.env.COGNITO_JWKS_URI ||
      (userPoolId
        ? `${awsEndpoint || `https://cognito-idp.${region}.amazonaws.com`}/${userPoolId}/.well-known/jwks.json`
        : ''),
  },

  // Names of the other Lambda functions (service-to-service calls).
  functions: {
    customers: process.env.CUSTOMERS_FUNCTION || 'loyalty-customers-api',
    points: process.env.POINTS_FUNCTION || 'loyalty-points-api',
    rewards: process.env.REWARDS_FUNCTION || 'loyalty-rewards-api',
  },

  // Secrets Manager secret names (values are never in env vars on Lambda).
  secrets: {
    database: process.env.DB_SECRET_ID || 'loyalty/database-url',
    brevo: process.env.BREVO_SECRET_ID || 'loyalty/brevo-api-key',
  },

  idempotencyTable: process.env.IDEMPOTENCY_TABLE || 'LoyaltyIdempotency',
  emailQueueUrl: process.env.EMAIL_QUEUE_URL || '',
  alertTopicArn: process.env.ALERT_TOPIC_ARN || '',
  reportsBucket: process.env.REPORTS_BUCKET || 'loyalty-reports-private',
  emailSender: process.env.EMAIL_SENDER || 'no-reply@loyaltyhub.example',

  // Local development: run all three services in one process (dev-server.js)
  // and call each other in-process instead of through Lambda.
  localServiceCalls: process.env.LOCAL_SERVICE_CALLS === 'true',
};

module.exports = config;
