'use strict';
// Lambda entry point (handler = services/customers/lambda.handler).
// HTTP events from API Gateway -> Express app. Internal events from Points/Rewards -> internal.js.
const { createHandler } = require('../../shared/lambda-handler');
const app = require('./app');
const internal = require('./internal');

module.exports.handler = createHandler(app, internal);
