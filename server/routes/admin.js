const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// --- Users ---

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'deactivated'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be active or deactivated.' });
    }

    const user = db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deactivating yourself
    if (req.params.id === req.user.userId && status === 'deactivated') {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    db.updateUserStatus(req.params.id, status);
    res.json({ success: true, id: req.params.id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or member.' });
    }

    const user = db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent removing your own admin role
    if (req.params.id === req.user.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot remove your own admin role' });
    }

    db.updateUserRole(req.params.id, role);
    res.json({ success: true, id: req.params.id, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Invitations ---

// POST /api/admin/invitations
router.post('/invitations', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const validRole = ['admin', 'member'].includes(role) ? role : 'member';

    // Check if user already exists
    const existingUser = db.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Check for pending invitation
    const existingInv = db.getPendingInvitationByEmail(email);
    if (existingInv) {
      return res.status(409).json({ error: 'A pending invitation already exists for this email' });
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days

    db.createInvitation(id, email, token, validRole, req.user.userId, expiresAt);

    // Build invitation link
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const inviteLink = `${protocol}://${host}/invite/${token}`;

    // Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(resendKey);

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'NextTerm <onboarding@resend.dev>',
          to: email,
          subject: 'You\'re invited to NextTerm',
          html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0b10;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:40px;background:#161827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="width:56px;height:56px;margin:0 auto 16px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;line-height:56px;font-size:26px;">&#9889;</div>
      <h1 style="color:#eaedf3;font-size:22px;margin:0;">Welcome to NextTerm</h1>
      <p style="color:#7a7f96;margin-top:8px;font-size:14px;">You've been invited to join as <strong style="color:#eaedf3;">${validRole}</strong></p>
    </div>
    <p style="color:#7a7f96;font-size:14px;line-height:1.6;margin-bottom:24px;">
      Click the button below to create your account and set your password. This invitation expires in 7 days.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${inviteLink}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Accept Invitation
      </a>
    </div>
    <p style="color:#555870;font-size:12px;text-align:center;">
      Or copy this link: <span style="color:#7a7f96;">${inviteLink}</span>
    </p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:24px 0;">
    <p style="color:#555870;font-size:11px;text-align:center;">
      NextTerm — Self-hosted VPS Management
    </p>
  </div>
</body>
</html>
          `.trim(),
        });
        console.log(`[Admin] Invitation email sent to ${email}`);
      } catch (emailErr) {
        console.error('[Admin] Failed to send invitation email:', emailErr.message);
        // Invitation is still created in DB even if email fails
      }
    } else {
      console.warn('[Admin] RESEND_API_KEY not configured, invitation email not sent');
    }

    res.json({ success: true, id, email, role: validRole, token, inviteLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/invitations
router.get('/invitations', (req, res) => {
  try {
    const invitations = db.getAllInvitations();
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/invitations/:id
router.delete('/invitations/:id', (req, res) => {
  try {
    db.revokeInvitation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Email Settings ---

// GET /api/admin/email-settings
router.get('/email-settings', (req, res) => {
  res.json({
    resendApiKey: process.env.RESEND_API_KEY ? '****' + process.env.RESEND_API_KEY.slice(-6) : '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'NextTerm <onboarding@resend.dev>',
    configured: !!process.env.RESEND_API_KEY,
  });
});

// PUT /api/admin/email-settings
router.put('/email-settings', (req, res) => {
  try {
    const { resendApiKey, fromEmail } = req.body;
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '..', '.env');

    let envContent = fs.readFileSync(envPath, 'utf8');

    if (resendApiKey && resendApiKey !== '') {
      if (envContent.match(/^RESEND_API_KEY=.*$/m)) {
        envContent = envContent.replace(/^RESEND_API_KEY=.*$/m, `RESEND_API_KEY=${resendApiKey}`);
      } else {
        envContent += `\nRESEND_API_KEY=${resendApiKey}`;
      }
      process.env.RESEND_API_KEY = resendApiKey;
    }

    if (fromEmail) {
      if (envContent.match(/^RESEND_FROM_EMAIL=.*$/m)) {
        envContent = envContent.replace(/^RESEND_FROM_EMAIL=.*$/m, `RESEND_FROM_EMAIL=${fromEmail}`);
      } else {
        envContent += `\nRESEND_FROM_EMAIL=${fromEmail}`;
      }
      process.env.RESEND_FROM_EMAIL = fromEmail;
    }

    fs.writeFileSync(envPath, envContent);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
