const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Get All Opportunities
router.get('/', async (req, res) => {
  try {
    const { status, funding_type, limit = 20, offset = 0 } = req.query;
    
    let query = `SELECT o.*, c.company_name, c.company_logo_url FROM opportunities o
                 JOIN companies c ON o.company_id = c.id WHERE o.status = 'active'`;
    const params = [];

    if (funding_type) {
      query += ` AND o.funding_type = $${params.length + 1}`;
      params.push(funding_type);
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// Get Opportunity Details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT o.*, c.company_name, c.company_description, c.company_logo_url 
       FROM opportunities o
       JOIN companies c ON o.company_id = c.id
       WHERE o.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch opportunity' });
  }
});

// Create Opportunity (Company Only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { title, description, target_amount, funding_type, min_investment, max_investment, duration_months, return_rate } = req.body;

    // Check if user is a company
    const companyCheck = await pool.query(
      'SELECT id FROM companies WHERE user_id = $1',
      [userId]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only companies can create opportunities' });
    }

    const opportunityId = uuidv4();
    await pool.query(
      `INSERT INTO opportunities (id, company_id, title, description, target_amount, funding_type, min_investment, max_investment, duration_months, return_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')`,
      [opportunityId, companyCheck.rows[0].id, title, description, target_amount, funding_type, min_investment, max_investment, duration_months, return_rate]
    );

    res.status(201).json({
      message: 'Opportunity created successfully',
      opportunityId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create opportunity' });
  }
});

// Update Opportunity (Company Only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { id } = req.params;
    const { title, description, target_amount, status } = req.body;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT o.id FROM opportunities o
       JOIN companies c ON o.company_id = c.id
       WHERE o.id = $1 AND c.user_id = $2`,
      [id, userId]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query(
      `UPDATE opportunities SET title = $1, description = $2, target_amount = $3, status = $4
       WHERE id = $5`,
      [title, description, target_amount, status, id]
    );

    res.json({ message: 'Opportunity updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update opportunity' });
  }
});

module.exports = router;
