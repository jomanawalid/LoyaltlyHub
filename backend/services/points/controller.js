'use strict';
const service = require('./service');
const { validateObject } = require('../../shared/validate');
const schemas = require('./schemas');

module.exports = {
  async earn(req, res) {
    // Idempotency-Key is required: without it a double-click would add points twice.
    const key = validateObject(schemas.idempotencyHeader, req.get('Idempotency-Key'), 'header Idempotency-Key');
    const result = await service.earnPoints(req.user, req.valid.body, key, req.requestId);
    if (result.replayed) res.set('Idempotent-Replay', 'true');
    res.status(result.replayed ? 200 : 201).json(result);
  },
  async balance(req, res) {
    res.status(200).json(await service.getBalance(req.user, req.valid.params.id));
  },
  async history(req, res) {
    res.status(200).json(await service.getHistory(req.user, req.valid.query));
  },
  async reverse(req, res) {
    res.status(201).json(await service.voidTransaction(req.user, req.valid.params.id, req.valid.body));
  },
  async adjust(req, res) {
    res.status(201).json(await service.adjustPoints(req.user, req.valid.body));
  },
  async getRule(req, res) {
    res.status(200).json(await service.getEarnRule(req.user));
  },
  async putRule(req, res) {
    res.status(200).json(await service.updateEarnRule(req.user, req.valid.body));
  },
  async staffActivity(req, res) {
    res.status(200).json(await service.staffActivityReport(req.user, req.valid.query.days));
  },
};
