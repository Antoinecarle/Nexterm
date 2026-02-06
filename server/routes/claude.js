const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const GLOBAL_CONFIG_PATH = path.join(CLAUDE_DIR, 'settings.local.json');
const GLOBAL_SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const GLOBAL_RULES_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');
const PROJECTS_DIRS = [
  path.join(os.homedir(), 'ProjectList'),
  path.join(os.homedir(), 'project')
];

const FULL_PERMISSIONS = {
  permissions: {
    allow: [
      "Bash",
      "Read",
      "Edit",
      "Write",
      "WebFetch",
      "WebSearch",
      "Task",
      "NotebookEdit",
      "Glob",
      "Grep",
      "mcp__*"
    ]
  }
};

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return null;
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function arraysEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

function findProjectConfigs() {
  const projects = [];
  const globalConfig = readJsonFile(GLOBAL_CONFIG_PATH);

  for (const baseDir of PROJECTS_DIRS) {
    if (!fs.existsSync(baseDir)) continue;

    // Check if baseDir itself has .claude config
    const baseDirConfig = path.join(baseDir, '.claude', 'settings.local.json');
    if (fs.existsSync(baseDirConfig)) {
      const config = readJsonFile(baseDirConfig);
      projects.push({
        name: path.basename(baseDir),
        path: baseDir,
        configPath: baseDirConfig,
        config,
        synced: globalConfig && config &&
          arraysEqual(config?.permissions?.allow, globalConfig?.permissions?.allow)
      });
    }

    // Check subdirectories
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectPath = path.join(baseDir, entry.name);
        const configPath = path.join(projectPath, '.claude', 'settings.local.json');

        if (fs.existsSync(configPath)) {
          const config = readJsonFile(configPath);
          projects.push({
            name: entry.name,
            path: projectPath,
            configPath,
            config,
            synced: globalConfig && config &&
              arraysEqual(config?.permissions?.allow, globalConfig?.permissions?.allow)
          });
        }
      }
    } catch (err) {
      console.error(`Error scanning ${baseDir}:`, err.message);
    }
  }

  return projects;
}

// GET /api/claude/config - Get all Claude configurations
router.get('/config', (req, res) => {
  try {
    const global = readJsonFile(GLOBAL_CONFIG_PATH);
    const projects = findProjectConfigs();

    res.json({
      global,
      globalPath: GLOBAL_CONFIG_PATH,
      projects
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/claude/apply-global - Apply global config to a specific project
router.post('/apply-global', (req, res) => {
  try {
    const { projectPath } = req.body;
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath required' });
    }

    const configPath = path.join(projectPath, '.claude', 'settings.local.json');
    writeJsonFile(configPath, FULL_PERMISSIONS);

    res.json({ success: true, path: configPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/claude/apply-global-all - Apply global config to all projects
router.post('/apply-global-all', (req, res) => {
  try {
    const projects = findProjectConfigs();
    const updated = [];

    for (const project of projects) {
      writeJsonFile(project.configPath, FULL_PERMISSIONS);
      updated.push(project.path);
    }

    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/claude/rules - Get CLAUDE.md content
router.get('/rules', (req, res) => {
  try {
    const globalRules = fs.existsSync(GLOBAL_RULES_PATH)
      ? fs.readFileSync(GLOBAL_RULES_PATH, 'utf-8')
      : '';

    // Get project-specific CLAUDE.md files
    const projectRules = [];
    for (const baseDir of PROJECTS_DIRS) {
      if (!fs.existsSync(baseDir)) continue;

      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const rulesPath = path.join(baseDir, entry.name, 'CLAUDE.md');
          if (fs.existsSync(rulesPath)) {
            projectRules.push({
              name: entry.name,
              path: rulesPath,
              content: fs.readFileSync(rulesPath, 'utf-8')
            });
          }
        }
      } catch (err) {
        console.error(`Error scanning ${baseDir}:`, err.message);
      }
    }

    res.json({
      global: {
        path: GLOBAL_RULES_PATH,
        content: globalRules
      },
      projects: projectRules
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/claude/rules - Update CLAUDE.md content
router.put('/rules', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content required' });
    }

    // Security: only allow writing to CLAUDE.md files
    if (!filePath.endsWith('CLAUDE.md')) {
      return res.status(400).json({ error: 'Can only edit CLAUDE.md files' });
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/claude/settings - Get settings.json (plugins, hooks, etc.)
router.get('/settings', (req, res) => {
  try {
    const settings = readJsonFile(GLOBAL_SETTINGS_PATH) || {};
    const settingsLocal = readJsonFile(GLOBAL_CONFIG_PATH) || {};

    res.json({
      settings: {
        path: GLOBAL_SETTINGS_PATH,
        content: settings
      },
      settingsLocal: {
        path: GLOBAL_CONFIG_PATH,
        content: settingsLocal
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/claude/settings - Update settings
router.put('/settings', (req, res) => {
  try {
    const { type, content } = req.body;
    if (!type || !content) {
      return res.status(400).json({ error: 'type and content required' });
    }

    const filePath = type === 'local' ? GLOBAL_CONFIG_PATH : GLOBAL_SETTINGS_PATH;
    writeJsonFile(filePath, content);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/claude/agents - Get custom agents configuration
router.get('/agents', (req, res) => {
  try {
    const agentsPath = path.join(CLAUDE_DIR, 'agents.json');
    let agents = {};

    if (fs.existsSync(agentsPath)) {
      agents = readJsonFile(agentsPath) || {};
    }

    res.json({
      path: agentsPath,
      agents
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/claude/agents - Update agents configuration
router.put('/agents', (req, res) => {
  try {
    const { agents } = req.body;
    if (!agents) {
      return res.status(400).json({ error: 'agents required' });
    }

    const agentsPath = path.join(CLAUDE_DIR, 'agents.json');
    writeJsonFile(agentsPath, agents);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/claude/agents/:name - Add or update a single agent
router.post('/agents/:name', (req, res) => {
  try {
    const { name } = req.params;
    const { description, prompt, model } = req.body;

    if (!description || !prompt) {
      return res.status(400).json({ error: 'description and prompt required' });
    }

    const agentsPath = path.join(CLAUDE_DIR, 'agents.json');
    let agents = {};

    if (fs.existsSync(agentsPath)) {
      agents = readJsonFile(agentsPath) || {};
    }

    agents[name] = { description, prompt };
    if (model) agents[name].model = model;

    writeJsonFile(agentsPath, agents);

    res.json({ success: true, agent: agents[name] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/claude/agents/:name - Delete an agent
router.delete('/agents/:name', (req, res) => {
  try {
    const { name } = req.params;
    const agentsPath = path.join(CLAUDE_DIR, 'agents.json');

    if (!fs.existsSync(agentsPath)) {
      return res.status(404).json({ error: 'No agents configured' });
    }

    const agents = readJsonFile(agentsPath) || {};
    if (!agents[name]) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    delete agents[name];
    writeJsonFile(agentsPath, agents);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
