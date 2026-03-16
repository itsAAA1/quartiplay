const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Get Wallet Balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
});

// Withdraw Funds
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { amount, bank_account } = req.body;

    // Check wallet balance
    const walletResult = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    if (walletResult.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create withdrawal transaction
    const transactionId = uuidv4();
    await pool.query(
      `INSERT INTO transactions (id, user_id, transaction_type, amount, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, userId, 'withdrawal', amount, 'pending']
    );

    // Update wallet
    await pool.query(
      `UPDATE wallets SET balance = balance - $1, total_withdrawals = total_withdrawals + $1, last_transaction_date = NOW()
       WHERE user_id = $2`,
      [amount, userId]
    );

    res.json({
      message: 'Withdrawal request created successfully',
      transactionId,
      amount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

// Get Wallet Transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Transfer Between Wallets (Admin Only)
router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { toUserId, amount } = req.body;

    // Check if user is admin
    const adminCheck = await pool.query(
      'SELECT user_type FROM users WHERE id = $1 AND user_type = $2',
      [userId, 'admin']
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only admins can transfer funds' });
    }

    // Check source wallet
    const sourceWallet = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (sourceWallet.rows.length === 0 || sourceWallet.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Transfer funds
    await pool.query(
      'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
      [amount, userId]
    );

    await pool.query(
      'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
      [amount, toUserId]
    );

    res.json({ message: 'Transfer completed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to transfer funds' });
  }
});

module.exports = router;
