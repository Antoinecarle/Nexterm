const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');
const GENERATED_DIR = path.join(MEDIA_DIR, 'generated');

// Ensure media dir exists
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function getFileInfo(filePath, name) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(name).toLowerCase();
  let type = 'file';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) type = 'image';
  else if (['.mp4', '.mov', '.webm', '.avi'].includes(ext)) type = 'video';
  else if (['.pdf'].includes(ext)) type = 'pdf';
  else if (['.md', '.txt', '.json'].includes(ext)) type = 'text';
  return {
    name,
    size: stat.size,
    type,
    ext: ext.replace('.', ''),
    modified: stat.mtimeMs,
  };
}

// List all files in media/
router.get('/list', (req, res) => {
  try {
    if (!fs.existsSync(MEDIA_DIR)) return res.json([]);
    const files = fs.readdirSync(MEDIA_DIR)
      .filter((f) => !f.startsWith('.') && f !== 'generated')
      .map((f) => {
        try {
          return getFileInfo(path.join(MEDIA_DIR, f), f);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve a file
router.get('/file/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// Download a file
router.get('/download/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath, name);
});

// Upload files
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/upload', upload.array('files', 20), (req, res) => {
  try {
    const uploaded = (req.files || []).map((f) => f.originalname);
    res.json({ success: true, files: uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a file
router.delete('/file/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// --- Generated images ---

// Serve a generated image
router.get('/file/generated/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(GENERATED_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// List generated images
router.get('/list/generated', (req, res) => {
  try {
    if (!fs.existsSync(GENERATED_DIR)) return res.json([]);
    const files = fs.readdirSync(GENERATED_DIR)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        try {
          return getFileInfo(path.join(GENERATED_DIR, f), f);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Copy generated image to main library
router.post('/copy-to-library', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const src = path.join(GENERATED_DIR, filename);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not found' });
    const dest = path.join(MEDIA_DIR, filename);
    fs.copyFileSync(src, dest);
    res.json({ success: true, name: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a generated image
router.delete('/file/generated/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(GENERATED_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

module.exports = router;
