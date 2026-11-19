'use strict';
// HTTP layer for Customers & Membership: read validated input from req.valid,
// call the service, send the status code. No business rules and no SQL here.

const service = require('./service');

module.exports = {
  async register(req, res) {
    const result = await service.registerCustomer(req.user, req.valid.body);
    res.status(201).location(`/api/customers/${result.customer.customerId}`).json(result);
  },
  async search(req, res) {
    res.status(200).json(await service.searchCustomers(req.user, req.valid.query));
  },
  async getOne(req, res) {
    res.status(200).json(await service.getCustomer(req.user, req.valid.params.id));
  },
  async update(req, res) {
    res.status(200).json(await service.updateCustomer(req.user, req.valid.params.id, req.valid.body));
  },
  async changeStatus(req, res) {
    res.status(200).json(await service.changeStatus(req.user, req.valid.params.id, req.valid.body));
  },
  async erase(req, res) {
    await service.eraseCustomer(req.user, req.valid.params.id);
    res.status(204).end();
  },
  async membership(req, res) {
    res.status(200).json(await service.getMembership(req.user, req.valid.params.id));
  },
  async me(req, res) {
    res.status(200).json(await service.getMe(req.user));
  },
  async activeMembers(req, res) {
    res.status(200).json(await service.activeMembersReport(req.user, req.valid.query.days));
  },
};
