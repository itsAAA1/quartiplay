'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'isolated-auth-ci-secret-do-not-use-for-production';
process.env.JWT_EXPIRY = '1h';
const pool = require('../database/db');
const authRouter = require('../server/routes/auth');
const { authenticateToken, adminOnly } = require('../server/middleware/auth');

let server, base;
before(async () => {
  // Isolated CI service database, not an application or production database.
  await pool.query("CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, full_name text NOT NULL, user_type text NOT NULL, role text DEFAULT 'user', is_active boolean NOT NULL DEFAULT true)");
  await pool.query("CREATE TABLE investors (id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id), country text)");
  await pool.query("CREATE TABLE companies (id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id), company_name text NOT NULL)");
  await pool.query("CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id), balance numeric(15,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD')");
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.get('/api/protected', authenticateToken, (req, res) => res.json({ user: req.user }));
  app.get('/api/admin', authenticateToken, adminOnly, (req, res) => res.json({ ok: true }));
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

async function request(path, body, token, method = 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}
const register = (email, user_type = 'investor') => request('/api/auth/register',
  { email, password: 'passphrase-5678', full_name: 'Sample Person', user_type });

test('register investor atomically creates exactly one account, profile and zero-balance wallet', async () => {
  const response = await register('Investor.ONE@Example.COM ');
  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, 'investor.one@example.com');
  assert.ok(response.body.token);
  const id = response.body.user.userId;
  const q = await pool.query(
    "SELECT u.email, i.user_id AS investor, w.balance FROM users u LEFT JOIN investors i ON i.user_id=u.id LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=$1", [id]
  );
  assert.equal(q.rowCount, 1);
  assert.equal(q.rows[0].investor, id);
  assert.equal(q.rows[0].balance, '0.00');
});

test('register company creates profile and wallet in same transaction', async () => {
  const response = await register('company@Example.com', 'company');
  assert.equal(response.status, 201);
  const id = response.body.user.userId;
  const q = await pool.query(
    "SELECT c.company_name, w.balance FROM companies c JOIN wallets w ON w.user_id=c.user_id WHERE c.user_id=$1", [id]
  );
  assert.equal(q.rowCount, 1);
  assert.equal(q.rows[0].company_name, 'Sample Person');
  assert.equal(q.rows[0].balance, '0.00');
});

test('profile or wallet creation failure rolls user insert back', async () => {
  await pool.query("ALTER TABLE wallets ADD CONSTRAINT test_reject_usd CHECK (currency <> 'USD') NOT VALID");
  try {
    const response = await register('rollback@example.com');
    assert.equal(response.status, 500);
    const q = await pool.query("SELECT id FROM users WHERE email='rollback@example.com'");
    assert.equal(q.rowCount, 0);
  } finally {
    await pool.query('ALTER TABLE wallets DROP CONSTRAINT test_reject_usd');
  }
});

test('duplicate normalized email is rejected without creating extra profile', async () => {
  const first = await register('duplicates@example.com');
  assert.equal(first.status, 201);
  const duplicate = await register('DUPLICATES@EXAMPLE.COM');
  assert.equal(duplicate.status, 409);
  const q = await pool.query("SELECT id FROM users WHERE email='duplicates@example.com'");
  assert.equal(q.rowCount, 1);
});

test('login succeeds without nonexistent last_login column and verify returns user', async () => {
  const response = await register('login@example.com');
  assert.equal(response.status, 201);
  const login = await request('/api/auth/login',
    { email: 'LOGIN@example.com', password: 'passphrase-5678' });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  const verified = await request('/api/auth/verify', null, login.body.token, 'GET');
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, 'login@example.com');
  assert.equal(verified.body.user.userId, response.body.user.userId);
});

test('wrong password and missing user are refused', async () => {
  await register('wrong@example.com');
  assert.equal((await request('/api/auth/login',
    { email: 'wrong@example.com', password: 'incorrect_password' })).status, 401);
  assert.equal((await request('/api/auth/login',
    { email: 'unknown@example.com', password: 'passphrase-5678' })).status, 401);
});

test('disabled accounts lose access for existing tokens, verify and login', async () => {
  const initial = await register('disabled@example.com');
  assert.equal(initial.status, 201);
  assert.equal((await request('/api/protected', null, initial.body.token, 'GET')).status, 200);
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [initial.body.user.userId]);
  assert.equal((await request('/api/protected', null, initial.body.token, 'GET')).status, 401);
  assert.equal((await request('/api/auth/verify', null, initial.body.token, 'GET')).status, 401);
  assert.equal((await request('/api/auth/login',
    { email: 'disabled@example.com', password: 'passphrase-5678' })).status, 401);
});

test('JWT role impersonation cannot grant admin access', async () => {
  const initial = await register('roles@example.com');
  const token = jwt.sign({ userId: initial.body.user.userId, user_type: 'admin', role: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  const verified = await request('/api/protected', null, token, 'GET');
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.user_type, 'investor');
  assert.equal((await request('/api/admin', null, token, 'GET')).status, 403);
});

test('expired, malformed and missing tokens are rejected', async () => {
  const account = await register('expired@example.com');
  const expired = jwt.sign({ userId: account.body.user.userId }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await request('/api/auth/verify', null, expired, 'GET')).status, 401);
  assert.equal((await request('/api/auth/verify', null, 'garbage', 'GET')).status, 401);
  assert.equal((await request('/api/auth/verify', null, null, 'GET')).status, 401);
});
