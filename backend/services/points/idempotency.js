'use strict';
// Idempotency store in Amazon DynamoDB (owner: Jana).
// Why: a staff member double-clicks "Add points", or the network retries the POST.
// The client sends an Idempotency-Key header (a UUID). The first request with that key
// does the work; a repeat with the same key gets the SAME answer back without adding
// points again. Records expire automatically after 24 h (DynamoDB TTL on expiresAt).
// The Postgres unique index on (business_id, idempotency_key) is the second safety net.

const crypto = require('node:crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const config = require('../../shared/config');
const { conflict } = require('../../shared/errors');

const TTL_SECONDS = 24 * 60 * 60;
let doc;
function ddb() {
  if (!doc) doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));
  return doc;
}

function fingerprint(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Claim the key. Returns { replay: storedResponse } if this key already finished,
 * or { pk } if the caller should do the work now.
 */
async function begin(businessId, key, body) {
  const pk = `${businessId}#${key}`;
  const fp = fingerprint(body);
  try {
    await ddb().send(
      new PutCommand({
        TableName: config.idempotencyTable,
        Item: { pk, status: 'IN_PROGRESS', fingerprint: fp, expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return { pk };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
  const { Item } = await ddb().send(new GetCommand({ TableName: config.idempotencyTable, Key: { pk } }));
  if (!Item) return begin(businessId, key, body); // expired between the two calls
  if (Item.fingerprint !== fp) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Same key used with a different body');
  if (Item.status === 'IN_PROGRESS') throw conflict('REQUEST_IN_PROGRESS', 'Duplicate request still running');
  return { replay: JSON.parse(Item.response) };
}

async function complete(pk, response) {
  await ddb().send(
    new UpdateCommand({
      TableName: config.idempotencyTable,
      Key: { pk },
      UpdateExpression: 'SET #s = :done, #r = :resp',
      ExpressionAttributeNames: { '#s': 'status', '#r': 'response' },
      ExpressionAttributeValues: { ':done': 'COMPLETED', ':resp': JSON.stringify(response) },
    }),
  );
}

/** The work failed: release the key so the client may retry. */
async function release(pk) {
  await ddb().send(new DeleteCommand({ TableName: config.idempotencyTable, Key: { pk } }));
}

module.exports = { begin, complete, release, fingerprint };
