const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OpenAI = require('openai');
const {
  linkProjectSkill,
  unlinkProjectSkill,
  linkProjectAgent,
  unlinkProjectAgent,
  getAllSkillLinks,
  getAllAgentLinks,
  saveNodePositions,
  getAllNodePositions,
  activateAgent,
  deactivateAgent,
  getAllActiveAgents,
  getSetting,
  setSetting,
  markAgentKnown,
  isAgentKnown,
} = require('../db');

const router = express.Router();

const PROJECT_ROOT = '/root/ProjectList';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins');
const MARKETPLACE_DIR = path.join(PLUGINS_DIR, 'marketplaces', 'claude-plugins-official');

// ─── Helpers ────────────────────────────────────────────

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function findFilesRecursive(dir, filename, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursive(full, filename, results);
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      results.push(full);
    }
  }
}

// ─── Get projects ───────────────────────────────────────

function getProjects() {
  if (!fs.existsSync(PROJECT_ROOT)) return [];
  try {
    return fs
      .readdirSync(PROJECT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const projectPath = path.join(PROJECT_ROOT, e.name);
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        let hasClaude = fs.existsSync(claudeMdPath);
        return { name: e.name, path: projectPath, hasClaude };
      });
  } catch (_) {
    return [];
  }
}

// ─── Get installed plugins with scope ───────────────────

function getInstalledPlugins() {
  const installedPath = path.join(PLUGINS_DIR, 'installed_plugins.json');
  const data = readJsonSafe(installedPath);
  if (!data || !data.plugins) return [];

  const plugins = [];
  for (const [pluginKey, installs] of Object.entries(data.plugins)) {
    // pluginKey = "ralph-loop@claude-plugins-official"
    const pluginName = pluginKey.split('@')[0];

    for (const install of installs) {
      plugins.push({
        key: pluginKey,
        name: pluginName,
        scope: install.scope,           // "user" | "local" | "project"
        projectPath: install.projectPath || null,
        installPath: install.installPath,
      });
    }
  }
  return plugins;
}

// ─── Get skills for a plugin from marketplace ───────────

function getPluginSkills(pluginName) {
  const skills = [];

  // Check both plugins/ and external_plugins/
  const dirs = [
    path.join(MARKETPLACE_DIR, 'plugins', pluginName),
    path.join(MARKETPLACE_DIR, 'external_plugins', pluginName),
  ];

  for (const pluginDir of dirs) {
    if (!fs.existsSync(pluginDir)) continue;

    // Find SKILL.md files
    const skillFiles = [];
    findFilesRecursive(pluginDir, 'SKILL.md', skillFiles);

    for (const skillPath of skillFiles) {
      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const parsed = parseFrontmatter(content);
        const skillDir = path.dirname(skillPath);
        const skillId = path.basename(skillDir);
        skills.push({
          id: skillId,
          name: parsed.name || skillId,
          description: parsed.description || '',
          plugin: pluginName,
        });
      } catch (_) {}
    }

    // Find command .md files (like ralph-loop)
    const commandsDir = path.join(pluginDir, 'commands');
    if (fs.existsSync(commandsDir)) {
      try {
        const cmds = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
        for (const cmd of cmds) {
          const content = fs.readFileSync(path.join(commandsDir, cmd), 'utf-8');
          const parsed = parseFrontmatter(content);
          const cmdName = cmd.replace('.md', '');
          // Don't duplicate if already found as a skill
          if (!skills.find((s) => s.id === cmdName)) {
            skills.push({
              id: cmdName,
              name: parsed.name || cmdName,
              description: parsed.description || '',
              plugin: pluginName,
            });
          }
        }
      } catch (_) {}
    }

    // Also check install cache for commands
    const cacheDir = path.join(PLUGINS_DIR, 'cache', 'claude-plugins-official', pluginName);
    if (fs.existsSync(cacheDir)) {
      try {
        const versions = fs.readdirSync(cacheDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const ver of versions) {
          const cacheCmdsDir = path.join(cacheDir, ver.name, 'commands');
          if (fs.existsSync(cacheCmdsDir)) {
            const cmds = fs.readdirSync(cacheCmdsDir).filter((f) => f.endsWith('.md'));
            for (const cmd of cmds) {
              const cmdName = cmd.replace('.md', '');
              if (!skills.find((s) => s.id === cmdName)) {
                const content = fs.readFileSync(path.join(cacheCmdsDir, cmd), 'utf-8');
                const parsed = parseFrontmatter(content);
                skills.push({
                  id: cmdName,
                  name: parsed.name || cmdName,
                  description: parsed.description || '',
                  plugin: pluginName,
                });
              }
            }
          }
        }
      } catch (_) {}
    }
  }

  return skills;
}

// ─── Get MCP servers from a plugin ──────────────────────

function getPluginMcp(pluginName) {
  const dirs = [
    path.join(MARKETPLACE_DIR, 'plugins', pluginName),
    path.join(MARKETPLACE_DIR, 'external_plugins', pluginName),
  ];
  for (const pluginDir of dirs) {
    const mcpPath = path.join(pluginDir, '.mcp.json');
    const data = readJsonSafe(mcpPath);
    if (data) return data;
  }
  // Also check cache
  const cacheDir = path.join(PLUGINS_DIR, 'cache', 'claude-plugins-official', pluginName);
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const ver of versions) {
        const mcpPath = path.join(cacheDir, ver.name, '.mcp.json');
        const data = readJsonSafe(mcpPath);
        if (data) return data;
      }
    } catch (_) {}
  }
  return null;
}

// ─── Determine if a plugin applies to a project ────────

function pluginAppliesToProject(plugin, projectPath) {
  if (plugin.scope === 'user') return true;
  if (plugin.scope === 'local') {
    // local scope: applies to all projects under the plugin's projectPath
    const basePath = plugin.projectPath || '/root';
    return projectPath.startsWith(basePath);
  }
  if (plugin.scope === 'project') {
    return plugin.projectPath === projectPath;
  }
  return false;
}

// ─── Get agents from a specific plugin ──────────────────

function getPluginAgents(pluginName) {
  const agents = [];
  const dirs = [
    path.join(MARKETPLACE_DIR, 'plugins', pluginName, 'agents'),
    path.join(MARKETPLACE_DIR, 'external_plugins', pluginName, 'agents'),
  ];

  for (const agentsDir of dirs) {
    if (!fs.existsSync(agentsDir)) continue;
    try {
      const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
      for (const af of agentFiles) {
        const content = fs.readFileSync(path.join(agentsDir, af), 'utf-8');
        const parsed = parseFrontmatter(content);
        const agentName = af.replace('.md', '');
        if (!agents.find((a) => a.name === agentName)) {
          agents.push({
            name: agentName,
            description: parsed.description || '',
            model: parsed.model || '',
            plugin: pluginName,
          });
        }
      }
    } catch (_) {}
  }

  // Also check cache
  const cacheDir = path.join(PLUGINS_DIR, 'cache', 'claude-plugins-official', pluginName);
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const ver of versions) {
        const cacheAgentsDir = path.join(cacheDir, ver.name, 'agents');
        if (!fs.existsSync(cacheAgentsDir)) continue;
        const agentFiles = fs.readdirSync(cacheAgentsDir).filter((f) => f.endsWith('.md'));
        for (const af of agentFiles) {
          const agentName = af.replace('.md', '');
          if (!agents.find((a) => a.name === agentName)) {
            const content = fs.readFileSync(path.join(cacheAgentsDir, af), 'utf-8');
            const parsed = parseFrontmatter(content);
            agents.push({
              name: agentName,
              description: parsed.description || '',
              model: parsed.model || '',
              plugin: pluginName,
            });
          }
        }
      }
    } catch (_) {}
  }

  return agents;
}

// ─── Get user-created skills (from ~/.claude/skills/) ────

function getUserSkills() {
  const skillsDir = path.join(CLAUDE_DIR, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const skills = [];
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseFrontmatter(content);
        skills.push({
          id: entry.name,
          name: parsed.name || entry.name,
          description: parsed.description || '',
          scope: 'user',
        });
      } catch (_) {}
    }
  } catch (_) {}
  return skills;
}

// ─── Get global MCP servers (from ~/.claude.json) ───────

function getGlobalMcpServers() {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  const data = readJsonSafe(claudeJsonPath);
  if (!data || !data.mcpServers) return [];
  const servers = [];
  for (const [name, config] of Object.entries(data.mcpServers)) {
    // Skip plugin-provided MCP servers (already shown as plugins)
    if (name.startsWith('plugin:')) continue;
    servers.push({
      name,
      type: config.type || 'stdio',
      command: config.command || '',
      url: config.url || '',
    });
  }
  return servers;
}

// ─── Get global agents (from ~/.claude/agents/*.md) ─────

function getGlobalAgents() {
  const agentsDir = path.join(CLAUDE_DIR, 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  const agents = [];
  try {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const name = frontmatter.name || file.replace('.md', '');
        // Extract body (everything after frontmatter closing ---)
        const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
        const prompt = bodyMatch ? bodyMatch[1].trim() : '';
        agents.push({
          name,
          description: (frontmatter.description || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
          model: frontmatter.model || '',
          prompt,
          scope: 'global',
        });
      } catch (_) {}
    }
  } catch (_) {}
  return agents;
}

// ─── Main data endpoint ─────────────────────────────────

router.get('/data', (req, res) => {
  try {
    const projects = getProjects();
    const installedPlugins = getInstalledPlugins();
    const globalAgents = getGlobalAgents();

    const nodes = [];
    const autoLinks = [];

    // --- Nexterm core node (central hub) ---
    const nextermPath = '/root/project';
    const nextermHasClaude = fs.existsSync(path.join(nextermPath, 'CLAUDE.md'));
    nodes.push({
      id: 'project:nexterm',
      type: 'project',
      name: 'nexterm',
      hasClaude: nextermHasClaude,
      isCore: true,
    });

    // --- Project nodes ---
    for (const p of projects) {
      nodes.push({
        id: `project:${p.name}`,
        type: 'project',
        name: p.name,
        hasClaude: p.hasClaude,
      });
      // Auto-link all projects to nexterm core
      autoLinks.push({
        source: 'project:nexterm',
        target: `project:${p.name}`,
        type: 'contains',
      });
    }

    // --- Plugin nodes + their skills + agents ---
    const seenPlugins = new Set();
    const allSkillNodes = new Map();
    const allAgentNodes = new Map();

    for (const plugin of installedPlugins) {
      const pluginNodeId = `plugin:${plugin.name}`;
      if (!seenPlugins.has(plugin.name)) {
        seenPlugins.add(plugin.name);

        const mcp = getPluginMcp(plugin.name);
        const isMcp = !!mcp;

        nodes.push({
          id: pluginNodeId,
          type: 'plugin',
          name: plugin.name,
          scope: plugin.scope,
          isMcp,
        });

        // Skills for this plugin
        const skills = getPluginSkills(plugin.name);
        for (const skill of skills) {
          const skillNodeId = `skill:${skill.id}`;
          if (!allSkillNodes.has(skillNodeId)) {
            allSkillNodes.set(skillNodeId, {
              id: skillNodeId,
              type: 'skill',
              name: skill.name,
              description: skill.description,
              plugin: skill.plugin,
            });
            nodes.push(allSkillNodes.get(skillNodeId));
          }
          autoLinks.push({ source: pluginNodeId, target: skillNodeId, type: 'contains' });
        }

        // Agents for this plugin
        const pluginAgents = getPluginAgents(plugin.name);
        for (const agent of pluginAgents) {
          const agentNodeId = `agent:${agent.name}`;
          if (!allAgentNodes.has(agentNodeId)) {
            allAgentNodes.set(agentNodeId, {
              id: agentNodeId,
              type: 'agent',
              name: agent.name,
              description: agent.description,
              model: agent.model,
              plugin: agent.plugin,
            });
            nodes.push(allAgentNodes.get(agentNodeId));
          }
          autoLinks.push({ source: pluginNodeId, target: agentNodeId, type: 'contains' });
        }
      }

      // Auto-link: project → plugin (based on scope)
      for (const p of projects) {
        if (pluginAppliesToProject(plugin, p.path)) {
          autoLinks.push({
            source: `project:${p.name}`,
            target: pluginNodeId,
            type: 'uses',
          });
        }
      }
    }

    // --- User-created skills (from ~/.claude/skills/) ---
    const userSkills = getUserSkills();
    for (const skill of userSkills) {
      const skillNodeId = `skill:${skill.id}`;
      if (!allSkillNodes.has(skillNodeId)) {
        allSkillNodes.set(skillNodeId, {
          id: skillNodeId,
          type: 'skill',
          name: skill.name,
          description: skill.description,
          scope: 'user',
        });
        nodes.push(allSkillNodes.get(skillNodeId));
      }
    }

    // --- Global agents (from ~/.claude/agents/*.md) — only active ones ---
    let activeAgentNames = getAllActiveAgents();

    // Auto-discover: any new .md agent not yet known gets auto-activated
    for (const a of globalAgents) {
      if (!isAgentKnown(a.name)) {
        activateAgent(a.name);
        markAgentKnown(a.name);
      }
    }
    activeAgentNames = getAllActiveAgents();

    const activeSet = new Set(activeAgentNames);
    for (const a of globalAgents) {
      if (!activeSet.has(a.name)) continue;
      const agentNodeId = `agent:${a.name}`;
      if (!allAgentNodes.has(agentNodeId)) {
        nodes.push({
          id: agentNodeId,
          type: 'agent',
          name: a.name,
          description: a.description,
          model: a.model,
          prompt: a.prompt,
          scope: 'global',
        });
      }
    }

    // --- Manual links (user-defined, from DB) ---
    const manualSkillLinks = getAllSkillLinks().map((l) => ({
      source: `project:${l.project_name}`,
      target: `skill:${l.skill_id}`,
      type: 'manual',
    }));
    const manualAgentLinks = getAllAgentLinks().map((l) => ({
      source: `project:${l.project_name}`,
      target: `agent:${l.agent_name}`,
      type: 'manual',
    }));

    // Dedupe auto-links
    const linkSet = new Set();
    const links = [];
    for (const link of [...autoLinks, ...manualSkillLinks, ...manualAgentLinks]) {
      const key = `${link.source}|${link.target}`;
      if (!linkSet.has(key)) {
        linkSet.add(key);
        links.push(link);
      }
    }

    // --- Positions ---
    const posRows = getAllNodePositions();
    const positions = {};
    for (const p of posRows) {
      positions[p.node_id] = { x: p.x, y: p.y };
    }

    res.json({ nodes, links, positions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mindmap/skills
router.get('/skills', (req, res) => {
  try {
    const installedPlugins = getInstalledPlugins();
    const allSkills = [];
    const seen = new Set();
    for (const plugin of installedPlugins) {
      for (const skill of getPluginSkills(plugin.name)) {
        if (!seen.has(skill.id)) {
          seen.add(skill.id);
          allSkills.push(skill);
        }
      }
    }
    res.json(allSkills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/link - Create a manual association
router.post('/link', (req, res) => {
  try {
    const { source, target } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'source and target required' });
    }

    const sourceMatch = source.match(/^project:(.+)$/);
    if (!sourceMatch) {
      return res.status(400).json({ error: 'source must be a project node' });
    }
    const projectName = sourceMatch[1];

    const skillMatch = target.match(/^skill:(.+)$/);
    const agentMatch = target.match(/^agent:(.+)$/);

    if (skillMatch) {
      linkProjectSkill(projectName, skillMatch[1]);
    } else if (agentMatch) {
      linkProjectAgent(projectName, agentMatch[1]);
    } else {
      return res.status(400).json({ error: 'target must be a skill or agent node' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mindmap/link - Remove a manual association
router.delete('/link', (req, res) => {
  try {
    const { source, target } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'source and target required' });
    }

    const sourceMatch = source.match(/^project:(.+)$/);
    if (!sourceMatch) {
      return res.status(400).json({ error: 'source must be a project node' });
    }
    const projectName = sourceMatch[1];

    const skillMatch = target.match(/^skill:(.+)$/);
    const agentMatch = target.match(/^agent:(.+)$/);

    if (skillMatch) {
      unlinkProjectSkill(projectName, skillMatch[1]);
    } else if (agentMatch) {
      unlinkProjectAgent(projectName, agentMatch[1]);
    } else {
      return res.status(400).json({ error: 'target must be a skill or agent node' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/positions
router.post('/positions', (req, res) => {
  try {
    const { positions } = req.body;
    if (!Array.isArray(positions)) {
      return res.status(400).json({ error: 'positions must be an array' });
    }
    saveNodePositions(positions);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mindmap/agents/all - List all agents with active status
router.get('/agents/all', (req, res) => {
  try {
    const globalAgents = getGlobalAgents();
    const activeNames = new Set(getAllActiveAgents());
    const agents = globalAgents.map((a) => ({
      ...a,
      active: activeNames.has(a.name),
    }));
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/agents/activate - Activate an agent on mindmap
router.post('/agents/activate', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    activateAgent(name);
    markAgentKnown(name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/agents/deactivate - Deactivate an agent from mindmap
router.post('/agents/deactivate', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    deactivateAgent(name);
    markAgentKnown(name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/create-agent - Create a new agent (.md file)
router.post('/create-agent', (req, res) => {
  try {
    const { name, description, model, prompt } = req.body;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid agent name. Use only letters, numbers, hyphens, underscores.' });
    }

    const agentsDir = path.join(CLAUDE_DIR, 'agents');
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

    const agentFile = path.join(agentsDir, `${name}.md`);
    if (fs.existsSync(agentFile)) {
      return res.status(409).json({ error: 'Agent already exists.' });
    }

    const frontmatterLines = ['---', `name: ${name}`];
    if (description) frontmatterLines.push(`description: "${description.replace(/"/g, '\\"')}"`);
    if (model) frontmatterLines.push(`model: ${model}`);
    frontmatterLines.push('---', '');

    const body = prompt || `You are "${name}", a specialized AI agent.\n\nAdd your instructions here.`;
    const content = frontmatterLines.join('\n') + body + '\n';

    fs.writeFileSync(agentFile, content, 'utf-8');
    activateAgent(name);
    markAgentKnown(name);
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/create-skill - Create a new skill
router.post('/create-skill', (req, res) => {
  try {
    const { name, description, content } = req.body;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid skill name. Use only letters, numbers, hyphens, underscores.' });
    }

    const skillsDir = path.join(CLAUDE_DIR, 'skills');
    const skillDir = path.join(skillsDir, name);

    if (fs.existsSync(skillDir)) {
      return res.status(409).json({ error: 'Skill already exists.' });
    }

    fs.mkdirSync(skillDir, { recursive: true });

    const frontmatter = [
      '---',
      `name: ${name}`,
      description ? `description: ${description}` : '',
      '---',
      '',
      content || `# ${name}\n\nSkill instructions here...`,
    ].filter(Boolean).join('\n');

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter, 'utf-8');
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mindmap/agent/:name - Update an agent's fields
router.put('/agent/:name', (req, res) => {
  try {
    const { name } = req.params;
    const { description, model, prompt } = req.body;
    const agentsDir = path.join(CLAUDE_DIR, 'agents');
    const agentFile = path.join(agentsDir, `${name}.md`);

    if (!fs.existsSync(agentFile)) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    // Read existing file to preserve fields not being updated
    const content = fs.readFileSync(agentFile, 'utf-8');
    const existingFm = parseFrontmatter(content);
    const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
    const existingBody = bodyMatch ? bodyMatch[1].trim() : '';

    const newDesc = description !== undefined ? description : (existingFm.description || '').replace(/^"|"$/g, '');
    const newModel = model !== undefined ? model : existingFm.model || '';
    const newPrompt = prompt !== undefined ? prompt : existingBody;

    const frontmatterLines = ['---', `name: ${name}`];
    if (newDesc) frontmatterLines.push(`description: "${newDesc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
    if (newModel) frontmatterLines.push(`model: ${newModel}`);
    frontmatterLines.push('---', '');

    const newContent = frontmatterLines.join('\n') + newPrompt + '\n';
    fs.writeFileSync(agentFile, newContent, 'utf-8');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mindmap/agent/:name - Delete an agent (.md file)
router.delete('/agent/:name', (req, res) => {
  try {
    const { name } = req.params;
    const agentsDir = path.join(CLAUDE_DIR, 'agents');

    // Find the .md file (could be name.md or name with different casing)
    const agentFile = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(agentFile)) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    fs.unlinkSync(agentFile);
    deactivateAgent(name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mindmap/skill/:name - Delete a user-created skill
router.delete('/skill/:name', (req, res) => {
  try {
    const { name } = req.params;
    const skillDir = path.join(CLAUDE_DIR, 'skills', name);

    if (!fs.existsSync(skillDir)) {
      return res.status(404).json({ error: 'Skill not found.' });
    }

    fs.rmSync(skillDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mindmap/assist-agent - Generate system prompt with AI
router.post('/assist-agent', async (req, res) => {
  try {
    const { name, description, currentPrompt } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Agent name is required.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
    }

    const client = new OpenAI({ apiKey });

    const systemMessage = `You are a prompt engineering expert specializing in creating system prompts for AI coding agents.

Given an agent's name and optional description, generate TWO things:

1. **description**: A concise "when to use" description (2-3 sentences max) explaining when this agent should be invoked. This is the frontmatter description shown in agent listings.

2. **prompt**: A comprehensive system prompt in Markdown format that includes:
   - Clear role definition, personality and scope
   - Specific methodologies relevant to the agent's purpose
   - Step-by-step workflows and decision frameworks
   - Quality checks and validation steps
   - Edge case handling guidelines
   - Output format expectations

You must respond ONLY with valid JSON. No markdown. No explanation. No extra text.
Format: {"description": "...", "prompt": "..."}`;

    let userMessage = `Agent name: "${name}"`;
    if (description) userMessage += `\nDescription hint: "${description}"`;
    if (currentPrompt) userMessage += `\n\nCurrent prompt to refine:\n${currentPrompt}`;

    const response = await client.responses.create({
      model: 'gpt-5-mini-2025-08-07',
      instructions: systemMessage,
      input: userMessage,
    });

    const rawText = response.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content)
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('\n');

    // Try to parse as JSON, fallback to raw text as prompt
    let result;
    try {
      result = JSON.parse(rawText);
    } catch (_) {
      result = { prompt: rawText };
    }

    res.json({ description: result.description || '', prompt: result.prompt || rawText });
  } catch (err) {
    console.error('AI assist error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate prompt.' });
  }
});

module.exports = router;
