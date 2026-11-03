'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_no_real_api';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_no_real_api';
process.env.PAYMENT_WEBHOOK_RECONCILIATION = 'enabled';
const pool = require('../database/db');

const intents = new Map();
let seq = 0;
let providerWriteCalls = 0;
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
  // Provider write APIs must never be called by webhook handling.
  refunds: { async create() { providerWriteCalls++; throw new Error('refund API must not be called'); } },
  webhooks: null // replaced below with the REAL Stripe SDK signature verifier (offline HMAC, no API call)
};
const stripePath = require.resolve('stripe');
require(stripePath);
const originalStripe = require.cache[stripePath].exports;
require.cache[stripePath].exports = () => fakeStripe;
const paymentRouter = require('../server/routes/payments');
require.cache[stripePath].exports = originalStripe;
fakeStripe.webhooks = originalStripe('sk_test_mock_no_real_api').webhooks;
const MIGRATION_SQL = fs.readFileSync(path.join(__dirname, '../database/migrations/20261104_001_payment_provider_events.sql'), 'utf8');
let server, base;

before(async () => {
  await pool.query('DROP TABLE IF EXISTS payment_provider_events, schema_migrations, audit_logs, transactions, wallets, users CASCADE');
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY, user_type text NOT NULL, email text, full_name text, role text, is_active boolean NOT NULL DEFAULT true)');
  await pool.query("CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id), balance numeric(15,2) NOT NULL DEFAULT 0, total_deposits numeric(15,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD')");
  await pool.query('CREATE TABLE transactions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), transaction_type text, amount numeric(15,2), currency text, status text, payment_method text, external_id text, completed_at timestamp, created_at timestamp DEFAULT CURRENT_TIMESTAMP)');
  // The operator-applied migration, executed twice to prove it is idempotent.
  await pool.query(MIGRATION_SQL);
  await pool.query(MIGRATION_SQL);
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

// ---------------------------------------------------------------------------
// Durable webhook reconciliation (mocked Stripe provider API, real signature scheme)
// ---------------------------------------------------------------------------
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
let evtSeq = 0;
function evt(type, object, id) {
  return { id: id || 'evt_t' + Date.now().toString(36) + (++evtSeq), object: 'event', type, livemode: false, data: { object } };
}
function sign(payload, secret = SECRET, timestamp) {
  return fakeStripe.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
}
// Pretty-printed on purpose: signature only matches the exact raw bytes.
async function hook(event, { signature, secret, raw } = {}) {
  const payload = raw ?? JSON.stringify(event, null, 2);
  const headers = { 'Content-Type': 'application/json' };
  const sig = signature === undefined ? sign(payload, secret) : signature;
  if (sig !== null) headers['stripe-signature'] = sig;
  const response = await fetch(base + '/api/payments/webhook', { method: 'POST', headers, body: payload });
  return { status: response.status, body: await response.json(), payload };
}
const succeeded = ids => evt('payment_intent.succeeded', { id: ids.paymentIntentId, object: 'payment_intent' });
async function receipts(where = 'TRUE', params = []) {
  return (await pool.query('SELECT * FROM payment_provider_events WHERE ' + where + ' ORDER BY received_at', params)).rows;
}
async function txStatus(id) {
  return (await pool.query('SELECT status FROM transactions WHERE id=$1', [id])).rows[0]?.status;
}

test('real signed raw payment_intent.succeeded settles the deposit and records a receipt', async () => {
  const user = await person('2.00');
  const ids = await create(user, '20.05');
  const e = succeeded(ids);
  const r = await hook(e);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'settled');
  assert.deepEqual(await balance(user.id), { balance: '22.05', total_deposits: '20.05' });
  assert.equal(await txStatus(ids.transactionId), 'completed');
  const rows = await receipts('event_id=$1', [e.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'settled');
  assert.equal(rows[0].transaction_id, ids.transactionId);
  assert.equal(rows[0].payment_intent_id, ids.paymentIntentId);
  assert.equal(rows[0].review_status, null);
  assert.equal(rows[0].payload_sha256.length, 64);
  // A later authenticated confirm is a no-op.
  const c = await post('confirm', user.token, ids);
  assert.equal(c.status, 200);
  assert.equal(c.body.alreadyConfirmed, true);
  assert.deepEqual(await balance(user.id), { balance: '22.05', total_deposits: '20.05' });
});

test('webhook rejects missing, malformed, wrong-secret, tampered and stale signatures', async () => {
  const user = await person();
  const ids = await create(user, '9.99');
  const e = succeeded(ids);
  const good = JSON.stringify(e, null, 2);
  assert.equal((await hook(e, { signature: null })).status, 400);
  assert.equal((await hook(e, { signature: 'sig-ok' })).status, 400);
  assert.equal((await hook(e, { secret: 'whsec_someone_else' })).status, 400);
  // Valid signature for a different body than the one transmitted.
  assert.equal((await hook(e, { raw: good + ' ', signature: sign(good) })).status, 400);
  // Replayed with a timestamp far outside Stripe's tolerance window.
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await hook(e, { signature: sign(good, SECRET, old) })).status, 400);
  assert.equal(await txStatus(ids.transactionId), 'pending');
  assert.equal((await balance(user.id)).balance, '0.00');
  assert.equal((await receipts('payment_intent_id=$1', [ids.paymentIntentId])).length, 0);
});

test('replayed signed event is acknowledged as duplicate and never credits twice', async () => {
  const user = await person();
  const ids = await create(user, '7.25');
  const e = succeeded(ids);
  const first = await hook(e);
  const second = await hook(e);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  // A different event id for the same intent (Stripe re-delivery variants) is also idempotent.
  const third = await hook(succeeded(ids));
  assert.equal(third.status, 200);
  assert.equal(third.body.outcome, 'already_settled');
  assert.deepEqual(await balance(user.id), { balance: '7.25', total_deposits: '7.25' });
  assert.equal((await receipts('payment_intent_id=$1', [ids.paymentIntentId])).length, 2);
});

test('concurrent confirm and webhook deliveries credit exactly once', async () => {
  const user = await person('1.00');
  const ids = await create(user, '33.30');
  const e = succeeded(ids);
  const results = await Promise.all([
    post('confirm', user.token, ids),
    hook(e), hook(e), hook(succeeded(ids)),
    post('confirm', user.token, ids)
  ]);
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await balance(user.id), { balance: '34.30', total_deposits: '33.30' });
  assert.equal(await txStatus(ids.transactionId), 'completed');
  const rows = await receipts('payment_intent_id=$1', [ids.paymentIntentId]);
  assert.ok(rows.length >= 1 && rows.length <= 2);
  const settledByEvents = rows.filter(r => r.outcome === 'settled').length;
  const settledByConfirm = results[0].body.alreadyConfirmed === false || results[4].body.alreadyConfirmed === false;
  // Exactly one party performed the credit.
  assert.equal(settledByEvents + (settledByConfirm ? 1 : 0), 1);
  assert.equal(new Set(rows.map(r => r.event_id)).size, rows.length);
});

test('event for a transaction owned by someone else is never credited', async () => {
  const victim = await person();
  const attacker = await person();
  const ids = await create(victim, '15.00');
  // Attacker-controlled (mock) intent that claims the victim's ledger row.
  const own = await create(attacker, '15.00');
  intents.get(own.paymentIntentId).metadata = { userId: String(attacker.id), transactionId: ids.transactionId };
  const r = await hook(succeeded(own));
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, 'manual_review');
  assert.equal((await balance(victim.id)).balance, '0.00');
  assert.equal((await balance(attacker.id)).balance, '0.00');
  assert.equal(await txStatus(ids.transactionId), 'pending');
  const rows = await receipts('payment_intent_id=$1', [own.paymentIntentId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'manual_review');
  assert.equal(rows[0].review_status, 'pending_review');
  assert.equal(rows[0].review_reason, 'deposit_validation_mismatch');
});

test('wrong provider amount or currency is never credited and goes to manual review', async () => {
  const user = await person();
  const short = await create(user, '11.00');
  intents.get(short.paymentIntentId).amount_received = 100;
  const a = await hook(succeeded(short));
  assert.equal(a.status, 200);
  assert.equal(a.body.outcome, 'manual_review');
  const wrongAmount = await create(user, '12.00');
  intents.get(wrongAmount.paymentIntentId).amount = 1;
  assert.equal((await hook(succeeded(wrongAmount))).body.outcome, 'manual_review');
  const eur = await create(user, '13.00');
  intents.get(eur.paymentIntentId).currency = 'eur';
  assert.equal((await hook(succeeded(eur))).body.outcome, 'manual_review');
  // Ledger row itself tampered: non-USD ledger currency.
  const ledgerEur = await create(user, '14.00');
  await pool.query("UPDATE transactions SET currency='EUR' WHERE id=$1", [ledgerEur.transactionId]);
  assert.equal((await hook(succeeded(ledgerEur))).body.outcome, 'manual_review');
  assert.deepEqual(await balance(user.id), { balance: '0.00', total_deposits: '0.00' });
  for (const id of [short, wrongAmount, eur, ledgerEur]) assert.equal(await txStatus(id.transactionId), 'pending');
  const rows = await receipts("outcome='manual_review' AND transaction_id = ANY($1::uuid[])",
    [[short, wrongAmount, eur, ledgerEur].map(x => x.transactionId)]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.summary.mismatch).sort(), ['amount', 'amount_received', 'ledger_currency', 'provider_currency']);
});

test('provider intent not yet succeeded is a retryable failure and not recorded', async () => {
  const user = await person();
  const ids = await create(user, '4.00');
  intents.get(ids.paymentIntentId).status = 'processing';
  const e = succeeded(ids);
  const r = await hook(e);
  assert.equal(r.status, 503);
  assert.equal(r.body.retryable, true);
  assert.equal((await receipts('event_id=$1', [e.id])).length, 0);
  assert.equal((await balance(user.id)).balance, '0.00');
});

test('failed wallet write rolls back ledger and receipt; retry after repair settles once', async () => {
  const user = await person();
  const ids = await create(user, '5.10');
  await pool.query('DELETE FROM wallets WHERE user_id=$1', [user.id]);
  const e = succeeded(ids);
  const r = await hook(e);
  assert.equal(r.status, 500);
  assert.equal(await txStatus(ids.transactionId), 'pending');
  assert.equal((await receipts('event_id=$1', [e.id])).length, 0);
  await pool.query('INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 0, $2)', [user.id, 'USD']);
  const retry = await hook(e);
  assert.equal(retry.status, 200);
  assert.deepEqual(await balance(user.id), { balance: '5.10', total_deposits: '5.10' });
  assert.equal((await receipts('event_id=$1', [e.id])).length, 1);
});

test('event arriving before the ledger row exists is retryable, unprocessed, then settles on redelivery', async () => {
  const user = await person();
  const transactionId = randomUUID();
  const intentId = 'pi_early' + (++seq);
  intents.set(intentId, { id: intentId, status: 'succeeded', currency: 'usd', amount: 2500, amount_received: 2500,
    metadata: { userId: String(user.id), transactionId } });
  const e = evt('payment_intent.succeeded', { id: intentId, object: 'payment_intent' });
  const early = await hook(e);
  assert.equal(early.status, 503);
  assert.equal(early.body.retryable, true);
  assert.equal(early.body.received, undefined);
  assert.equal((await receipts('event_id=$1', [e.id])).length, 0);
  assert.equal((await balance(user.id)).balance, '0.00');
  await pool.query("INSERT INTO transactions (id, user_id, transaction_type, amount, currency, status, payment_method, external_id) VALUES ($1,$2,'deposit','25.00','USD','pending','stripe',$3)",
    [transactionId, user.id, intentId]);
  const late = await hook(e);
  assert.equal(late.status, 200);
  assert.equal(late.body.outcome, 'settled');
  assert.deepEqual(await balance(user.id), { balance: '25.00', total_deposits: '25.00' });
});

test('refund and dispute events create duplicate-safe manual-review records only', async () => {
  const user = await person();
  const ids = await create(user, '40.00');
  assert.equal((await hook(succeeded(ids))).status, 200);
  const before = await balance(user.id);
  providerWriteCalls = 0;
  const refund = evt('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: ids.paymentIntentId, amount_refunded: 4000, currency: 'usd', status: 'succeeded' });
  const dispute = evt('charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: ids.paymentIntentId, amount: 4000, currency: 'usd', status: 'needs_response', reason: 'fraudulent' });
  const [r1, d1] = [await hook(refund), await hook(dispute)];
  const [r2, d2] = [await hook(refund), await hook(dispute)];
  const [r3, d3] = await Promise.all([hook(refund), hook(dispute)]);
  for (const r of [r1, d1, r2, d2, r3, d3]) { assert.equal(r.status, 200); assert.equal(r.body.outcome === 'manual_review' || r.body.duplicate === true, true); }
  assert.equal(r1.body.duplicate, false);
  assert.equal(r2.body.duplicate, true);
  const rows = await receipts("outcome='manual_review' AND payment_intent_id=$1", [ids.paymentIntentId]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.review_reason).sort(), ['dispute_requires_manual_review', 'refund_requires_manual_review']);
  for (const row of rows) {
    assert.equal(row.review_status, 'pending_review');
    assert.equal(row.automatic_action_taken, false);
    assert.equal(row.transaction_id, ids.transactionId);
    assert.match(row.summary.note, /No automatic/);
  }
  // No debit, no reversal, no provider refund call; ledger still reads as completed deposit.
  assert.deepEqual(await balance(user.id), before);
  assert.equal(await txStatus(ids.transactionId), 'completed');
  assert.equal(providerWriteCalls, 0);
  // The database itself refuses to represent an automatic action.
  await assert.rejects(pool.query("UPDATE payment_provider_events SET automatic_action_taken = TRUE WHERE id=$1", [rows[0].id]), /automatic_action_taken|check/i);
});

test('verified unknown nonfinancial events are explicitly ignored and not recorded', async () => {
  const e = evt('customer.created', { id: 'cus_1', object: 'customer' });
  const r = await hook(e);
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, true);
  assert.equal((await receipts('event_id=$1', [e.id])).length, 0);
});

test('webhook reconciliation fails closed when rollout flag or migration is missing', async () => {
  const user = await person();
  const ids = await create(user, '3.33');
  const e = succeeded(ids);
  const refund = evt('charge.refunded', { id: 'ch_gate', object: 'charge', payment_intent: ids.paymentIntentId });
  const expectClosed = async () => {
    for (const ev of [e, refund]) {
      const r = await hook(ev);
      assert.equal(r.status, 503);
      assert.equal(r.body.received, undefined);
    }
    assert.equal((await balance(user.id)).balance, '0.00');
    assert.equal(await txStatus(ids.transactionId), 'pending');
  };
  const flag = process.env.PAYMENT_WEBHOOK_RECONCILIATION;
  try {
    for (const value of [undefined, 'disabled', 'true', 'ENABLED']) {
      if (value === undefined) delete process.env.PAYMENT_WEBHOOK_RECONCILIATION; else process.env.PAYMENT_WEBHOOK_RECONCILIATION = value;
      await expectClosed();
    }
    process.env.PAYMENT_WEBHOOK_RECONCILIATION = 'enabled';
    // Flag on but migration version row missing.
    await pool.query("DELETE FROM schema_migrations WHERE version='20261104_001_payment_provider_events'");
    await expectClosed();
    // Flag on but receipt table missing entirely.
    await pool.query('ALTER TABLE payment_provider_events RENAME TO payment_provider_events_hold');
    await expectClosed();
  } finally {
    await pool.query("ALTER TABLE IF EXISTS payment_provider_events_hold RENAME TO payment_provider_events");
    await pool.query("INSERT INTO schema_migrations (version) VALUES ('20261104_001_payment_provider_events') ON CONFLICT DO NOTHING");
    process.env.PAYMENT_WEBHOOK_RECONCILIATION = flag;
  }
  // Re-enabled: the same event now settles.
  assert.equal((await hook(e)).status, 200);
  assert.equal((await balance(user.id)).balance, '3.33');
});

test('webhook without raw body parsing or secret is not acknowledged', async () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const r = await fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'x' }, body: '{}' });
    assert.equal(r.status, 503);
  } finally { process.env.STRIPE_WEBHOOK_SECRET = secret; }
});
