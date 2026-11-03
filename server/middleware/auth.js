'use strict';
const jwt = require('jsonwebtoken');
const pool = require('../../database/db');

const authenticateToken = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return res.status(401).json({ error: 'Access token required' });
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Authentication service is not configured' });
  }
  let claims;
  try {
    claims = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!claims || typeof claims.userId !== 'string') {
    return res.status(401).json({ error: 'Invalid token claims' });
  }
  try {
    const result = await pool.query(
      'SELECT id, email, full_name, user_type, role, is_active FROM users WHERE id = $1',
      [claims.userId]
    );
    const user = result.rows[0];
    if (!user || user.is_active !== true) {
      return res.status(401).json({ error: 'Account is inactive or unavailable' });
    }
    // Never trust the user_type / role embedded in an old token.
    req.user = {
      userId: user.id,
      email: user.email,
      full_name: user.full_name,
      user_type: user.user_type,
      role: user.role
    };
    return next();
  } catch (error) {
    console.error('Authentication database lookup failed:', error.code || error.message);
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.user_type !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
};
const investorOnly = (req, res, next) => {
  if (req.user?.user_type !== 'investor') {
    return res.status(403).json({ error: 'Investor access required' });
  }
  return next();
};
const companyOnly = (req, res, next) => {
  if (req.user?.user_type !== 'company') {
    return res.status(403).json({ error: 'Company access required' });
  }
  return next();
};

module.exports = { authenticateToken, adminOnly, investorOnly, companyOnly };
