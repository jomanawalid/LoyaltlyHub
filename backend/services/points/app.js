'use strict';
const { createApp } = require('../../shared/app-factory');
const router = require('./routes');

module.exports = createApp({ serviceName: 'points', routers: [router] });
