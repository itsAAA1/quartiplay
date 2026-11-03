'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-test-secret';
const pool = require('../database/db');
const router = require('../server/routes/wallet');

let server;
let base;

before(async () => {
  // These tables exist ONLY in the disposable CI test database.
  await pool.query("CREATE TABLE users (id uuid PRIMARY KEY, user_type text NOT NULL, email text, full_name text, role text DEFAULT 'user', is_active boolean NOT NULL DEFAULT true)");
  await pool.query("CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES users(id), balance numeric(15,2) NOT NULL DEFAULT 0, total_withdrawals numeric(15,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD')");
  await pool.query("CREATE TABLE transactions (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), transaction_type text, amount numeric(15,2), currency text, status text)");
  await pool.query("CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), action text, resource_type text, resource_id text, new_values jsonb)");
  const app = express();
  app.use(express.json());
  app.use('/api/wallet', router);
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

async function person(balance, user_type = 'investor', currency = 'USD') {
  const id = randomUUID();
  await pool.query('INSERT INTO users (id, user_type) VALUES ($1, $2)', [id, user_type]);
  await pool.query('INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)', [id, balance, currency]);
  return { id, token: jwt.sign({ userId: id }, process.env.JWT_SECRET) };
}

async function post(path, token, data) {
  const response = await fetch(base + '/api/wallet/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(data)
  });
  return { status: response.status, body: await response.json() };
}

async function wallet(id) {
  const r = await pool.query('SELECT balance, total_withdrawals FROM wallets WHERE user_id = $1', [id]);
  return r.rows[0]; // pg numeric => decimal strings; do not compare as JS floats.
}

test('concurrent withdrawals can reserve funds at most once', async () => {
  const user = await person('100.00');
  const results = await Promise.all([
    post('withdraw', user.token, { amount: '80.00' }),
    post('withdraw', user.token, { amount: '80.00' })
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
  assert.equal((await wallet(user.id)).balance, '20.00');
  const txs = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [user.id]);
  assert.equal(txs.rowCount, 1);
  assert.equal(txs.rows[0].status, 'pending');
});

test('negative, zero and fractional subcent withdrawals are rejected', async () => {
  const user = await person('200.00');
  for (const amount of [-10, 0, '0.001', '12.123', 'bad']) {
    const result = await post('withdraw', user.token, { amount });
    assert.equal(result.status, 400);
  }
  assert.equal((await wallet(user.id)).balance, '200.00');
});

test('failed transaction insert rolls the wallet debit back', async () => {
  const user = await person('200.00');
  await pool.query('ALTER TABLE transactions ADD CONSTRAINT test_limit_amount CHECK (amount < 100)');
  try {
    const result = await post('withdraw', user.token, { amount: '120.00' });
    assert.equal(result.status, 500);
    assert.equal((await wallet(user.id)).balance, '200.00');
    const txs = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [user.id]);
    assert.equal(txs.rowCount, 0);
  } finally {
    await pool.query('ALTER TABLE transactions DROP CONSTRAINT test_limit_amount');
  }
});

test('internal transfer failure rolls both balances back', async () => {
  const admin = await person('50.25', 'admin');
  const recipient = await person('5.00');
  await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT test_reject_audit CHECK (action <> 'wallet.internal_transfer')");
  try {
    const result = await post('transfer', admin.token, { toUserId: recipient.id, amount: '20.10' });
    assert.equal(result.status, 500);
    assert.equal((await wallet(admin.id)).balance, '50.25');
    assert.equal((await wallet(recipient.id)).balance, '5.00');
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT test_reject_audit');
  }
});

test('internal transfer uses exact numeric amounts and writes audit record', async () => {
  const admin = await person('50.25', 'admin');
  const recipient = await person('5.00');
  const result = await post('transfer', admin.token, { toUserId: recipient.id, amount: '20.10' });
  assert.equal(result.status, 200);
  assert.equal((await wallet(admin.id)).balance, '30.15');
  assert.equal((await wallet(recipient.id)).balance, '25.10');
  const logs = await pool.query('SELECT new_values FROM audit_logs WHERE user_id = $1', [admin.id]);
  assert.equal(logs.rowCount, 1);
  assert.equal(logs.rows[0].new_values.amount, '20.10');
});

test('refuses missing recipient, mismatched currency and non-admin transfers', async () => {
  const admin = await person('40.00', 'admin', 'USD');
  const foreign = await person('1.00', 'investor', 'EUR');
  const stranger = await person('10.00');
  assert.equal((await post('transfer', admin.token, { toUserId: randomUUID(), amount: '10.00' })).status, 404);
  assert.equal((await post('transfer', admin.token, { toUserId: foreign.id, amount: '10.00' })).status, 400);
  assert.equal((await post('transfer', stranger.token, { toUserId: foreign.id, amount: '1.00' })).status, 403);
  assert.equal((await wallet(admin.id)).balance, '40.00');
  assert.equal((await wallet(foreign.id)).balance, '1.00');
});
