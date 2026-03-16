const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');

// Get Company Profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT u.*, c.* FROM users u 
       LEFT JOIN companies c ON u.id = c.user_id 
       WHERE u.id = $1 AND u.user_type = 'company'`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch company profile' });
  }
});

// Update Company Profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { company_name, company_description, industry, founded_year, employee_count, company_website } = req.body;

    await pool.query(
      `UPDATE companies SET company_name = $1, company_description = $2, industry = $3, founded_year = $4, employee_count = $5, company_website = $6
       WHERE user_id = $7`,
      [company_name, company_description, industry, founded_year, employee_count, company_website, userId]
    );

    res.json({ message: 'Company profile updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update company profile' });
  }
});

// Get Company Opportunities
router.get('/opportunities', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT o.* FROM opportunities o
       JOIN companies c ON o.company_id = c.id
       WHERE c.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// Get Company Investors
router.get('/investors', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const result = await pool.query(
      `SELECT DISTINCT u.id, u.email, u.full_name, SUM(i.amount) as total_invested
       FROM investments i
       JOIN investors inv ON i.investor_id = inv.id
       JOIN users u ON inv.user_id = u.id
       JOIN opportunities o ON i.opportunity_id = o.id
       JOIN companies c ON o.company_id = c.id
       WHERE c.user_id = $1 AND i.status = 'confirmed'
       GROUP BY u.id, u.email, u.full_name
       ORDER BY total_invested DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch investors' });
  }
});

// Get Company Dashboard Stats
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    
    const stats = await pool.query(
      `SELECT 
        (SELECT SUM(amount) FROM investments WHERE opportunity_id IN (SELECT id FROM opportunities WHERE company_id = (SELECT id FROM companies WHERE user_id = $1)) AND status = 'confirmed') as total_raised,
        (SELECT COUNT(DISTINCT investor_id) FROM investments WHERE opportunity_id IN (SELECT id FROM opportunities WHERE company_id = (SELECT id FROM companies WHERE user_id = $1)) AND status = 'confirmed') as total_investors,
        (SELECT COUNT(*) FROM opportunities WHERE company_id = (SELECT id FROM companies WHERE user_id = $1) AND status = 'active') as active_opportunities,
        (SELECT SUM(return_amount) FROM returns WHERE investment_id IN (SELECT id FROM investments WHERE opportunity_id IN (SELECT id FROM opportunities WHERE company_id = (SELECT id FROM companies WHERE user_id = $1)))) as total_returns_paid
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
