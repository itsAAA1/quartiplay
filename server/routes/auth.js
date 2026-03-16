const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../database/db');
const { v4: uuidv4 } = require('uuid');

// Register
router.post('/register', [
  body('email').isEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').notEmpty(),
  body('user_type').isIn(['investor', 'company'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password, full_name, user_type } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await pool.query(
      'INSERT INTO users (id, email, password_hash, full_name, user_type) VALUES ($1, $2, $3, $4, $5)',
      [userId, email, hashedPassword, full_name, user_type]
    );

    if (user_type === 'investor') {
      await pool.query(
        'INSERT INTO investors (id, user_id) VALUES ($1, $2)',
        [uuidv4(), userId]
      );
    } else if (user_type === 'company') {
      await pool.query(
        'INSERT INTO companies (id, user_id, company_name) VALUES ($1, $2, $3)',
        [uuidv4(), userId, full_name]
      );
    }

    const token = jwt.sign({ userId, user_type }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRY
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { userId, email, full_name, user_type }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, user_type: user.user_type },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY }
    );

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      message: 'Login successful',
      token,
      user: {
        userId: user.id,
        email: user.email,
        full_name: user.full_name,
        user_type: user.user_type
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Token
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
