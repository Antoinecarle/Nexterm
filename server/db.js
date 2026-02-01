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
};
