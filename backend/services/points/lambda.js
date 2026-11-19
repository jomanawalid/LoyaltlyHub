'use strict';
// Lambda entry point (handler = services/points/lambda.handler).
const { createHandler } = require('../../shared/lambda-handler');
const app = require('./app');
const internal = require('./internal');

module.exports.handler = createHandler(app, internal);
