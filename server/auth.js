const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

const router = express.Router();

// POST /api/auth/login — multi-user login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'deactivated') {
      return res.status(403).json({ error: 'Account deactivated. Contact an administrator.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Account pending. Please accept your invitation first.' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.updateUserLogin(user.id);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, email: user.email, role: user.role, userId: user.id });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/validate-invitation/:token — public
router.get('/validate-invitation/:token', (req, res) => {
  try {
    const invitation = db.getInvitationByToken(req.params.token);
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (invitation.status !== 'pending') {
      return res.status(410).json({ error: `Invitation already ${invitation.status}` });
    }

    const now = Math.floor(Date.now() / 1000);
    if (invitation.expires_at < now) {
      db.updateInvitationStatus(invitation.id, 'expired', null);
      return res.status(410).json({ error: 'Invitation expired' });
    }

    res.json({ email: invitation.email, role: invitation.role });
  } catch (err) {
    console.error('[Auth] Validate invitation error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/accept-invitation — public
router.post('/accept-invitation', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const invitation = db.getInvitationByToken(token);
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (invitation.status !== 'pending') {
      return res.status(410).json({ error: `Invitation already ${invitation.status}` });
    }

    const now = Math.floor(Date.now() / 1000);
    if (invitation.expires_at < now) {
      db.updateInvitationStatus(invitation.id, 'expired', null);
      return res.status(410).json({ error: 'Invitation expired' });
    }

    // Check if user already exists
    const existingUser = db.getUserByEmail(invitation.email);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    db.createUser(userId, invitation.email, passwordHash, invitation.role, 'active');
    db.updateInvitationStatus(invitation.id, 'accepted', now);

    res.json({ success: true, email: invitation.email });
  } catch (err) {
    console.error('[Auth] Accept invitation error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Middleware ---

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { router, verifyToken, requireAdmin };
