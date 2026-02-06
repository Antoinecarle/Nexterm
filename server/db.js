const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'sessions.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    project TEXT DEFAULT '',
    cwd TEXT DEFAULT '/root',
    shell TEXT DEFAULT '/bin/bash',
    gpt_response_id TEXT DEFAULT ''
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_project_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(project_name, skill_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_project_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(project_name, agent_name)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_positions (
    node_id TEXT PRIMARY KEY,
    x REAL NOT NULL,
    y REAL NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_active_agents (
    agent_name TEXT PRIMARY KEY,
    activated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mindmap_known_agents (
    agent_name TEXT PRIMARY KEY
  )
`);

const mindmapStmts = {
  linkProjectSkill: db.prepare(
    'INSERT OR IGNORE INTO mindmap_project_skills (project_name, skill_id) VALUES (?, ?)'
  ),
  unlinkProjectSkill: db.prepare(
    'DELETE FROM mindmap_project_skills WHERE project_name = ? AND skill_id = ?'
  ),
  linkProjectAgent: db.prepare(
    'INSERT OR IGNORE INTO mindmap_project_agents (project_name, agent_name) VALUES (?, ?)'
  ),
  unlinkProjectAgent: db.prepare(
    'DELETE FROM mindmap_project_agents WHERE project_name = ? AND agent_name = ?'
  ),
  getAllSkillLinks: db.prepare('SELECT * FROM mindmap_project_skills'),
  getAllAgentLinks: db.prepare('SELECT * FROM mindmap_project_agents'),
  upsertPosition: db.prepare(
    `INSERT INTO mindmap_positions (node_id, x, y, updated_at) VALUES (?, ?, ?, strftime('%s','now'))
     ON CONFLICT(node_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`
  ),
  getAllPositions: db.prepare('SELECT * FROM mindmap_positions'),
  activateAgent: db.prepare('INSERT OR IGNORE INTO mindmap_active_agents (agent_name) VALUES (?)'),
  deactivateAgent: db.prepare('DELETE FROM mindmap_active_agents WHERE agent_name = ?'),
  getAllActiveAgents: db.prepare('SELECT agent_name FROM mindmap_active_agents'),
  getSetting: db.prepare('SELECT value FROM mindmap_settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO mindmap_settings (key, value) VALUES (?, ?)'),
  markAgentKnown: db.prepare('INSERT OR IGNORE INTO mindmap_known_agents (agent_name) VALUES (?)'),
  isAgentKnown: db.prepare('SELECT 1 FROM mindmap_known_agents WHERE agent_name = ?'),
  getAllKnownAgents: db.prepare('SELECT agent_name FROM mindmap_known_agents'),
};

function linkProjectSkill(project, skillId) {
  mindmapStmts.linkProjectSkill.run(project, skillId);
}
function unlinkProjectSkill(project, skillId) {
  mindmapStmts.unlinkProjectSkill.run(project, skillId);
}
function linkProjectAgent(project, agentName) {
  mindmapStmts.linkProjectAgent.run(project, agentName);
}
function unlinkProjectAgent(project, agentName) {
  mindmapStmts.unlinkProjectAgent.run(project, agentName);
}
function getAllSkillLinks() {
  return mindmapStmts.getAllSkillLinks.all();
}
function getAllAgentLinks() {
  return mindmapStmts.getAllAgentLinks.all();
}

const saveNodePositions = db.transaction((positions) => {
  for (const p of positions) {
    mindmapStmts.upsertPosition.run(p.node_id, p.x, p.y);
  }
});

function getAllNodePositions() {
  return mindmapStmts.getAllPositions.all();
}

function activateAgent(name) {
  mindmapStmts.activateAgent.run(name);
}

function deactivateAgent(name) {
  mindmapStmts.deactivateAgent.run(name);
}

function getAllActiveAgents() {
  return mindmapStmts.getAllActiveAgents.all().map((r) => r.agent_name);
}

function getSetting(key) {
  const row = mindmapStmts.getSetting.get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  mindmapStmts.setSetting.run(key, value);
}

function markAgentKnown(name) {
  mindmapStmts.markAgentKnown.run(name);
}

function isAgentKnown(name) {
  return !!mindmapStmts.isAgentKnown.get(name);
}

// Migrate: add gpt_response_id column if missing (existing DBs)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN gpt_response_id TEXT DEFAULT ''`);
} catch (_) {
  // Column already exists
}

const stmts = {
  insert: db.prepare(
    'INSERT INTO sessions (id, name, created_at, project, cwd, shell) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare('SELECT * FROM sessions ORDER BY created_at ASC'),
  get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  rename: db.prepare('UPDATE sessions SET name = ? WHERE id = ?'),
  updateProject: db.prepare('UPDATE sessions SET project = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
  removeAll: db.prepare('DELETE FROM sessions'),
  getGptResponseId: db.prepare('SELECT gpt_response_id FROM sessions WHERE id = ?'),
  updateGptResponseId: db.prepare('UPDATE sessions SET gpt_response_id = ? WHERE id = ?'),
};

function insertSession(id, name, createdAt, project, cwd, shell) {
  stmts.insert.run(id, name, createdAt, project || '', cwd || '/root', shell || '/bin/bash');
}

function getAllSessions() {
  return stmts.getAll.all();
}

function getSession(id) {
  return stmts.get.get(id);
}

function renameSession(id, name) {
  stmts.rename.run(name, id);
}

function updateSessionProject(id, project) {
  stmts.updateProject.run(project, id);
}

function removeSession(id) {
  stmts.remove.run(id);
}

function removeAllSessions() {
  stmts.removeAll.run();
}

function getGptResponseId(id) {
  const row = stmts.getGptResponseId.get(id);
  return row ? row.gpt_response_id : '';
}

function updateGptResponseId(id, responseId) {
  stmts.updateGptResponseId.run(responseId || '', id);
}

module.exports = {
  insertSession,
  getAllSessions,
  getSession,
  renameSession,
  updateSessionProject,
  removeSession,
  removeAllSessions,
  getGptResponseId,
  updateGptResponseId,
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
};
