'use strict';
const service = require('./service');

module.exports = {
  async list(req, res) {
    res.status(200).json(await service.browseRewards(req.user, req.valid.query));
  },
  async create(req, res) {
    const reward = await service.createReward(req.user, req.valid.body);
    res.status(201).location(`/api/rewards/${reward.rewardId}`).json(reward);
  },
  async update(req, res) {
    res.status(200).json(await service.updateReward(req.user, req.valid.params.id, req.valid.body));
  },
  async retire(req, res) {
    await service.retireReward(req.user, req.valid.params.id);
    res.status(204).end();
  },
  async redeem(req, res) {
    res.status(201).json(await service.redeem(req.user, req.valid.body, req.requestId));
  },
  async listRedemptions(req, res) {
    res.status(200).json(await service.listRedemptions(req.user, req.valid.query));
  },
  async changeStatus(req, res) {
    res.status(200).json(await service.changeRedemptionStatus(req.user, req.valid.params.id, req.valid.body));
  },
  async report(req, res) {
    res.status(200).json(await service.redemptionReport(req.user, req.valid.query));
  },
  async dashboard(req, res) {
    res.status(200).json(await service.ownerDashboard(req.user, req.valid.query.days));
  },
};
