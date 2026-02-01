const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function safePath(p) {
  // Resolve and ensure it's absolute
  return path.resolve(p || '/');
}

router.get('/list', (req, res) => {
  try {
    const dirPath = safePath(req.query.path || '/');
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map(entry => {
      let stat = null;
      try {
        stat = fs.statSync(path.join(dirPath, entry.name));
      } catch {}
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymlink: entry.isSymbolicLink(),
        size: stat ? stat.size : 0,
        modified: stat ? stat.mtime : null,
        permissions: stat ? '0' + (stat.mode & parseInt('777', 8)).toString(8) : null
      };
    });
    // Sort: directories first, then files, alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: dirPath, items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/read', (req, res) => {
  try {
    const filePath = safePath(req.query.path);
    const stat = fs.statSync(filePath);
    // Limit file size to 2MB for reading
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 2MB)' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ path: filePath, content, size: stat.size });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/write', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Path required' });
    fs.writeFileSync(safePath(filePath), content || '', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/mkdir', (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'Path required' });
    fs.mkdirSync(safePath(dirPath), { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', (req, res) => {
  try {
    const filePath = safePath(req.query.path);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
