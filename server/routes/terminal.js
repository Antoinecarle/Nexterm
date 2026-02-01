const express = require('express');
const fs = require('fs');
const path = require('path');
const { listSessions, createSession, destroySession, renameSession, getSessionInfo } = require('../terminal');

const router = express.Router();

const PROJECT_ROOT = '/root/ProjectList';

// GET /api/terminal/sessions
router.get('/sessions', (req, res) => {
  res.json(listSessions());
});

// POST /api/terminal/sessions
router.post('/sessions', (req, res) => {
  const { name, project, cols, rows } = req.body || {};
  const session = createSession(cols || 120, rows || 30, name || null, project || null);
  if (!session) {
    return res.status(429).json({ error: 'Max sessions reached' });
  }
  res.json({
    id: session.id,
    title: session.title,
    project: session.project,
    createdAt: session.createdAt,
  });
});

// PATCH /api/terminal/sessions/:id
router.patch('/sessions/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = renameSession(req.params.id, name);
  if (!result) return res.status(404).json({ error: 'Session not found' });
  res.json(result);
});

// DELETE /api/terminal/sessions/:id
router.delete('/sessions/:id', (req, res) => {
  destroySession(req.params.id);
  res.json({ ok: true });
});

// GET /api/terminal/projects
router.get('/projects', (req, res) => {
  try {
    if (!fs.existsSync(PROJECT_ROOT)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    res.json(dirs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

module.exports = router;
