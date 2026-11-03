'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_no_real_api';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_no_real_api';
const pool = require('../database/db');

const intents = new Map();
let seq = 0;
const fakeStripe = {
  paymentIntents: {
    async create(input) {
      const id = 'pi_mock' + (++seq);
      const row = {
        id, client_secret: id + '_secret',
        status: 'succeeded', currency: input.currency,
        metadata: input.metadata, amount: input.amount, amount_received: input.amount
      };
      intents.set(id, row);
      return row;
    },
    async retrieve(id) {
      if (!intents.has(id)) throw new Error('Mock provider intent missing');
      return intents.get(id);
    },
    async cancel(id) {
      const row = intents.get(id);
      if (row) row.status = 'canceled';
      return row;
    }
  },
  webhooks: {
    constructEvent(raw, signature) {
      if (!Buffer.isBuffer(raw) || signature !== 'sig-ok') throw new Error('Mock invalid signature');
      return JSON.parse(raw.toString('utf8'));
    }
  }
};
const stripePath = require.resolve('stripe');
require(stripePath);
const originalStripe = require.cache[stripePath].exports;
require.cache[stripePath].exports = () => fakeStripe;
const paymentRouter = require('../server/routes/payments');
require.cache[stripePath].exports = originalStripe;
let server, base;

before(async () => {
  await pool.query('DROP TABLE IF EXISTS audit_logs, transactions, wallets, users CASCADE');
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY, user_type text NOT NULL, email text, full_name text, role text, is_active boolean NOT NULL DEFAULT true)');
  await pool.query("CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id), balance numeric(15,2) NOT NULL DEFAULT 0, total_deposits numeric(15,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD')");
  await pool.query('CREATE TABLE transactions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), transaction_type text, amount numeric(15,2), currency text, status text, payment_method text, external_id text, completed_at timestamp)');
  const app = express();
  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use('/api/payments', paymentRouter);
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

async function person(balance = '0.00', currency = 'USD') {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id, user_type) VALUES ($1,'investor')", [id]);
  await pool.query('INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)', [id, balance, currency]);
  return { id, token: jwt.sign({ userId: id }, process.env.JWT_SECRET) };
}
async function post(path, token, body) {
  const response = await fetch(base + '/api/payments/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
async function balance(id) {
  const r = await pool.query('SELECT balance, total_deposits FROM wallets WHERE user_id=$1', [id]);
  return r.rows[0];
}
async function create(user, amount = '12.34') {
  const response = await post('create-intent', user.token, { amount, currency: 'USD' });
  assert.equal(response.status, 201);
  return {
    transactionId: response.body.transactionId,
    paymentIntentId: response.body.clientSecret.split('_secret')[0]
  };
}

test('payment is settled exactly once under concurrent confirmations', async () => {
  const user = await person('1.00');
  const ids = await create(user, '12.34');
  const both = await Promise.all([
    post('confirm', user.token, ids),
    post('confirm', user.token, ids)
  ]);
  assert.deepEqual(both.map(x => x.status), [200, 200]);
  assert.equal(both.filter(x => x.body.alreadyConfirmed === true).length, 1);
  assert.deepEqual(await balance(user.id), { balance: '13.34', total_deposits: '12.34' });
  const r = await pool.query('SELECT status,external_id FROM transactions WHERE id=$1', [ids.transactionId]);
  assert.equal(r.rows[0].status, 'completed');
  assert.equal(r.rows[0].external_id, ids.paymentIntentId);
});

test('another user cannot claim a successful intent', async () => {
  const sender = await person();
  const attacker = await person();
  const ids = await create(sender, '8.88');
  const response = await post('confirm', attacker.token, ids);
  assert.equal(response.status, 400);
  assert.equal((await balance(attacker.id)).balance, '0.00');
  assert.equal((await balance(sender.id)).balance, '0.00');
});

test('rejects mismatched provider amount and keeps transaction pending', async () => {
  const user = await person();
  const ids = await create(user, '6.66');
  const intent = intents.get(ids.paymentIntentId);
  intent.amount_received = 1;
  const response = await post('confirm', user.token, ids);
  assert.equal(response.status, 400);
  assert.equal((await balance(user.id)).balance, '0.00');
  const r = await pool.query('SELECT status FROM transactions WHERE id=$1', [ids.transactionId]);
  assert.equal(r.rows[0].status, 'pending');
});

test('failed wallet update rolls settlement back; no completed transaction', async () => {
  const user = await person();
  const ids = await create(user, '5.10');
  await pool.query('DELETE FROM wallets WHERE user_id=$1', [user.id]);
  const response = await post('confirm', user.token, ids);
  assert.equal(response.status, 500);
  const r = await pool.query('SELECT status FROM transactions WHERE id=$1', [ids.transactionId]);
  assert.equal(r.rows[0].status, 'pending');
});

test('negative and non-USD requests never create a Stripe intent', async () => {
  const user = await person();
  const count = intents.size;
  assert.equal((await post('create-intent', user.token, { amount: -3, currency: 'USD' })).status, 400);
  assert.equal((await post('create-intent', user.token, { amount: 3, currency: 'EUR' })).status, 400);
  assert.equal(intents.size, count);
});

test('webhook validates original raw body and signature', async () => {
  const valid = await fetch(base + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig-ok' },
    body: JSON.stringify({ fake: 'yes' })
  });
  assert.equal(valid.status, 200);
  const invalid = await fetch(base + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 'wrong' },
    body: '{}'
  });
  assert.equal(invalid.status, 400);
});

async function webhook(intent, signature = 'sig-ok', type = 'payment_intent.succeeded') {
  const response = await fetch(base + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: JSON.stringify({ id: 'evt_mock', type, data: { object: intent } })
  });
  return { status: response.status, body: await response.json() };
}

test('signed success webhook credits exact USD deposit exactly once on replay', async () => {
  const user = await person('2.00');
  const ids = await create(user, '9.40');
  const intent = intents.get(ids.paymentIntentId);
  const first = await webhook(intent);
  const second = await webhook(intent);
  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyConfirmed, false);
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyConfirmed, true);
  assert.deepEqual(await balance(user.id), { balance: '11.40', total_deposits: '9.40' });
});

test('webhook and authenticated confirmation cannot double credit concurrently', async () => {
  const user = await person('0.00');
  const ids = await create(user, '10.25');
  const intent = intents.get(ids.paymentIntentId);
  const both = await Promise.all([
    webhook(intent),
    post('confirm', user.token, ids)
  ]);
  assert.deepEqual(both.map(x => x.status).sort(), [200, 200]);
  assert.equal(both.filter(x => x.body.alreadyConfirmed).length, 1);
  assert.deepEqual(await balance(user.id), { balance: '10.25', total_deposits: '10.25' });
});

test('signed webhook metadata mismatch and wrong amount cannot credit a wallet', async () => {
  const user = await person();
  const ids = await create(user, '7.25');
  const intent = intents.get(ids.paymentIntentId);
  const alteredOwner = { ...intent, metadata: { ...intent.metadata, userId: randomUUID() } };
  assert.equal((await webhook(alteredOwner)).status, 404);
  const alteredAmount = { ...intent, amount_received: 1 };
  assert.equal((await webhook(alteredAmount)).status, 400);
  assert.equal((await balance(user.id)).balance, '0.00');
  const r=await pool.query('SELECT status FROM transactions WHERE id = $1', [ids.transactionId]);
  assert.equal(r.rows[0].status,'pending');
});

test('invalid signature cannot settle, and unrelated or refund events never silently adjust balances', async () => {
  const user = await person('3.00');
  const ids = await create(user, '12.00');
  const intent = intents.get(ids.paymentIntentId);
  assert.equal((await webhook(intent,'incorrect')).status, 400);
  const refund = await webhook(intent,'sig-ok','charge.refunded');
  assert.equal(refund.status, 200);
  assert.equal(refund.body.processed, false);
  assert.equal((await balance(user.id)).balance, '3.00');
});
