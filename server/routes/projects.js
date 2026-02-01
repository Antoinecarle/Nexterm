const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const multer = require('multer');
const { getSessionsByProject } = require('../terminal');

const PROJECT_ROOT = '/root/ProjectList';
const NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const MAX_FILE_COUNT = 5000;

// Ensure project root exists
if (!fs.existsSync(PROJECT_ROOT)) {
  fs.mkdirSync(PROJECT_ROOT, { recursive: true });
}

// GET / — List projects with metadata
router.get('/', (req, res) => {
  try {
    const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
    const projects = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const fullPath = path.join(PROJECT_ROOT, e.name);
        const stat = fs.statSync(fullPath);
        let size = 0;
        try {
          size = parseInt(execSync(`du -sb "${fullPath}" 2>/dev/null`).toString().split('\t')[0], 10) || 0;
        } catch (_) {}
        return {
          name: e.name,
          created: stat.birthtime || stat.ctime,
          size,
        };
      });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — Create empty project
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid project name. Use only letters, numbers, hyphens, and underscores.' });
  }

  const fullPath = path.join(PROJECT_ROOT, name);
  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'Project already exists.' });
  }

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    const stat = fs.statSync(fullPath);
    res.json({ name, created: stat.birthtime || stat.ctime, size: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /import — Clone GitHub repo via SSE
router.post('/import', (req, res) => {
  const { url, name } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // Extract repo name from URL if no name provided
  const urlMatch = url.match(/\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/);
  const projectName = name || (urlMatch ? urlMatch[1] : null);

  if (!projectName || !NAME_REGEX.test(projectName)) {
    return res.status(400).json({ error: 'Invalid project name. Use only letters, numbers, hyphens, and underscores.' });
  }

  const fullPath = path.join(PROJECT_ROOT, projectName);
  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'Project already exists.' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('progress', { message: `Cloning ${url} into ${projectName}...` });

  const gitProcess = spawn('git', ['clone', '--progress', url, fullPath], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let aborted = false;

  const cleanup = () => {
    if (aborted) return;
    aborted = true;
    try { gitProcess.kill(); } catch (_) {}
    // Remove partially cloned directory
    try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch (_) {}
  };

  req.on('close', () => {
    if (!aborted) {
      cleanup();
    }
  });

  gitProcess.stdout.on('data', (data) => {
    sendEvent('progress', { message: data.toString() });
  });

  gitProcess.stderr.on('data', (data) => {
    // git clone sends progress to stderr
    sendEvent('progress', { message: data.toString() });
  });

  gitProcess.on('close', (code) => {
    if (aborted) return;
    if (code === 0) {
      sendEvent('done', { name: projectName, message: 'Clone completed successfully.' });
    } else {
      // Cleanup failed clone
      try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch (_) {}
      sendEvent('error', { message: `Git clone failed with exit code ${code}.` });
    }
    res.end();
  });

  gitProcess.on('error', (err) => {
    if (aborted) return;
    try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch (_) {}
    sendEvent('error', { message: err.message });
    res.end();
  });
});

// POST /upload — Upload a folder to create a new project
const createTempDir = (req, res, next) => {
  req.uploadTempDir = path.join('/tmp', `upload-${crypto.randomUUID()}`);
  fs.mkdirSync(req.uploadTempDir, { recursive: true });
  next();
};

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, req.uploadTempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${crypto.randomUUID()}-${file.originalname}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILE_COUNT,
  },
});

const cleanupTempDir = (dirPath) => {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {}
};

router.post('/upload', createTempDir, (req, res) => {
  const tempDir = req.uploadTempDir;

  upload.array('files', MAX_FILE_COUNT)(req, res, (multerErr) => {
    if (multerErr) {
      cleanupTempDir(tempDir);
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'A file exceeds the 50 MB size limit.' });
      }
      if (multerErr.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ error: `Too many files. Maximum is ${MAX_FILE_COUNT}.` });
      }
      return res.status(400).json({ error: multerErr.message });
    }

    try {
      const projectName = req.body.projectName;
      if (!projectName || !NAME_REGEX.test(projectName)) {
        cleanupTempDir(tempDir);
        return res.status(400).json({ error: 'Invalid project name. Use only letters, numbers, dots, hyphens, and underscores.' });
      }

      const projectPath = path.join(PROJECT_ROOT, projectName);
      if (fs.existsSync(projectPath)) {
        cleanupTempDir(tempDir);
        return res.status(409).json({ error: 'Project already exists.' });
      }

      let relativePaths;
      try {
        relativePaths = JSON.parse(req.body.relativePaths);
      } catch (_) {
        cleanupTempDir(tempDir);
        return res.status(400).json({ error: 'Invalid relativePaths format.' });
      }

      const files = req.files || [];
      if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
        cleanupTempDir(tempDir);
        return res.status(400).json({ error: 'relativePaths count does not match files count.' });
      }

      // Create project directory
      fs.mkdirSync(projectPath, { recursive: true });

      for (let i = 0; i < files.length; i++) {
        const relPath = relativePaths[i];

        // Validate: no path traversal
        const destPath = path.resolve(projectPath, relPath);
        if (!destPath.startsWith(projectPath + path.sep) && destPath !== projectPath) {
          // Rollback
          fs.rmSync(projectPath, { recursive: true, force: true });
          cleanupTempDir(tempDir);
          return res.status(400).json({ error: `Invalid file path: ${relPath}` });
        }

        // Create subdirectories
        const destDir = path.dirname(destPath);
        fs.mkdirSync(destDir, { recursive: true });

        // Move file from temp to destination (copyFile+unlink for cross-device support)
        fs.copyFileSync(files[i].path, destPath);
        fs.unlinkSync(files[i].path);
      }

      cleanupTempDir(tempDir);

      const stat = fs.statSync(projectPath);
      res.json({
        name: projectName,
        created: stat.birthtime || stat.ctime,
        fileCount: files.length,
      });
    } catch (err) {
      cleanupTempDir(tempDir);
      // Attempt to clean up partially created project
      try {
        const projectName = req.body.projectName;
        if (projectName && NAME_REGEX.test(projectName)) {
          const projectPath = path.join(PROJECT_ROOT, projectName);
          if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
          }
        }
      } catch (_) {}
      res.status(500).json({ error: err.message });
    }
  });
});

// GET /:name/terminals — List active terminal sessions for a project
router.get('/:name/terminals', (req, res) => {
  const { name } = req.params;
  if (!name || !NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid project name.' });
  }
  try {
    const sessions = getSessionsByProject(name);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:name — Delete project
router.delete('/:name', (req, res) => {
  const { name } = req.params;
  if (!name || !NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid project name.' });
  }

  const fullPath = path.join(PROJECT_ROOT, name);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
