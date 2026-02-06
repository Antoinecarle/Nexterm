const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'sessions.db'));
db.pragma('journal_mode = WAL');

// --- Sessions table ---
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

// --- Users table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'deactivated')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_login_at INTEGER
  )
`);

// --- Invitations table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    invited_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'expired', 'revoked')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    expires_at INTEGER NOT NULL,
    accepted_at INTEGER
  )
`);

// --- Mindmap tables ---
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

// --- RAG tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS rag_indexes (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexing', 'ready', 'error')),
    total_files INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_indexed_files (
    id TEXT PRIMARY KEY,
    index_id TEXT NOT NULL REFERENCES rag_indexes(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    indexed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(index_id, file_path)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_conversations (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    title TEXT DEFAULT 'New conversation',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES rag_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    sources TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

// --- Campaign tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'generating', 'ready', 'error')),
    campaign_data TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_items (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK(item_type IN ('post', 'image')),
    content TEXT NOT NULL DEFAULT '',
    image_path TEXT DEFAULT '',
    image_prompt TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

// --- Generation Jobs table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('studio', 'campaign')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-image',
    prompt TEXT NOT NULL DEFAULT '',
    total_images INTEGER NOT NULL DEFAULT 1,
    completed_images INTEGER NOT NULL DEFAULT 0,
    failed_images INTEGER NOT NULL DEFAULT 0,
    aspect_ratio TEXT DEFAULT '1:1',
    campaign_id TEXT DEFAULT '',
    campaign_item_ids TEXT DEFAULT '[]',
    result_paths TEXT DEFAULT '[]',
    error_message TEXT DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    completed_at INTEGER
  )
`);

// --- Migrations for existing DBs ---
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN gpt_response_id TEXT DEFAULT ''`);
} catch (_) {}

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT ''`);
} catch (_) {}

// --- Mindmap prepared statements ---
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

// --- Session prepared statements ---
const stmts = {
  insert: db.prepare(
    'INSERT INTO sessions (id, name, created_at, project, cwd, shell, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare('SELECT * FROM sessions ORDER BY created_at ASC'),
  get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  rename: db.prepare('UPDATE sessions SET name = ? WHERE id = ?'),
  updateProject: db.prepare('UPDATE sessions SET project = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
  removeAll: db.prepare('DELETE FROM sessions'),
  getGptResponseId: db.prepare('SELECT gpt_response_id FROM sessions WHERE id = ?'),
  updateGptResponseId: db.prepare('UPDATE sessions SET gpt_response_id = ? WHERE id = ?'),
  getByUserId: db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at ASC'),
};

function insertSession(id, name, createdAt, project, cwd, shell, userId) {
  stmts.insert.run(id, name, createdAt, project || '', cwd || '/root', shell || '/bin/bash', userId || '');
}

function getAllSessions() {
  return stmts.getAll.all();
}

function getSession(id) {
  return stmts.get.get(id);
}

function getSessionsByUserId(userId) {
  return stmts.getByUserId.all(userId);
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

// --- User prepared statements ---
const userStmts = {
  getByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getAll: db.prepare('SELECT id, email, first_name, last_name, role, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC'),
  create: db.prepare(
    'INSERT INTO users (id, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)'
  ),
  updateStatus: db.prepare("UPDATE users SET status = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  updateRole: db.prepare("UPDATE users SET role = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  updatePassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  updateLogin: db.prepare("UPDATE users SET last_login_at = strftime('%s','now'), updated_at = strftime('%s','now') WHERE id = ?"),
  updateProfile: db.prepare("UPDATE users SET first_name = ?, last_name = ?, updated_at = strftime('%s','now') WHERE id = ?"),
};

function getUserByEmail(email) {
  return userStmts.getByEmail.get(email);
}

function getUserById(id) {
  return userStmts.getById.get(id);
}

function getAllUsers() {
  return userStmts.getAll.all();
}

function createUser(id, email, passwordHash, role, status) {
  userStmts.create.run(id, email, passwordHash || null, role || 'member', status || 'pending');
}

function updateUserStatus(id, status) {
  userStmts.updateStatus.run(status, id);
}

function updateUserRole(id, role) {
  userStmts.updateRole.run(role, id);
}

function updateUserPassword(id, hash) {
  userStmts.updatePassword.run(hash, id);
}

function updateUserLogin(id) {
  userStmts.updateLogin.run(id);
}

function updateUserProfile(id, firstName, lastName) {
  userStmts.updateProfile.run(firstName, lastName, id);
}

// --- Invitation prepared statements ---
const invStmts = {
  create: db.prepare(
    'INSERT INTO invitations (id, email, token, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getByToken: db.prepare('SELECT * FROM invitations WHERE token = ?'),
  getPendingByEmail: db.prepare("SELECT * FROM invitations WHERE email = ? AND status = 'pending'"),
  getAll: db.prepare('SELECT * FROM invitations ORDER BY created_at DESC'),
  updateStatus: db.prepare('UPDATE invitations SET status = ?, accepted_at = ? WHERE id = ?'),
  revoke: db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?"),
};

function createInvitation(id, email, token, role, invitedBy, expiresAt) {
  invStmts.create.run(id, email, token, role || 'member', invitedBy, expiresAt);
}

function getInvitationByToken(token) {
  return invStmts.getByToken.get(token);
}

function getPendingInvitationByEmail(email) {
  return invStmts.getPendingByEmail.get(email);
}

function getAllInvitations() {
  return invStmts.getAll.all();
}

function updateInvitationStatus(id, status, acceptedAt) {
  invStmts.updateStatus.run(status, acceptedAt || null, id);
}

function revokeInvitation(id) {
  invStmts.revoke.run(id);
}

// --- RAG prepared statements ---
const ragStmts = {
  getIndex: db.prepare('SELECT * FROM rag_indexes WHERE project_name = ?'),
  getAllIndexes: db.prepare('SELECT * FROM rag_indexes ORDER BY created_at DESC'),
  upsertIndex: db.prepare(
    `INSERT INTO rag_indexes (id, project_name, status, total_files, total_chunks, error_message, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(project_name) DO UPDATE SET status = excluded.status, total_files = excluded.total_files,
     total_chunks = excluded.total_chunks, error_message = excluded.error_message, updated_at = excluded.updated_at`
  ),
  updateIndexStatus: db.prepare("UPDATE rag_indexes SET status = ?, error_message = ?, updated_at = strftime('%s','now') WHERE project_name = ?"),
  updateIndexCounts: db.prepare("UPDATE rag_indexes SET total_files = ?, total_chunks = ?, updated_at = strftime('%s','now') WHERE project_name = ?"),
  deleteIndex: db.prepare('DELETE FROM rag_indexes WHERE project_name = ?'),

  getIndexedFile: db.prepare('SELECT * FROM rag_indexed_files WHERE index_id = ? AND file_path = ?'),
  getIndexedFiles: db.prepare('SELECT * FROM rag_indexed_files WHERE index_id = ? ORDER BY file_path ASC'),
  upsertIndexedFile: db.prepare(
    `INSERT INTO rag_indexed_files (id, index_id, file_path, file_hash, chunk_count, indexed_at)
     VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(index_id, file_path) DO UPDATE SET file_hash = excluded.file_hash,
     chunk_count = excluded.chunk_count, indexed_at = excluded.indexed_at`
  ),
  deleteIndexedFiles: db.prepare('DELETE FROM rag_indexed_files WHERE index_id = ?'),
  deleteIndexedFile: db.prepare('DELETE FROM rag_indexed_files WHERE index_id = ? AND file_path = ?'),

  createConversation: db.prepare(
    'INSERT INTO rag_conversations (id, project_name, title) VALUES (?, ?, ?)'
  ),
  getConversation: db.prepare('SELECT * FROM rag_conversations WHERE id = ?'),
  getConversationsByProject: db.prepare('SELECT * FROM rag_conversations WHERE project_name = ? ORDER BY updated_at DESC'),
  updateConversationTitle: db.prepare("UPDATE rag_conversations SET title = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  deleteConversation: db.prepare('DELETE FROM rag_conversations WHERE id = ?'),

  createMessage: db.prepare(
    'INSERT INTO rag_messages (id, conversation_id, role, content, sources) VALUES (?, ?, ?, ?, ?)'
  ),
  getMessages: db.prepare('SELECT * FROM rag_messages WHERE conversation_id = ? ORDER BY created_at ASC'),
  getRecentMessages: db.prepare('SELECT * FROM rag_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'),
};

function getRagIndex(projectName) {
  return ragStmts.getIndex.get(projectName);
}
function getAllRagIndexes() {
  return ragStmts.getAllIndexes.all();
}
function upsertRagIndex(id, projectName, status, totalFiles, totalChunks, errorMessage) {
  ragStmts.upsertIndex.run(id, projectName, status, totalFiles || 0, totalChunks || 0, errorMessage || '');
}
function updateRagIndexStatus(projectName, status, errorMessage) {
  ragStmts.updateIndexStatus.run(status, errorMessage || '', projectName);
}
function updateRagIndexCounts(projectName, totalFiles, totalChunks) {
  ragStmts.updateIndexCounts.run(totalFiles, totalChunks, projectName);
}
function deleteRagIndex(projectName) {
  ragStmts.deleteIndex.run(projectName);
}
function getRagIndexedFile(indexId, filePath) {
  return ragStmts.getIndexedFile.get(indexId, filePath);
}
function getRagIndexedFiles(indexId) {
  return ragStmts.getIndexedFiles.all(indexId);
}
function upsertRagIndexedFile(id, indexId, filePath, fileHash, chunkCount) {
  ragStmts.upsertIndexedFile.run(id, indexId, filePath, fileHash, chunkCount || 0);
}
function deleteRagIndexedFiles(indexId) {
  ragStmts.deleteIndexedFiles.run(indexId);
}
function deleteRagIndexedFile(indexId, filePath) {
  ragStmts.deleteIndexedFile.run(indexId, filePath);
}
function createRagConversation(id, projectName, title) {
  ragStmts.createConversation.run(id, projectName, title || 'New conversation');
}
function getRagConversation(id) {
  return ragStmts.getConversation.get(id);
}
function getRagConversationsByProject(projectName) {
  return ragStmts.getConversationsByProject.all(projectName);
}
function updateRagConversationTitle(id, title) {
  ragStmts.updateConversationTitle.run(title, id);
}
function deleteRagConversation(id) {
  ragStmts.deleteConversation.run(id);
}
function createRagMessage(id, conversationId, role, content, sources) {
  ragStmts.createMessage.run(id, conversationId, role, content, JSON.stringify(sources || []));
}
function getRagMessages(conversationId) {
  return ragStmts.getMessages.all(conversationId).map(m => ({
    ...m,
    sources: JSON.parse(m.sources || '[]')
  }));
}
function getRagRecentMessages(conversationId, limit) {
  return ragStmts.getRecentMessages.all(conversationId, limit || 10).reverse().map(m => ({
    ...m,
    sources: JSON.parse(m.sources || '[]')
  }));
}

// --- Campaign prepared statements ---
const campaignStmts = {
  create: db.prepare(
    'INSERT INTO campaigns (id, project_name, platform, title, description, status, campaign_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC'),
  getById: db.prepare('SELECT * FROM campaigns WHERE id = ?'),
  updateStatus: db.prepare("UPDATE campaigns SET status = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  updateData: db.prepare("UPDATE campaigns SET campaign_data = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  delete: db.prepare('DELETE FROM campaigns WHERE id = ?'),

  createItem: db.prepare(
    'INSERT INTO campaign_items (id, campaign_id, item_type, content, image_path, image_prompt, metadata, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  getItems: db.prepare('SELECT * FROM campaign_items WHERE campaign_id = ? ORDER BY sort_order ASC'),
  getItem: db.prepare('SELECT * FROM campaign_items WHERE id = ?'),
  updateItemImage: db.prepare('UPDATE campaign_items SET image_path = ? WHERE id = ?'),
  deleteItems: db.prepare('DELETE FROM campaign_items WHERE campaign_id = ?'),
};

function createCampaign(id, projectName, platform, title, description, status, campaignData) {
  campaignStmts.create.run(id, projectName, platform, title || '', description || '', status || 'draft', JSON.stringify(campaignData || {}));
}
function getAllCampaigns() {
  return campaignStmts.getAll.all().map(c => ({ ...c, campaign_data: JSON.parse(c.campaign_data || '{}') }));
}
function getCampaign(id) {
  const c = campaignStmts.getById.get(id);
  if (!c) return null;
  return { ...c, campaign_data: JSON.parse(c.campaign_data || '{}') };
}
function updateCampaignStatus(id, status) {
  campaignStmts.updateStatus.run(status, id);
}
function updateCampaignData(id, data) {
  campaignStmts.updateData.run(JSON.stringify(data), id);
}
function deleteCampaign(id) {
  campaignStmts.deleteItems.run(id);
  campaignStmts.delete.run(id);
}
function createCampaignItem(id, campaignId, itemType, content, imagePath, imagePrompt, metadata, sortOrder) {
  campaignStmts.createItem.run(id, campaignId, itemType, content || '', imagePath || '', imagePrompt || '', JSON.stringify(metadata || {}), sortOrder || 0);
}
function getCampaignItems(campaignId) {
  return campaignStmts.getItems.all(campaignId).map(i => ({ ...i, metadata: JSON.parse(i.metadata || '{}') }));
}
function getCampaignItem(id) {
  const i = campaignStmts.getItem.get(id);
  if (!i) return null;
  return { ...i, metadata: JSON.parse(i.metadata || '{}') };
}
function updateCampaignItemImage(id, imagePath) {
  campaignStmts.updateItemImage.run(imagePath, id);
}

// --- Generation Jobs prepared statements ---
const jobStmts = {
  create: db.prepare(
    'INSERT INTO generation_jobs (id, user_id, type, status, model, prompt, total_images, aspect_ratio, campaign_id, campaign_item_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  getById: db.prepare('SELECT * FROM generation_jobs WHERE id = ?'),
  getByUser: db.prepare('SELECT * FROM generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'),
  getActive: db.prepare("SELECT * FROM generation_jobs WHERE user_id = ? AND status IN ('pending', 'processing') ORDER BY created_at ASC"),
  updateStatus: db.prepare("UPDATE generation_jobs SET status = ?, error_message = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  updateProgress: db.prepare("UPDATE generation_jobs SET completed_images = ?, failed_images = ?, result_paths = ?, updated_at = strftime('%s','now') WHERE id = ?"),
  markCompleted: db.prepare("UPDATE generation_jobs SET status = ?, completed_images = ?, failed_images = ?, result_paths = ?, completed_at = strftime('%s','now'), updated_at = strftime('%s','now') WHERE id = ?"),
  delete: db.prepare('DELETE FROM generation_jobs WHERE id = ?'),
};

function createGenerationJob(id, userId, type, model, prompt, totalImages, aspectRatio, campaignId, campaignItemIds) {
  jobStmts.create.run(id, userId, type, 'pending', model || 'gemini-2.5-flash-image', prompt || '', totalImages || 1, aspectRatio || '1:1', campaignId || '', JSON.stringify(campaignItemIds || []));
}
function getGenerationJob(id) {
  const j = jobStmts.getById.get(id);
  if (!j) return null;
  return { ...j, result_paths: JSON.parse(j.result_paths || '[]'), campaign_item_ids: JSON.parse(j.campaign_item_ids || '[]') };
}
function getGenerationJobsByUser(userId) {
  return jobStmts.getByUser.all(userId).map(j => ({ ...j, result_paths: JSON.parse(j.result_paths || '[]'), campaign_item_ids: JSON.parse(j.campaign_item_ids || '[]') }));
}
function getActiveGenerationJobs(userId) {
  return jobStmts.getActive.all(userId).map(j => ({ ...j, result_paths: JSON.parse(j.result_paths || '[]'), campaign_item_ids: JSON.parse(j.campaign_item_ids || '[]') }));
}
function updateGenerationJobStatus(id, status, errorMessage) {
  jobStmts.updateStatus.run(status, errorMessage || '', id);
}
function updateGenerationJobProgress(id, completed, failed, resultPaths) {
  jobStmts.updateProgress.run(completed, failed, JSON.stringify(resultPaths || []), id);
}
function markGenerationJobCompleted(id, status, completed, failed, resultPaths) {
  jobStmts.markCompleted.run(status, completed, failed, JSON.stringify(resultPaths || []), id);
}
function deleteGenerationJob(id) {
  jobStmts.delete.run(id);
}

// --- Seed admin user on startup ---
function seedAdmin() {
  const adminEmail = process.env.EMAIL || 'admin@vps.local';
  const existing = getUserByEmail(adminEmail);
  if (!existing) {
    const id = crypto.randomUUID();
    const passwordHash = process.env.PASSWORD_HASH || null;
    createUser(id, adminEmail, passwordHash, 'admin', 'active');
    console.log(`[DB] Seeded admin user: ${adminEmail} (${id})`);
  }
}

// Seed must be called after dotenv is loaded, so we export and call from index.js
module.exports = {
  seedAdmin,
  // Sessions
  insertSession,
  getAllSessions,
  getSession,
  getSessionsByUserId,
  renameSession,
  updateSessionProject,
  removeSession,
  removeAllSessions,
  getGptResponseId,
  updateGptResponseId,
  // Users
  getUserByEmail,
  getUserById,
  getAllUsers,
  createUser,
  updateUserStatus,
  updateUserRole,
  updateUserPassword,
  updateUserLogin,
  updateUserProfile,
  // Invitations
  createInvitation,
  getInvitationByToken,
  getPendingInvitationByEmail,
  getAllInvitations,
  updateInvitationStatus,
  revokeInvitation,
  // Mindmap
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
  // RAG
  getRagIndex,
  getAllRagIndexes,
  upsertRagIndex,
  updateRagIndexStatus,
  updateRagIndexCounts,
  deleteRagIndex,
  getRagIndexedFile,
  getRagIndexedFiles,
  upsertRagIndexedFile,
  deleteRagIndexedFiles,
  deleteRagIndexedFile,
  createRagConversation,
  getRagConversation,
  getRagConversationsByProject,
  updateRagConversationTitle,
  deleteRagConversation,
  createRagMessage,
  getRagMessages,
  getRagRecentMessages,
  // Campaigns
  createCampaign,
  getAllCampaigns,
  getCampaign,
  updateCampaignStatus,
  updateCampaignData,
  deleteCampaign,
  createCampaignItem,
  getCampaignItems,
  getCampaignItem,
  updateCampaignItemImage,
  // Generation Jobs
  createGenerationJob,
  getGenerationJob,
  getGenerationJobsByUser,
  getActiveGenerationJobs,
  updateGenerationJobStatus,
  updateGenerationJobProgress,
  markGenerationJobCompleted,
  deleteGenerationJob,
};
