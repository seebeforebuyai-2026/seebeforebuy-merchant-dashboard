/**
 * Auth routes — proxies to the live EC2 backend
 * POST /api/auth/login
 * POST /api/auth/change-password
 *
 * All DynamoDB calls happen on EC2 where IAM credentials are valid.
 * The JWT issued by EC2 is reused here for dashboard API calls.
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const BACKEND_URL = process.env.BACKEND_URL || 'https://seebeforebuy.in';
const JWT_SECRET  = process.env.JWT_SECRET  || 'seebeforebuy';

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Call the live backend login endpoint
    const response = await fetch(`${BACKEND_URL}/api/merchant/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || 'Login failed' });
    }

    res.json(data); // pass token + shop info straight through

  } catch (err) {
    console.error('❌ Login proxy error:', err.message);
    res.status(500).json({ error: 'Cannot connect to backend. Please try again.' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization;

    const response = await fetch(`${BACKEND_URL}/api/merchant/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token, // forward JWT to backend
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (err) {
    console.error('❌ Change password proxy error:', err.message);
    res.status(500).json({ error: 'Cannot connect to backend.' });
  }
});

// ── Middleware: verify JWT (issued by EC2 backend) ────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.shop = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
