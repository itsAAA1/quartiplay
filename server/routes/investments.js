'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { positiveMoney } = require('../money');
const { v4: uuidv4 } = require('uuid');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A pending investment reserves capacity only. It does NOT debit a wallet,
// verify a payment, nor create a legally binding investment agreement.
router.post('/', authenticateToken, async (req, res) => {
  const amount = positiveMoney(req.body?.amount);
  const opportunityId = req.body?.opportunity_id;
  if (!amount || typeof opportunityId !== 'string' || !uuidPattern.test(opportunityId)) {
    return res.status(400).json({ error: 'Valid opportunity and positive decimal amount required' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const investor = await client.query('SELECT id FROM investors WHERE user_id = $1', [req.user.userId]);
    if (!investor.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only investors can reserve investment capacity' });
    }
    // Conditional UPDATE is serialized by PostgreSQL row locking under concurrency.
    const reserve = await client.query(
      \`UPDATE opportunities SET
         current_amount = current_amount + $1::numeric,
         investor_count = investor_count + 1
       WHERE id = $2 AND status = 'open'
         AND $1::numeric >= min_investment
         AND (max_investment IS NULL OR $1::numeric <= max_investment)
         AND current_amount + $1::numeric <= target_amount
       RETURNING id\`,
      [amount, opportunityId]
    );
    if (!reserve.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Opportunity unavailable or investment exceeds permitted limits' });
    }
    const investmentId = uuidv4();
    await client.query(
      "INSERT INTO investments (id, investor_id, opportunity_id, amount, status, investment_date) VALUES ($1,$2,$3,$4,'pending',NOW())",
      [investmentId, investor.rows[0].id, opportunityId, amount]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Investment capacity reserved (pending); no payment collected',
      investmentId,
      status: 'pending'
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Investment reservation failed:', error.code || error.message);
    return res.status(500).json({ error: 'Failed to create investment reservation' });
  } finally {
    if (client) client.release();
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'Invalid investment ID' });
  try {
    const result = await pool.query(
      \`SELECT i.*, o.title, c.company_name FROM investments i
       JOIN opportunities o ON i.opportunity_id = o.id
       JOIN companies c ON o.company_id = c.id
       JOIN investors v ON i.investor_id = v.id
       WHERE i.id = $1 AND (v.user_id = $2 OR c.user_id = $2 OR $3 = 'admin')\`,
      [req.params.id, req.user.userId, req.user.user_type]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Investment not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Investment lookup failed:', error.code || error.message);
    return res.status(500).json({ error: 'Failed to fetch investment' });
  }
});

router.put('/:id/cancel', authenticateToken, async (req, res) => {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'Invalid investment ID' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const owned = await client.query(
      \`SELECT i.amount, i.opportunity_id FROM investments i
       JOIN investors v ON i.investor_id = v.id
       WHERE i.id = $1 AND v.user_id = $2 AND i.status = 'pending'
       FOR UPDATE OF i\`,
      [req.params.id, req.user.userId]
    );
    if (!owned.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Investment not found or no longer cancellable' });
    }
    const row = owned.rows[0];
    const decrement = await client.query(
      \`UPDATE opportunities SET
         current_amount = current_amount - $1::numeric,
         investor_count = investor_count - 1
       WHERE id = $2 AND current_amount >= $1::numeric AND investor_count > 0
       RETURNING id\`,
      [row.amount, row.opportunity_id]
    );
    if (!decrement.rowCount) throw new Error('Opportunity reservation counters inconsistent');
    await client.query("UPDATE investments SET status = 'cancelled' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    return res.json({ message: 'Pending investment reservation cancelled' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Investment cancellation failed:', error.code || error.message);
    return res.status(500).json({ error: 'Failed to cancel investment reservation' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
