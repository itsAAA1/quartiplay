/**
 * Skrill & Neteller Routes
 * Handles payment processing for both Skrill and Neteller
 */

const express = require('express');
const router = express.Router();
const skrill = require('../skrill');
const neteller = require('../neteller');
const authMiddleware = require('../middleware/auth');
const pool = require('../../database/db');

/**
 * POST /api/skrill-neteller/create-payment
 * Create a new payment session
 */
router.post('/create-payment', authMiddleware, async (req, res) => {
  try {
    const { amount, currency, provider, opportunityId } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!amount || !provider || !opportunityId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['skrill', 'neteller'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Get user email
    const userResult = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const transactionId = `QP-${Date.now()}-${userId.substring(0, 8)}`;

    const paymentData = {
      transactionId,
      amount,
      currency: currency || 'USD',
      customerEmail: user.email,
      customerName: user.full_name,
      returnUrl: `${process.env.REACT_APP_API_URL}/payment/success`,
      cancelUrl: `${process.env.REACT_APP_API_URL}/payment/cancel`,
      statusUrl: `${process.env.REACT_APP_API_URL}/api/skrill-neteller/webhook`,
      logoUrl: `${process.env.REACT_APP_API_URL}/logo.png`,
    };

    let paymentResponse;
    if (provider === 'skrill') {
      paymentResponse = await skrill.createPayment(paymentData);
    } else {
      paymentResponse = await neteller.createPayment(paymentData);
    }

    // Save transaction to database
    await pool.query(
      `INSERT INTO transactions (user_id, transaction_type, amount, currency, status, payment_method, external_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, 'investment', amount, currency || 'USD', 'pending', provider, transactionId, `Investment in opportunity ${opportunityId}`]
    );

    res.json({
      success: true,
      transactionId,
      paymentUrl: paymentResponse.payment_url || paymentResponse.url,
      provider,
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/skrill-neteller/webhook
 * Handle webhook notifications from Skrill/Neteller
 */
router.post('/webhook', async (req, res) => {
  try {
    const { provider, ...webhookData } = req.body;

    if (!['skrill', 'neteller'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Verify signature
    const paymentProcessor = provider === 'skrill' ? skrill : neteller;
    const isValid = paymentProcessor.verifyWebhookSignature(
      webhookData,
      webhookData.md5sig
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Process webhook
    const processedData = paymentProcessor.processWebhook(webhookData);

    // Update transaction status
    const statusMap = {
      'processed': 'completed',
      'pending': 'pending',
      'failed': 'failed',
      'cancelled': 'cancelled',
      'refunded': 'cancelled',
    };

    await pool.query(
      `UPDATE transactions SET status = $1, updated_at = NOW() WHERE external_id = $2`,
      [statusMap[processedData.status] || 'pending', processedData.transactionId]
    );

    // If successful, create investment record
    if (processedData.status === 'processed') {
      const transactionResult = await pool.query(
        `SELECT * FROM transactions WHERE external_id = $1`,
        [processedData.transactionId]
      );

      if (transactionResult.rows.length > 0) {
        const transaction = transactionResult.rows[0];
        // Create investment record logic here
      }
    }

    res.json({ success: true, status: processedData.status });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/skrill-neteller/transfer
 * Transfer funds to user
 */
router.post('/transfer', authMiddleware, async (req, res) => {
  try {
    const { amount, currency, provider, toEmail } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!amount || !provider || !toEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['skrill', 'neteller'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const paymentProcessor = provider === 'skrill' ? skrill : neteller;

    const transferData = {
      toEmail,
      amount,
      currency: currency || 'USD',
      customerId: userId,
      note: 'Investment Return',
    };

    const transferResponse = await paymentProcessor.transferFunds(transferData);

    // Save transfer transaction
    await pool.query(
      `INSERT INTO transactions (user_id, transaction_type, amount, currency, status, payment_method, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, 'return', amount, currency || 'USD', 'completed', provider, 'Investment Return Transfer']
    );

    res.json({
      success: true,
      message: 'Transfer initiated successfully',
      transferId: transferResponse.transaction_id || transferResponse.id,
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/skrill-neteller/status/:transactionId
 * Get transaction status
 */
router.get('/status/:transactionId', authMiddleware, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { provider } = req.query;

    if (!['skrill', 'neteller'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const paymentProcessor = provider === 'skrill' ? skrill : neteller;
    const status = await paymentProcessor.getTransactionStatus(transactionId);

    res.json(status);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/skrill-neteller/balance
 * Get Neteller account balance
 */
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const balance = await neteller.getAccountBalance();
    res.json(balance);
  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/skrill-neteller/withdraw
 * Withdraw funds from Neteller
 */
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const withdrawData = {
      amount,
      currency: currency || 'USD',
      customerId: userId,
      note: 'Admin Withdrawal',
    };

    const withdrawResponse = await neteller.withdrawFunds(withdrawData);

    res.json({
      success: true,
      message: 'Withdrawal initiated successfully',
      withdrawalId: withdrawResponse.transaction_id || withdrawResponse.id,
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
