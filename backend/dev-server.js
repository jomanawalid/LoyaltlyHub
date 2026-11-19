'use strict';
// Local development: runs all three services in ONE Express process on PORT (3000).
// Service-to-service calls run in-process (LOCAL_SERVICE_CALLS=true) through exactly
// the same internal actions, validation and caller checks used on Lambda.
// AWS services (Cognito, DynamoDB, SQS, S3, Secrets Manager) come from Floci on :4566.

require('dotenv').config({ quiet: true });
process.env.LOCAL_SERVICE_CALLS = process.env.LOCAL_SERVICE_CALLS || 'true';

const { createApp } = require('./shared/app-factory');
const { registerLocalService } = require('./shared/service-client');
const { logger } = require('./shared/logger');

registerLocalService('customers', require('./services/customers/internal'));
registerLocalService('rewards', require('./services/rewards/internal'));

const app = createApp({
  serviceName: 'dev',
  routers: [
    require('./services/customers/routes'),
    require('./services/rewards/routes'),
  ],
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  logger.info('DEV_SERVER_STARTED', { port, corsOrigins: process.env.CORS_ORIGINS });
  console.log(`LoyaltyHub API running on http://localhost:${port}/api/health`);
});
