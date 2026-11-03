'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

// Importing the Express app must not launch a second listener.
const app = require('../server/index');
let server, base;
before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('server boots with all safe routes registered and health check responds', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'OK');
});

test('login verification requires a valid token', async () => {
  const r = await fetch(base + '/api/auth/verify');
  assert.equal(r.status, 401);
});

test('legacy external money-moving provider endpoints are not exposed', async () => {
  const endpoints = ['/api/wise/balance', '/api/paypal/details/test', '/api/skrill-neteller/balance'];
  for (const path of endpoints) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
  }
});
