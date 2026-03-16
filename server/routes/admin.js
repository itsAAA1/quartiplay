const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken, adminOnly } = require('../middleware/auth');

// Get Platform Statistics
router.get('/stats', authenticateToken, adminOnly, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE user_type = 'investor') as total_investors,
        (SELECT COUNT(*) FROM users WHERE user_type = 'company') as total_companies,
        (SELECT COUNT(*) FROM opportunities WHERE status = 'active') as active_opportunities,
        (SELECT SUM(amount) FROM investments WHERE status = 'confirmed') as total_invested,
        (SELECT COUNT(*) FROM investments WHERE status = 'confirmed') as total_investments,
        (SELECT SUM(balance) FROM wallets) as total_wallet_balance
    `);

    res.json(stats.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get All Users
router.get('/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT id, email, full_name, user_type, created_at, is_active FROM users
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Verify Company
router.put('/companies/:id/verify', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await pool.query(
      `UPDATE companies SET verification_status = $1, verification_date = NOW() WHERE id = $2`,
      [status, id]
    );

    res.json({ message: `Company ${status} successfully` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to verify company' });
  }
});

// Verify Investor
router.put('/investors/:id/verify', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await pool.query(
      `UPDATE investors SET verification_status = $1, verification_date = NOW() WHERE id = $2`,
      [status, id]
    );

    res.json({ message: `Investor ${status} successfully` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to verify investor' });
  }
});

// Get Pending Verifications
router.get('/pending-verifications', authenticateToken, adminOnly, async (req, res) => {
  try {
    const companies = await pool.query(
      `SELECT id, company_name, verification_status, created_at FROM companies WHERE verification_status = 'pending'`
    );

    const investors = await pool.query(
      `SELECT id, user_id, verification_status, created_at FROM investors WHERE verification_status = 'pending'`
    );

    res.json({
      pending_companies: companies.rows,
      pending_investors: investors.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch pending verifications' });
  }
});

// Get Transaction Logs
router.get('/transactions', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get Audit Logs
router.get('/audit-logs', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
