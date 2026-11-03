'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { positiveMoney } = require('../money');

router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
});

// Reserve an amount for a pending withdrawal. This does NOT perform a bank payout.
router.post('/withdraw', authenticateToken, async (req, res) => {
  const amount = positiveMoney(req.body?.amount);
  if (!amount) return res.status(400).json({ error: 'Enter a positive amount with at most 2 decimals' });
  const { userId } = req.user;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // The conditional update is atomic even under concurrent requests.
    const debit = await client.query(
      'UPDATE wallets SET balance = balance - $1::numeric, total_withdrawals = total_withdrawals + $1::numeric WHERE user_id = $2 AND balance >= $1::numeric RETURNING currency',
      [amount, userId]
    );
    if (!debit.rowCount) {
      const existing = await client.query('SELECT id FROM wallets WHERE user_id = $1', [userId]);
      await client.query('ROLLBACK');
      return res.status(existing.rowCount ? 400 : 404).json({
        error: existing.rowCount ? 'Insufficient balance' : 'Wallet not found'
      });
    }
    const transactionId = uuidv4();
    await client.query(
      'INSERT INTO transactions (id, user_id, transaction_type, amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [transactionId, userId, 'withdrawal', amount, debit.rows[0].currency, 'pending']
    );
    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Withdrawal request reserved; no bank transfer has been initiated',
      transactionId, amount, status: 'pending'
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    return res.status(500).json({ error: 'Failed to process withdrawal' });
  } finally {
    if (client) client.release();
  }
});

router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.userId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Admin-only internal ledger movement; this is not an external payment.
router.post('/transfer', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { toUserId } = req.body || {};
  const amount = positiveMoney(req.body?.amount);
  if (!amount || typeof toUserId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(toUserId) ||
      String(toUserId).toLowerCase() === String(userId).toLowerCase()) {
    return res.status(400).json({ error: 'Valid amount and a different recipient ID required' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const adminCheck = await client.query(
      'SELECT 1 FROM users WHERE id = $1 AND user_type = $2', [userId, 'admin']
    );
    if (!adminCheck.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only admins can transfer funds' });
    }
    // Lock in deterministic order. PostgreSQL numeric balances stay strings.
    const rows = await client.query(
      'SELECT user_id, currency FROM wallets WHERE user_id IN ($1, $2) ORDER BY user_id FOR UPDATE',
      [userId, toUserId]
    );
    const source = rows.rows.find(row => String(row.user_id).toLowerCase() === String(userId).toLowerCase());
    const recipient = rows.rows.find(row => String(row.user_id).toLowerCase() === toUserId.toLowerCase());
    if (!source || !recipient) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source or destination wallet not found' });
    }
    if (source.currency !== recipient.currency) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Wallet currencies must match' });
    }
    const debit = await client.query(
      'UPDATE wallets SET balance = balance - $1::numeric WHERE user_id = $2 AND balance >= $1::numeric RETURNING id',
      [amount, userId]
    );
    if (!debit.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    const credit = await client.query(
      'UPDATE wallets SET balance = balance + $1::numeric WHERE user_id = $2 RETURNING id',
      [amount, toUserId]
    );
    if (!credit.rowCount) throw new Error('Recipient disappeared during transfer');
    await client.query(
      'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, new_values) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [userId, 'wallet.internal_transfer', 'wallet', toUserId,
        JSON.stringify({ sourceUserId: userId, destinationUserId: toUserId, amount, currency: source.currency })]
    );
    await client.query('COMMIT');
    return res.json({ message: 'Internal transfer completed', amount, currency: source.currency });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    return res.status(500).json({ error: 'Failed to transfer funds' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
