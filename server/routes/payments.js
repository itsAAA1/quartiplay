const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');

// Create Payment Intent
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { amount, currency = 'USD', payment_method } = req.body;

    // Get user email
    const userResult = await pool.query(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      metadata: {
        userId,
        payment_method
      }
    });

    // Save transaction
    const transactionId = uuidv4();
    await pool.query(
      `INSERT INTO transactions (id, user_id, transaction_type, amount, currency, status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [transactionId, userId, 'deposit', amount, currency, 'pending', payment_method]
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      transactionId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Confirm Payment
router.post('/confirm', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { transactionId, paymentIntentId } = req.body;

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not confirmed' });
    }

    // Update transaction
    await pool.query(
      'UPDATE transactions SET status = $1, completed_at = NOW() WHERE id = $2',
      ['completed', transactionId]
    );

    // Update wallet
    const amount = paymentIntent.amount / 100;
    await pool.query(
      `UPDATE wallets SET balance = balance + $1, total_deposits = total_deposits + $1, last_transaction_date = NOW()
       WHERE user_id = $2`,
      [amount, userId]
    );

    // Save payment record
    const paymentId = uuidv4();
    await pool.query(
      `INSERT INTO payments (id, transaction_id, stripe_payment_id, amount, currency, status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [paymentId, transactionId, paymentIntentId, amount, 'USD', 'completed', 'stripe']
    );

    res.json({
      message: 'Payment confirmed successfully',
      amount,
      transactionId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Get Payment History
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Webhook for Stripe Events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error(error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('Payment succeeded:', event.data.object);
      break;
    case 'payment_intent.payment_failed':
      console.log('Payment failed:', event.data.object);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;
