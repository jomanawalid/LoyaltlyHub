'use strict';
// Customers & Membership Express app (no app.listen: Lambda and dev-server use it).
const { createApp } = require('../../shared/app-factory');
const router = require('./routes');

module.exports = createApp({ serviceName: 'customers', routers: [router] });
