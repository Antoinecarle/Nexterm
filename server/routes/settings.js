const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const SSH_DIR = '/root/.ssh';
const KEY_PATH = path.join(SSH_DIR, 'id_ed25519');
const PUB_KEY_PATH = KEY_PATH + '.pub';

// GET /api/settings/ssh-key — Read public SSH key
router.get('/ssh-key', (req, res) => {
  try {
    if (fs.existsSync(PUB_KEY_PATH)) {
      const key = fs.readFileSync(PUB_KEY_PATH, 'utf8').trim();
      res.json({ key, exists: true });
    } else {
      res.json({ key: null, exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/ssh-key/regenerate — Regenerate SSH key pair
router.post('/ssh-key/regenerate', (req, res) => {
  try {
    // Ensure .ssh directory exists
    if (!fs.existsSync(SSH_DIR)) {
      fs.mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });
    }

    // Remove existing key pair
    if (fs.existsSync(KEY_PATH)) fs.unlinkSync(KEY_PATH);
    if (fs.existsSync(PUB_KEY_PATH)) fs.unlinkSync(PUB_KEY_PATH);

    // Generate new ed25519 key
    execSync(`ssh-keygen -t ed25519 -C "vps-core" -f ${KEY_PATH} -N "" -q`, {
      stdio: 'pipe'
    });

    const key = fs.readFileSync(PUB_KEY_PATH, 'utf8').trim();
    res.json({ key, exists: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/ssh-test — Test SSH connection to GitHub
router.post('/ssh-test', (req, res) => {
  exec(
    'ssh -T git@github.com -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 2>&1',
    { timeout: 15000 },
    (error, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      // GitHub returns exit code 1 even on success with message:
      // "Hi <username>! You've successfully authenticated..."
      const match = output.match(/Hi ([^!]+)!/);
      if (match) {
        res.json({ success: true, username: match[1] });
      } else {
        res.json({ success: false, error: output.trim() || 'Connection failed' });
      }
    }
  );
});

module.exports = router;
