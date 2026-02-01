const express = require('express');
const { execSync, exec } = require('child_process');

const router = express.Router();

function dockerCmd(cmd) {
  return execSync(`docker ${cmd} 2>&1`, { timeout: 15000 }).toString().trim();
}

router.get('/containers', (req, res) => {
  try {
    const output = dockerCmd('ps -a --format "{{json .}}"');
    if (!output) return res.json([]);
    const containers = output.split('\n').filter(Boolean).map(line => {
      const c = JSON.parse(line);
      return {
        id: c.ID,
        name: c.Names,
        image: c.Image,
        status: c.Status,
        state: c.State,
        ports: c.Ports,
        created: c.CreatedAt
      };
    });
    res.json(containers);
  } catch (err) {
    if (err.message.includes('Cannot connect') || err.message.includes('not found')) {
      return res.json({ error: 'Docker not available', containers: [] });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/images', (req, res) => {
  try {
    const output = dockerCmd('images --format "{{json .}}"');
    if (!output) return res.json([]);
    const images = output.split('\n').filter(Boolean).map(line => {
      const img = JSON.parse(line);
      return {
        id: img.ID,
        repository: img.Repository,
        tag: img.Tag,
        size: img.Size,
        created: img.CreatedAt
      };
    });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/containers/:id/:action', (req, res) => {
  const { id, action } = req.params;
  const allowed = ['start', 'stop', 'restart', 'pause', 'unpause', 'remove'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  try {
    const cmd = action === 'remove' ? `rm -f ${id}` : `${action} ${id}`;
    const output = dockerCmd(cmd);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/containers/:id/logs', (req, res) => {
  const { id } = req.params;
  const lines = req.query.lines || 100;
  try {
    const output = dockerCmd(`logs --tail ${lines} ${id}`);
    res.json({ logs: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
