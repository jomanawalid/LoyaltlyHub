// Reads the public settings written by env.js. No secrets ever live in the frontend:
// everything in this folder is downloadable by anyone from the public S3 bucket.
const env = window.LOYALTY_ENV || {};

export const config = Object.freeze({
  apiUrl: String(env.apiUrl || 'http://localhost:3000').replace(/\/$/, ''),
  cognitoEndpoint: String(env.cognitoEndpoint || 'http://localhost:4566').replace(/\/$/, ''),
  cognitoClientId: env.cognitoClientId || '',
});
