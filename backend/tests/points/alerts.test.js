'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publishAlert } = require('../../shared/alerts');
const { handler, describe } = require('../../services/points/alert-handler');

test('publishAlert does nothing (and does not fail) when no topic is configured', async () => {
  assert.equal(await publishAlert('TRANSACTION_VOIDED', { transactionId: 'x' }), false);
});

test('alert handler understands Points alerts and CloudWatch alarms', async () => {
  const points = describe(JSON.stringify({ kind: 'POINTS_ADJUSTED', customerId: 'c1', by: 'sub1' }));
  assert.equal(points.source, 'points-service');
  assert.equal(points.kind, 'POINTS_ADJUSTED');
  const alarm = describe(JSON.stringify({ AlarmName: 'loyalty-server-errors', NewStateValue: 'ALARM' }));
  assert.deepEqual(alarm, { source: 'cloudwatch-alarm', alarm: 'loyalty-server-errors', state: 'ALARM' });
  assert.equal(describe('not json').source, 'unknown');
  const out = await handler({ Records: [{ Sns: { Message: '{"kind":"X"}' } }, { Sns: { Message: 'plain' } }] });
  assert.equal(out.received, 2);
});
