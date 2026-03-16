const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Create Investment
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { opportunity_id, amount } = req.body;

    // Get investor ID
    const investorResult = await pool.query(
      'SELECT id FROM investors WHERE user_id = $1',
      [userId]
    );

    if (investorResult.rows.length === 0) {
      return res.status(403).json({ error: 'Only investors can make investments' });
    }

    const investorId = investorResult.rows[0].id;

    // Check opportunity exists and is active
    const opportunityResult = await pool.query(
      'SELECT * FROM opportunities WHERE id = $1 AND status = $2',
      [opportunity_id, 'active']
    );

    if (opportunityResult.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found or inactive' });
    }

    const opportunity = opportunityResult.rows[0];

    // Validate investment amount
    if (amount < opportunity.min_investment || amount > opportunity.max_investment) {
      return res.status(400).json({ error: 'Investment amount out of range' });
    }

    // Check if target is reached
    if (opportunity.current_amount + amount > opportunity.target_amount) {
      return res.status(400).json({ error: 'Investment exceeds target amount' });
    }

    // Create investment
    const investmentId = uuidv4();
    await pool.query(
      `INSERT INTO investments (id, investor_id, opportunity_id, amount, status, investment_date)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [investmentId, investorId, opportunity_id, amount]
    );

    // Update opportunity current amount
    await pool.query(
      `UPDATE opportunities SET current_amount = current_amount + $1, investor_count = investor_count + 1
       WHERE id = $2`,
      [amount, opportunity_id]
    );

    res.status(201).json({
      message: 'Investment created successfully',
      investmentId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create investment' });
  }
});

// Get Investment Details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const result = await pool.query(
      `SELECT i.*, o.title, c.company_name FROM investments i
       JOIN opportunities o ON i.opportunity_id = o.id
       JOIN companies c ON o.company_id = c.id
       WHERE i.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Investment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch investment' });
  }
});

// Cancel Investment
router.put('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT i.id, i.amount, i.opportunity_id FROM investments i
       JOIN investors inv ON i.investor_id = inv.id
       WHERE i.id = $1 AND inv.user_id = $2 AND i.status = 'pending'`,
      [id, userId]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized or investment cannot be cancelled' });
    }

    const investment = ownership.rows[0];

    // Update investment status
    await pool.query(
      'UPDATE investments SET status = $1 WHERE id = $2',
      ['cancelled', id]
    );

    // Revert opportunity amount
    await pool.query(
      `UPDATE opportunities SET current_amount = current_amount - $1, investor_count = investor_count - 1
       WHERE id = $2`,
      [investment.amount, investment.opportunity_id]
    );

    res.json({ message: 'Investment cancelled successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to cancel investment' });
  }
});

module.exports = router;
