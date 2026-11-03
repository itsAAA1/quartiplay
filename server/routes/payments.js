'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const stripeFactory = require('stripe');
const { v4: uuidv4 } = require('uuid');
const crypto = require('node:crypto');
const { positiveMoney } = require('../money');

function stripeClient() {
  return process.env.STRIPE_SECRET_KEY ? stripeFactory(process.env.STRIPE_SECRET_KEY) : null;
}
function centsFromMoney(amount) {
  if (!amount) return null;
  const [whole, cents] = amount.split('.');
  const value = Number(whole) * 100 + Number(cents);
  // Stripe's USD amount limit; using cents avoids floating-point rounding.
  return Number.isSafeInteger(value) && value > 0 && value <= 99999999 ? value : null;
}

// This flow supports USD wallets only; other currencies need explicit exchange handling.
router.post('/create-intent', authenticateToken, async (req, res) => {
  const amount = positiveMoney(req.body?.amount);
  const cents = centsFromMoney(amount);
  const currency = req.body?.currency || 'USD';
  if (!cents || typeof currency !== 'string' || currency.toUpperCase() !== 'USD') {
    return res.status(400).json({ error: 'Valid positive USD amount is required' });
  }
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  let paymentIntent;
  try {
    const wallet = await pool.query('SELECT currency FROM wallets WHERE user_id = $1', [req.user.userId]);
    if (!wallet.rowCount) return res.status(404).json({ error: 'Wallet not found' });
    if (wallet.rows[0].currency !== 'USD') return res.status(400).json({ error: 'Only USD wallets are supported' });

    const transactionId = uuidv4();
    paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: { userId: String(req.user.userId), transactionId }
    }, { idempotencyKey: 'quartiplay-intent-' + transactionId });
    await pool.query(
      'INSERT INTO transactions (id, user_id, transaction_type, amount, currency, status, payment_method, external_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [transactionId, req.user.userId, 'deposit', amount, 'USD', 'pending', 'stripe', paymentIntent.id]
    );
    return res.status(201).json({ clientSecret: paymentIntent.client_secret, transactionId });
  } catch (error) {
    // If a pending Stripe intent was created but no ledger row exists, cancel it.
    if (paymentIntent?.id) {
      try { await stripe.paymentIntents.cancel(paymentIntent.id); }
      catch (cancelError) { console.error('Stripe intent cancellation failed'); }
    }
    console.error('Payment creation failed');
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTENT_RE = /^pi_[A-Za-z0-9_]+$/;
const EVENT_RE = /^evt_[A-Za-z0-9_]+$/;

// Provider-state checks shared by /confirm and the signed webhook. Returns a
// short machine-readable mismatch code, or null when the intent is acceptable.
function intentMismatch(intent, { userId, transactionId, paymentIntentId }) {
  if (!intent || intent.id !== paymentIntentId) return 'provider_intent_id';
  if (intent.status !== 'succeeded') return 'provider_status';
  if (intent.currency?.toLowerCase() !== 'usd') return 'provider_currency';
  if (intent.metadata?.userId !== String(userId)) return 'provider_user';
  if (intent.metadata?.transactionId !== transactionId) return 'provider_transaction';
  return null;
}

// Shared idempotent deposit settlement. MUST run inside a caller-owned database
// transaction (BEGIN ... COMMIT/ROLLBACK is the caller's job) so a settlement and
// any receipt record commit or roll back together. Lock order is always
// transaction row -> wallet row. It never credits unless every check passes.
// Statuses: settled | already_settled | not_found | mismatch | not_pending.
// Throws (caller must roll back) when the ledger cannot be written.
async function settleDeposit(client, { transactionId, userId, paymentIntentId, intent }) {
  const tx = await client.query(
    'SELECT id, user_id, amount, currency, transaction_type, status, external_id, payment_method FROM transactions WHERE id = $1 FOR UPDATE',
    [transactionId]
  );
  if (!tx.rowCount) return { status: 'not_found' };
  const row = tx.rows[0];
  const amount = positiveMoney(row.amount);
  const cents = centsFromMoney(amount);
  const providerProblem = intentMismatch(intent, { userId, transactionId, paymentIntentId });
  let problem = providerProblem;
  if (!problem) {
    if (String(row.user_id) !== String(userId)) problem = 'ledger_owner';
    else if (row.transaction_type !== 'deposit') problem = 'ledger_type';
    else if (row.payment_method !== 'stripe') problem = 'ledger_method';
    else if (row.currency !== 'USD') problem = 'ledger_currency';
    else if (row.external_id !== paymentIntentId) problem = 'ledger_intent_id';
    else if (!cents) problem = 'ledger_amount';
    else if (intent.amount !== cents) problem = 'amount';
    else if (intent.amount_received !== cents) problem = 'amount_received';
  }
  if (problem) return { status: 'mismatch', reason: problem, row };
  if (row.status === 'completed') return { status: 'already_settled', row, amount };
  if (row.status !== 'pending') return { status: 'not_pending', row };

  const wallet = await client.query(
    'SELECT id FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
    [row.user_id, 'USD']
  );
  if (!wallet.rowCount) throw new Error('Matching USD wallet is missing');
  const credited = await client.query(
    'UPDATE wallets SET balance = balance + $1::numeric, total_deposits = total_deposits + $1::numeric WHERE id = $2 RETURNING id',
    [amount, wallet.rows[0].id]
  );
  if (!credited.rowCount) throw new Error('Wallet credit failed');
  const done = await client.query(
    "UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id",
    [transactionId]
  );
  if (!done.rowCount) throw new Error('Ledger completion failed');
  return { status: 'settled', row, amount };
}

// Idempotent settlement: transaction lock + verified Stripe amount/currency/owner.
router.post('/confirm', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { transactionId, paymentIntentId } = req.body || {};
  if (typeof transactionId !== 'string' || typeof paymentIntentId !== 'string' ||
      !UUID_RE.test(transactionId) || !INTENT_RE.test(paymentIntentId)) {
    return res.status(400).json({ error: 'Invalid payment identifiers' });
  }
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (error) {
    console.error('Stripe payment verification failed');
    return res.status(502).json({ error: 'Unable to verify payment with provider' });
  }
  if (intentMismatch(intent, { userId, transactionId, paymentIntentId })) {
    return res.status(400).json({ error: 'Payment does not match the requested transaction' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await settleDeposit(client, { transactionId, userId, paymentIntentId, intent });
    if (result.status === 'not_found') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment transaction not found' });
    }
    if (result.status === 'mismatch') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment verification mismatch' });
    }
    if (result.status === 'not_pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payment transaction is not pending' });
    }
    await client.query('COMMIT');
    if (result.status === 'already_settled') {
      return res.json({ message: 'Payment already confirmed', transactionId, amount: result.amount, alreadyConfirmed: true });
    }
    return res.json({ message: 'Payment confirmed successfully', transactionId, amount: result.amount, alreadyConfirmed: false });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Payment settlement failed');
    return res.status(500).json({ error: 'Failed to settle payment' });
  } finally {
    if (client) client.release();
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.userId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// ---------------------------------------------------------------------------
// Durable Stripe webhook reconciliation (review-stage, DISABLED BY DEFAULT).
//
// Fails closed (HTTP 503, event NOT acknowledged so Stripe retries) unless:
//   * STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are configured,
//   * PAYMENT_WEBHOOK_RECONCILIATION is exactly "enabled", and
//   * the operator-applied migration 20261104_001_payment_provider_events exists.
// The application never runs migrations itself.
//
// A financial event is acknowledged with 2xx ONLY after either the ledger
// settlement (+ receipt) or a manual-review record has been durably committed.
// Refund/dispute events NEVER debit a wallet, never call Stripe refund APIs and
// never mark anything as refunded: they only create a pending_review record.
// ---------------------------------------------------------------------------
const MIGRATION_VERSION = '20261104_001_payment_provider_events';
const REFUND_EVENT_RE = /^(charge\.refunded|charge\.refund\.updated|refund\.[a-z_]+)$/;
const DISPUTE_EVENT_RE = /^charge\.dispute\.[a-z_]+$/;

async function reconciliationReady() {
  if (process.env.PAYMENT_WEBHOOK_RECONCILIATION !== 'enabled') return false;
  try {
    const tables = await pool.query(
      "SELECT to_regclass('payment_provider_events') IS NOT NULL AS events, to_regclass('schema_migrations') IS NOT NULL AS migrations"
    );
    if (!tables.rows[0].events || !tables.rows[0].migrations) return false;
    const version = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [MIGRATION_VERSION]);
    return version.rowCount === 1;
  } catch (error) {
    return false;
  }
}

function short(value, max = 100) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}
function minorUnits(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function insertReceipt(db, r) {
  const result = await db.query(
    `INSERT INTO payment_provider_events
       (provider, event_id, event_type, livemode, payment_intent_id, provider_object_id, transaction_id,
        outcome, review_status, review_reason, amount_minor, currency, payload_sha256, summary)
     VALUES ('stripe', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [r.eventId, r.eventType, typeof r.livemode === 'boolean' ? r.livemode : null, r.paymentIntentId || null,
     r.objectId || null, r.transactionId || null, r.outcome, r.reviewStatus || null, r.reviewReason || null,
     r.amountMinor ?? null, r.currency || null, r.sha256, JSON.stringify(r.summary || {})]
  );
  return result.rowCount === 1;
}

async function alreadyReceived(eventId) {
  const r = await pool.query("SELECT outcome FROM payment_provider_events WHERE provider = 'stripe' AND event_id = $1", [eventId]);
  return r.rowCount === 1;
}

function retryable(res, message) {
  res.set('Retry-After', '60');
  return res.status(503).json({ error: message, retryable: true });
}

// Refund / dispute: persist a manual-review record only.
async function recordManualReview(event, sha256, res) {
  const object = event.data?.object || {};
  const isDispute = DISPUTE_EVENT_RE.test(event.type);
  const intentId = INTENT_RE.test(object.payment_intent || '') ? object.payment_intent : null;
  let transactionId = null;
  if (intentId) {
    const found = await pool.query(
      "SELECT id FROM transactions WHERE external_id = $1 AND payment_method = 'stripe' ORDER BY created_at ASC LIMIT 1", [intentId]
    );
    transactionId = found.rows[0]?.id || null;
  }
  const amount = minorUnits(object.amount_refunded ?? object.amount);
  const inserted = await insertReceipt(pool, {
    eventId: event.id, eventType: event.type, livemode: event.livemode, paymentIntentId: intentId,
    objectId: short(object.id), transactionId, outcome: 'manual_review', reviewStatus: 'pending_review',
    reviewReason: isDispute ? 'dispute_requires_manual_review' : 'refund_requires_manual_review',
    amountMinor: amount, currency: short(object.currency, 10)?.toLowerCase(), sha256,
    summary: {
      note: 'No automatic debit, refund or reversal was performed.',
      object_status: short(object.status), reason: short(object.reason),
      charge: short(typeof object.charge === 'string' ? object.charge : object.id)
    }
  });
  return res.json({ received: true, outcome: 'manual_review', duplicate: !inserted });
}

async function reconcileSucceeded(stripe, event, sha256, res) {
  const eventIntentId = event.data?.object?.id;
  if (typeof eventIntentId !== 'string' || !INTENT_RE.test(eventIntentId)) {
    return res.status(400).json({ error: 'Malformed payment_intent event' });
  }
  let intent;
  try {
    // Never trust the event body for money-moving facts; re-read provider state.
    intent = await stripe.paymentIntents.retrieve(eventIntentId);
  } catch (error) {
    console.error('Stripe payment verification failed');
    return retryable(res, 'Unable to verify payment with provider');
  }
  const base = {
    eventId: event.id, eventType: event.type, livemode: event.livemode, paymentIntentId: eventIntentId,
    objectId: eventIntentId, amountMinor: minorUnits(intent?.amount), currency: short(intent?.currency, 10)?.toLowerCase(), sha256
  };
  const transactionId = intent?.metadata?.transactionId;
  const userId = intent?.metadata?.userId;
  if (typeof transactionId !== 'string' || !UUID_RE.test(transactionId) || typeof userId !== 'string' || !UUID_RE.test(userId)) {
    // Succeeded payment that cannot be tied to a ledger row by trusted metadata.
    const inserted = await insertReceipt(pool, { ...base, outcome: 'manual_review', reviewStatus: 'pending_review',
      reviewReason: 'unmatched_payment', summary: { note: 'Provider metadata did not identify a ledger deposit; nothing credited.' } });
    return res.json({ received: true, outcome: 'manual_review', duplicate: !inserted });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await settleDeposit(client, { transactionId, userId, paymentIntentId: eventIntentId, intent });
    if (result.status === 'not_found' || result.reason === 'provider_status') {
      // Event raced ahead of ledger creation (or provider state not final): nothing recorded.
      await client.query('ROLLBACK');
      return retryable(res, result.status === 'not_found' ? 'Local payment transaction not found yet' : 'Provider payment not in succeeded state');
    }
    let receipt;
    if (result.status === 'settled' || result.status === 'already_settled') {
      receipt = { ...base, transactionId, outcome: result.status, summary: { amount: result.amount } };
    } else {
      receipt = { ...base, transactionId: result.row?.id || transactionId, outcome: 'manual_review', reviewStatus: 'pending_review',
        reviewReason: 'deposit_validation_mismatch',
        summary: { mismatch: result.reason || result.status, note: 'Nothing credited; operator review required.' } };
    }
    const inserted = await insertReceipt(client, receipt);
    if (!inserted) {
      // Same event id already durably recorded by a concurrent delivery.
      await client.query('ROLLBACK');
      return res.json({ received: true, duplicate: true });
    }
    await client.query('COMMIT');
    return res.json({ received: true, outcome: receipt.outcome, transactionId: receipt.transactionId });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Webhook reconciliation failed');
    return res.status(500).json({ error: 'Failed to reconcile payment event' });
  } finally {
    if (client) client.release();
  }
}

// Stripe signature must be verified against the original raw request body.
router.post('/webhook', async (req, res) => {
  const stripe = stripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || !Buffer.isBuffer(req.body)) {
    return res.status(503).json({ error: 'Webhook not configured for signed raw events' });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed');
    return res.status(400).json({ error: 'Invalid Stripe webhook signature' });
  }
  if (!event || typeof event.type !== 'string' || typeof event.id !== 'string' || !EVENT_RE.test(event.id)) {
    return res.status(400).json({ error: 'Malformed Stripe event' });
  }
  const financial = event.type === 'payment_intent.succeeded' ||
    REFUND_EVENT_RE.test(event.type) || DISPUTE_EVENT_RE.test(event.type);
  if (!financial) {
    // Verified, explicitly ignored nonfinancial event.
    return res.json({ received: true, ignored: true });
  }
  if (!(await reconciliationReady())) {
    return res.status(503).json({ error: 'Webhook reconciliation is not enabled or its migration is not applied' });
  }
  try {
    if (await alreadyReceived(event.id)) return res.json({ received: true, duplicate: true });
    const sha256 = crypto.createHash('sha256').update(req.body).digest('hex');
    if (event.type === 'payment_intent.succeeded') return await reconcileSucceeded(stripe, event, sha256, res);
    return await recordManualReview(event, sha256, res);
  } catch (error) {
    console.error('Webhook processing failed');
    return res.status(500).json({ error: 'Failed to record payment event' });
  }
});

module.exports = router;
module.exports.settleDeposit = settleDeposit;
