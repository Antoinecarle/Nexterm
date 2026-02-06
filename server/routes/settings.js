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

// --- API Keys Management ---

// GET /api/settings/api-keys — Read masked API keys + status
router.get('/api-keys', (req, res) => {
  const mask = (key) => key ? '****' + key.slice(-6) : '';
  res.json({
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      masked: mask(process.env.OPENAI_API_KEY),
    },
    googleAi: {
      configured: !!process.env.GOOGLE_AI_API_KEY,
      masked: mask(process.env.GOOGLE_AI_API_KEY),
    },
  });
});

// PUT /api/settings/api-keys — Write API keys to .env + update process.env
router.put('/api-keys', (req, res) => {
  try {
    const { openaiApiKey, googleAiApiKey } = req.body;
    const envPath = path.join(__dirname, '..', '..', '.env');

    let envContent = fs.readFileSync(envPath, 'utf8');

    if (openaiApiKey && openaiApiKey !== '') {
      if (envContent.match(/^OPENAI_API_KEY=.*$/m)) {
        envContent = envContent.replace(/^OPENAI_API_KEY=.*$/m, `OPENAI_API_KEY=${openaiApiKey}`);
      } else {
        envContent += `\nOPENAI_API_KEY=${openaiApiKey}`;
      }
      process.env.OPENAI_API_KEY = openaiApiKey;
    }

    if (googleAiApiKey && googleAiApiKey !== '') {
      if (envContent.match(/^GOOGLE_AI_API_KEY=.*$/m)) {
        envContent = envContent.replace(/^GOOGLE_AI_API_KEY=.*$/m, `GOOGLE_AI_API_KEY=${googleAiApiKey}`);
      } else {
        envContent += `\nGOOGLE_AI_API_KEY=${googleAiApiKey}`;
      }
      process.env.GOOGLE_AI_API_KEY = googleAiApiKey;
    }

    fs.writeFileSync(envPath, envContent);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
