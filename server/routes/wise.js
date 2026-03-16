/**
 * Wise Routes
 * Handles international money transfers
 */

const express = require('express');
const router = express.Router();
const wise = require('../wise');
const authMiddleware = require('../middleware/auth');
const pool = require('../../database/db');

/**
 * POST /api/wise/quote
 * Get a transfer quote
 */
router.post('/quote', authMiddleware, async (req, res) => {
  try {
    const { sourceCurrency, targetCurrency, sourceAmount } = req.body;

    if (!sourceCurrency || !targetCurrency || !sourceAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const quote = await wise.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
    });

    res.json({
      success: true,
      quote,
    });
  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wise/transfer
 * Create and fund a transfer
 */
router.post('/transfer', authMiddleware, async (req, res) => {
  try {
    const { quoteId, targetAccountId, amount, currency, investmentId } = req.body;
    const userId = req.user.id;

    if (!quoteId || !targetAccountId || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const transactionId = `WISE-${Date.now()}-${userId.substring(0, 8)}`;

    // Create transfer
    const transfer = await wise.createTransfer({
      targetAccountId,
      quoteId,
      transactionId,
      reference: `Investment Return - ${investmentId || 'Direct'}`,
    });

    // Fund transfer
    const funded = await wise.fundTransfer(transfer.id, {
      type: 'BALANCE',
    });

    // Save transaction
    await pool.query(
      `INSERT INTO transactions (user_id, transaction_type, amount, currency, status, payment_method, external_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, 'transfer', amount, currency || 'USD', 'processing', 'wise', transfer.id, `Wise Transfer - ${investmentId || 'Direct'}`]
    );

    res.json({
      success: true,
      transferId: transfer.id,
      status: transfer.status,
      amount: transfer.targetAmount,
      currency: transfer.targetCurrency,
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wise/recipient
 * Create a recipient account
 */
router.post('/recipient', authMiddleware, async (req, res) => {
  try {
    const { accountHolderName, iban, currency } = req.body;
    const userId = req.user.id;

    if (!accountHolderName || !iban) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const account = await wise.createRecipientAccount({
      accountHolderName,
      iban,
      currency: currency || 'SAR',
      type: 'iban',
    });

    // Save recipient to database
    await pool.query(
      `INSERT INTO recipients (user_id, account_holder_name, iban, currency, external_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, accountHolderName, iban, currency || 'SAR', account.id]
    );

    res.json({
      success: true,
      recipientId: account.id,
      accountHolderName: account.accountHolderName,
    });
  } catch (error) {
    console.error('Recipient error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wise/status/:transferId
 * Get transfer status
 */
router.get('/status/:transferId', authMiddleware, async (req, res) => {
  try {
    const { transferId } = req.params;

    const status = await wise.getTransferStatus(transferId);

    res.json({
      success: true,
      transferId: status.id,
      status: status.status,
      amount: status.targetAmount,
      currency: status.targetCurrency,
      recipient: status.recipient,
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wise/rate
 * Get exchange rate
 */
router.get('/rate', async (req, res) => {
  try {
    const { source, target } = req.query;

    if (!source || !target) {
      return res.status(400).json({ error: 'Missing source or target currency' });
    }

    const rate = await wise.getExchangeRate(source, target);

    res.json({
      success: true,
      source,
      target,
      rate: rate.rate,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Rate error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wise/fees
 * Get transfer fees
 */
router.get('/fees', async (req, res) => {
  try {
    const { source, target, amount } = req.query;

    if (!source || !target || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const fees = await wise.getTransferFees(source, target, parseFloat(amount));

    res.json({
      success: true,
      fees,
    });
  } catch (error) {
    console.error('Fees error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wise/balance
 * Get account balance
 */
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const balance = await wise.getAccountBalance();

    res.json({
      success: true,
      balances: balance.balances,
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/wise/transfer/:transferId
 * Cancel a transfer
 */
router.delete('/transfer/:transferId', authMiddleware, async (req, res) => {
  try {
    const { transferId } = req.params;
    const userId = req.user.id;

    // Verify user owns this transfer
    const transactionResult = await pool.query(
      `SELECT * FROM transactions WHERE external_id = $1 AND user_id = $2`,
      [transferId, userId]
    );

    if (transactionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const cancelled = await wise.cancelTransfer(transferId);

    // Update transaction status
    await pool.query(
      `UPDATE transactions SET status = 'cancelled' WHERE external_id = $1`,
      [transferId]
    );

    res.json({
      success: true,
      message: 'Transfer cancelled successfully',
      transferId: cancelled.id,
    });
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wise/webhook
 * Handle webhook notifications
 */
router.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;

    // Process webhook
    const processedData = wise.processWebhook(webhookData);

    // Update transaction status
    const statusMap = {
      'pending': 'pending',
      'processing': 'processing',
      'converted': 'processing',
      'completed': 'completed',
      'failed': 'failed',
      'cancelled': 'cancelled',
    };

    await pool.query(
      `UPDATE transactions SET status = $1, updated_at = NOW() WHERE external_id = $2`,
      [statusMap[processedData.status] || 'pending', processedData.transferId]
    );

    res.json({ success: true, status: processedData.status });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
