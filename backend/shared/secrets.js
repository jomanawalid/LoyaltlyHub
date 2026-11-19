'use strict';
// Reads secrets at runtime from AWS Secrets Manager (Floci or real AWS).
// - On Lambda: the function's IAM role allows secretsmanager:GetSecretValue on
//   ONLY the secrets that function needs (see infra/iam/*-policy.json).
// - On your laptop: values come from backend/.env (never committed).
// Values are cached in memory for 5 minutes so we do not call Secrets Manager
// on every request, and they are never logged.

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('./config');

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();
let client;

function sm() {
  if (!client) client = new SecretsManagerClient({ region: config.region });
  return client;
}

/**
 * @param {string} secretId   Secrets Manager secret name, e.g. loyalty/database-url
 * @param {string} localEnvVar Name of the .env variable used in local development
 */
async function getSecret(secretId, localEnvVar) {
  if (!config.isLambda && localEnvVar && process.env[localEnvVar]) {
    return process.env[localEnvVar];
  }
  const hit = cache.get(secretId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const res = await sm().send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = res.SecretString;
  if (!value) throw new Error(`Secret ${secretId} is empty`);
  cache.set(secretId, { value, expires: Date.now() + TTL_MS });
  return value;
}

function getDatabaseUrl() {
  return getSecret(config.secrets.database, 'DATABASE_URL');
}

function getBrevoApiKey() {
  return getSecret(config.secrets.brevo, 'BREVO_API_KEY');
}

module.exports = { getSecret, getDatabaseUrl, getBrevoApiKey };
