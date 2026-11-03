'use strict';
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const signToken = (user) => jwt.sign(
  { userId: user.id, user_type: user.user_type },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRY || '1d' }
);

const validRegistration = [
  body('email').isString().trim().isEmail(),
  body('password').isString().isLength({ min: 8, max: 128 }),
  body('full_name').isString().trim().isLength({ min: 2, max: 120 }),
  body('user_type').isIn(['investor', 'company'])
];

// User, required profile and wallet either all commit, or none are created.
router.post('/register', validRegistration, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Authentication service is not configured' });
  }
  const { password, user_type } = req.body;
  const email = req.body.email.trim().toLowerCase();
  const full_name = req.body.full_name.trim();
  const userId = uuidv4();
  let client;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO users (id, email, password_hash, full_name, user_type) VALUES ($1, $2, $3, $4, $5)',
      [userId, email, hashedPassword, full_name, user_type]
    );

    if (user_type === 'investor') {
      await client.query(
        'INSERT INTO investors (id, user_id) VALUES ($1, $2)',
        [uuidv4(), userId]
      );
    } else {
      await client.query(
        'INSERT INTO companies (id, user_id, company_name) VALUES ($1, $2, $3)',
        [uuidv4(), userId, full_name]
      );
    }
    await client.query(
      'INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)',
      [userId, '0.00', 'USD']
    );
    const user = { id: userId, userId, email, full_name, user_type };
    // Sign before commit so a configuration failure cannot leave a user without a usable login response.
    const token = signToken(user);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { userId, email, full_name, user_type }
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Registration failed:', error.code || error.message);
    return res.status(500).json({ error: 'Registration failed' });
  } finally {
    if (client) client.release();
  }
});

router.post('/login', [
  body('email').isString().trim().isEmail(),
  body('password').isString().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Authentication service is not configured' });
  }

  try {
    const email = req.body.email.trim().toLowerCase();
    const result = await pool.query(
      'SELECT id, email, password_hash, full_name, user_type, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    const user = result.rows[0];
    if (!user || user.is_active !== true || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // The schema does not include last_login; do not update a nonexistent column.
    return res.json({
      message: 'Login successful',
      token: signToken(user),
      user: { userId: user.id, email: user.email, full_name: user.full_name, user_type: user.user_type }
    });
  } catch (error) {
    console.error('Login failed:', error.code || error.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Always recheck account status and role from the database.
router.get('/verify', authenticateToken, (req, res) => {
  const { userId, email, full_name, user_type } = req.user;
  return res.json({ valid: true, user: { userId, email, full_name, user_type } });
});

module.exports = router;
