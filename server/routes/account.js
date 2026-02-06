const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const AVATARS_DIR = path.join(__dirname, '..', '..', 'data', 'avatars');
// Legacy path for backwards compat
const LEGACY_AVATAR_PATH = path.join(__dirname, '..', '..', 'data', 'avatar.png');

function getAvatarPath(userId) {
  return path.join(AVATARS_DIR, `${userId}.png`);
}

// GET /api/account/profile — from DB
router.get('/profile', (req, res) => {
  try {
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const avatarPath = getAvatarPath(req.user.userId);
    const hasAvatar = fs.existsSync(avatarPath) || fs.existsSync(LEGACY_AVATAR_PATH);

    res.json({
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      email: user.email,
      role: user.role,
      status: user.status,
      hasAvatar,
      notifications: {
        email: true,
        security: true,
        updates: false,
        maintenance: true,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account/profile — to DB
router.put('/profile', (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const fn = firstName !== undefined ? String(firstName).trim() : user.first_name;
    const ln = lastName !== undefined ? String(lastName).trim() : user.last_name;

    db.updateUserProfile(req.user.userId, fn, ln);

    const avatarPath = getAvatarPath(req.user.userId);
    const hasAvatar = fs.existsSync(avatarPath) || fs.existsSync(LEGACY_AVATAR_PATH);

    res.json({
      firstName: fn,
      lastName: ln,
      email: user.email,
      role: user.role,
      hasAvatar,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account/notifications — kept as-is (profile.json still used for notifications)
router.put('/notifications', (req, res) => {
  try {
    const { notifications } = req.body;
    if (!notifications || typeof notifications !== 'object') {
      return res.status(400).json({ error: 'Invalid notifications object' });
    }
    // Notifications are client-side preference, just acknowledge
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/account/avatar — per-user avatar
router.post('/avatar', (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) {
      return res.status(400).json({ error: 'No avatar data provided' });
    }

    const matches = avatar.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image format. Send as base64 data URL.' });
    }

    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Maximum 2MB.' });
    }

    if (!fs.existsSync(AVATARS_DIR)) {
      fs.mkdirSync(AVATARS_DIR, { recursive: true });
    }

    fs.writeFileSync(getAvatarPath(req.user.userId), buffer);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account/avatar/:userId — any user's avatar (for presence)
router.get('/avatar/:userId', (req, res) => {
  try {
    const avatarPath = getAvatarPath(req.params.userId);
    if (fs.existsSync(avatarPath)) {
      return res.sendFile(avatarPath);
    }
    // Fallback to legacy avatar if requesting own avatar
    if (req.params.userId === req.user.userId && fs.existsSync(LEGACY_AVATAR_PATH)) {
      return res.sendFile(LEGACY_AVATAR_PATH);
    }
    return res.status(404).json({ error: 'No avatar found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account/avatar — per-user avatar (own)
router.get('/avatar', (req, res) => {
  try {
    const avatarPath = getAvatarPath(req.user.userId);
    if (fs.existsSync(avatarPath)) {
      return res.sendFile(avatarPath);
    }
    // Fallback to legacy path
    if (fs.existsSync(LEGACY_AVATAR_PATH)) {
      return res.sendFile(LEGACY_AVATAR_PATH);
    }
    return res.status(404).json({ error: 'No avatar found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/account/avatar
router.delete('/avatar', (req, res) => {
  try {
    const avatarPath = getAvatarPath(req.user.userId);
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account/password — from DB
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.updateUserPassword(req.user.userId, newHash);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
