const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');

// Get Investor Profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT u.*, i.* FROM users u 
       LEFT JOIN investors i ON u.id = i.user_id 
       WHERE u.id = $1 AND u.user_type = 'investor'`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update Investor Profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { country, city, preferred_investment_type } = req.body;

    await pool.query(
      `UPDATE investors SET country = $1, city = $2, preferred_investment_type = $3 
       WHERE user_id = $4`,
      [country, city, preferred_investment_type, userId]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get Investor Investments
router.get('/investments', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT i.*, o.title, c.company_name FROM investments i
       JOIN opportunities o ON i.opportunity_id = o.id
       JOIN companies c ON o.company_id = c.id
       WHERE i.investor_id = (SELECT id FROM investors WHERE user_id = $1)
       ORDER BY i.investment_date DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

// Get Investor Dashboard Stats
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    
    const stats = await pool.query(
      `SELECT 
        (SELECT SUM(amount) FROM investments WHERE investor_id = (SELECT id FROM investors WHERE user_id = $1) AND status = 'confirmed') as total_invested,
        (SELECT SUM(return_amount) FROM returns WHERE investment_id IN (SELECT id FROM investments WHERE investor_id = (SELECT id FROM investors WHERE user_id = $1))) as total_returns,
        (SELECT balance FROM wallets WHERE user_id = $1) as wallet_balance,
        (SELECT COUNT(*) FROM investments WHERE investor_id = (SELECT id FROM investors WHERE user_id = $1) AND status = 'confirmed') as active_investments
      `,
      [userId]
    );

    res.json(stats.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
