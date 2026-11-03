'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const stripeFactory = require('stripe');
const { v4: uuidv4 } = require('uuid');
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

// Idempotent settlement: transaction lock + verified Stripe amount/currency/owner.
router.post('/confirm', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { transactionId, paymentIntentId } = req.body || {};
  if (typeof transactionId !== 'string' || typeof paymentIntentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId) ||
      !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
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
  if (intent.status !== 'succeeded' ||
      intent.currency?.toLowerCase() !== 'usd' ||
      intent.metadata?.userId !== String(userId) ||
      intent.metadata?.transactionId !== transactionId) {
    return res.status(400).json({ error: 'Payment does not match the requested transaction' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const tx = await client.query(
      'SELECT id, user_id, amount, currency, transaction_type, status, external_id FROM transactions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [transactionId, userId]
    );
    if (!tx.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment transaction not found' });
    }
    const row = tx.rows[0];
    const amount = positiveMoney(row.amount);
    const cents = centsFromMoney(amount);
    if (row.transaction_type !== 'deposit' || row.currency !== 'USD' ||
        row.external_id !== paymentIntentId || !cents || intent.amount !== cents ||
        intent.amount_received !== cents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment verification mismatch' });
    }
    if (row.status === 'completed') {
      await client.query('COMMIT');
      return res.json({ message: 'Payment already confirmed', transactionId, amount, alreadyConfirmed: true });
    }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payment transaction is not pending' });
    }
    const wallet = await client.query(
      'UPDATE wallets SET balance = balance + $1::numeric, total_deposits = total_deposits + $1::numeric WHERE user_id = $2 AND currency = $3 RETURNING id',
      [amount, userId, 'USD']
    );
    if (!wallet.rowCount) throw new Error('Matching USD wallet is missing');
    await client.query(
      "UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'pending'",
      [transactionId]
    );
    await client.query('COMMIT');
    return res.json({ message: 'Payment confirmed successfully', transactionId, amount, alreadyConfirmed: false });
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

// Stripe signature must be verified against the original raw request body.
// Webhook crediting/reversals are NOT implemented; never treat a log as settlement.
router.post('/webhook', async (req, res) => {
  const stripe = stripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || !Buffer.isBuffer(req.body)) {
    return res.status(503).json({ error: 'Webhook not configured for signed raw events' });
  }
  try {
    const event = stripe.webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('Verified Stripe event type:', event.type);
    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook signature verification failed');
    return res.status(400).json({ error: 'Invalid Stripe webhook signature' });
  }
});

module.exports = router;
