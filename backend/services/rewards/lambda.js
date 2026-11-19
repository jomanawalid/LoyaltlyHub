'use strict';
// Lambda entry point (handler = services/rewards/lambda.handler).
// The e-mail worker is a second Lambda: handler = services/rewards/notifier.handler.
const { createHandler } = require('../../shared/lambda-handler');
const app = require('./app');
const internal = require('./internal');

module.exports.handler = createHandler(app, internal);
