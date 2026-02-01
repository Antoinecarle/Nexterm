const pty = require('node-pty');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// --- Constants ---
const BUFFER_INTERVAL_MS = 8;
const BUFFER_FLUSH_SIZE = 32768;
const MAX_SCROLLBACK = 50 * 1024; // 50KB scrollback per session
const MAX_SESSIONS = 10;
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1h
const PROJECT_ROOT = '/root/ProjectList';

// --- Persistent session store ---
// Map<sessionId, { id, pty, scrollback, createdAt, lastActivity, cols, rows, title, project, clients, outputBuffer, flushTimer, exited }>
const sessions = new Map();

// --- Helpers ---

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function appendScrollback(session, data) {
  session.scrollback += data;
  if (session.scrollback.length > MAX_SCROLLBACK) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
  }
}

function createSession(cols, rows, name, project) {
  if (sessions.size >= MAX_SESSIONS) {
    return null;
  }

  const id = generateId();
  const shell = process.env.SHELL || '/bin/bash';

  // Determine CWD based on project
  let cwd = process.env.HOME || '/root';
  if (project) {
    const projectDir = path.join(PROJECT_ROOT, project);
    if (fs.existsSync(projectDir)) {
      cwd = projectDir;
    }
  }

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 30,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    },
  });

  const sessionTitle = name || `Shell ${sessions.size + 1}`;

  const session = {
    id,
    pty: term,
    scrollback: '',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    cols: cols || 120,
    rows: rows || 30,
    title: sessionTitle,
    project: project || '',
    clients: new Set(),
    outputBuffer: '',
    flushTimer: null,
    exited: false,
  };

  // --- Output buffering ---
  function flushOutput() {
    if (session.outputBuffer.length > 0) {
      const data = session.outputBuffer;
      session.outputBuffer = '';
      appendScrollback(session, data);
      for (const client of session.clients) {
        client.emit('output', data);
      }
    }
    session.flushTimer = null;
  }

  term.onData((data) => {
    session.lastActivity = Date.now();
    session.outputBuffer += data;

    if (session.outputBuffer.length >= BUFFER_FLUSH_SIZE) {
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
        session.flushTimer = null;
      }
      flushOutput();
    } else if (!session.flushTimer) {
      session.flushTimer = setTimeout(flushOutput, BUFFER_INTERVAL_MS);
    }
  });

  term.onExit(() => {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    // Flush any remaining output
    if (session.outputBuffer.length > 0) {
      const data = session.outputBuffer;
      session.outputBuffer = '';
      appendScrollback(session, data);
      for (const client of session.clients) {
        client.emit('output', data);
      }
    }
    session.exited = true;
    const exitMsg = '\r\n\x1b[31m[Process exited]\x1b[0m\r\n';
    appendScrollback(session, exitMsg);
    for (const client of session.clients) {
      client.emit('output', exitMsg);
      client.emit('session-exited', { id: session.id });
    }
  });

  sessions.set(id, session);

  // Persist to SQLite
  db.insertSession(id, sessionTitle, session.createdAt, project || '', cwd, shell);

  return session;
}

function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.flushTimer) clearTimeout(session.flushTimer);
  if (!session.exited) {
    try { session.pty.kill(); } catch (_) {}
  }
  sessions.delete(id);
  db.removeSession(id);
}

function attachSocket(session, socket) {
  session.clients.add(socket);
}

function detachSocket(session, socket) {
  session.clients.delete(socket);
}

function getSessionInfo(session) {
  return {
    id: session.id,
    title: session.title,
    project: session.project,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    cols: session.cols,
    rows: session.rows,
    exited: session.exited,
  };
}

function listSessions() {
  const list = [];
  for (const session of sessions.values()) {
    list.push(getSessionInfo(session));
  }
  return list;
}

function getSessionsByProject(project) {
  const list = [];
  for (const session of sessions.values()) {
    if (session.project === project) {
      list.push(getSessionInfo(session));
    }
  }
  return list;
}

function renameSession(id, title) {
  const session = sessions.get(id);
  if (!session) return null;
  session.title = title || session.title;
  db.renameSession(id, session.title);
  return getSessionInfo(session);
}

// --- Idle cleanup ---
function cleanupIdleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.clients.size > 0) continue; // Don't kill sessions with attached clients
    if (session.exited || (now - session.lastActivity > IDLE_TIMEOUT_MS)) {
      destroySession(id);
    }
  }
}

// --- Init: clean slate on startup ---
function initSessions() {
  db.removeAllSessions();
}

let cleanupTimer = null;

function setupTerminal(io) {
  const termNamespace = io.of('/terminal');

  // JWT auth middleware
  termNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Start idle cleanup interval
  if (!cleanupTimer) {
    cleanupTimer = setInterval(cleanupIdleSessions, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }

  termNamespace.on('connection', (socket) => {
    // Track which session this socket is currently attached to
    let currentSessionId = null;

    // --- List sessions ---
    socket.on('list-sessions', (callback) => {
      if (typeof callback === 'function') callback(listSessions());
    });

    // --- Create session ---
    socket.on('create-session', ({ cols, rows, project } = {}, callback) => {
      const session = createSession(cols, rows, null, project);
      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Max sessions reached (limit: ' + MAX_SESSIONS + ')' });
        return;
      }
      if (typeof callback === 'function') callback(getSessionInfo(session));
    });

    // --- Attach session ---
    socket.on('attach-session', ({ id, cols, rows, replay } = {}, callback) => {
      const session = sessions.get(id);
      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }

      // Detach from previous session if switching
      if (currentSessionId && currentSessionId !== id) {
        const prev = sessions.get(currentSessionId);
        if (prev) detachSocket(prev, socket);
      }

      currentSessionId = id;
      attachSocket(session, socket);

      // Resize PTY if needed
      if (cols > 0 && rows > 0 && !session.exited) {
        try {
          session.pty.resize(cols, rows);
          session.cols = cols;
          session.rows = rows;
        } catch (_) {}
      }

      // Replay scrollback if requested
      if (replay !== false && session.scrollback.length > 0) {
        socket.emit('output', session.scrollback);
      }

      if (typeof callback === 'function') callback(getSessionInfo(session));
    });

    // --- Kill session ---
    socket.on('kill-session', ({ id } = {}, callback) => {
      if (currentSessionId === id) {
        currentSessionId = null;
      }
      destroySession(id);
      if (typeof callback === 'function') callback({ ok: true });
    });

    // --- Rename session ---
    socket.on('rename-session', ({ id, title } = {}, callback) => {
      const result = renameSession(id, title);
      if (!result) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }
      if (typeof callback === 'function') callback(result);
    });

    // --- AI Enhance (GPT prompt improver) ---
    socket.on('ai-enhance', async ({ text, sessionId } = {}, callback) => {
      if (typeof callback !== 'function') return;
      if (!text || !sessionId) return callback({ error: 'Missing text or sessionId' });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return callback({ error: 'OpenAI API key not configured' });

      try {
        // Get previous conversation ID for multi-turn context
        const previousResponseId = db.getGptResponseId(sessionId) || null;

        const body = {
          model: 'gpt-5-mini-2025-08-07',
          instructions: `You are an expert prompt engineer assistant. The user is chatting with Claude AI (Anthropic) inside a terminal. Your job is to take the user's rough draft message and rewrite it to be a high-quality prompt: clearer, more specific, better structured, and more effective at getting great results from Claude. Preserve the user's original intent, language, and tone. If the user writes in French, respond in French. If in English, respond in English. Return ONLY the improved prompt text — no explanations, no commentary, no markdown code blocks wrapping.`,
          input: text,
          store: true,
        };

        if (previousResponseId) {
          body.previous_response_id = previousResponseId;
        }

        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error('[AI-Enhance] OpenAI error:', res.status, errBody);
          return callback({ error: `OpenAI API error: ${res.status}` });
        }

        const data = await res.json();

        // Save the response ID for multi-turn context
        if (data.id) {
          db.updateGptResponseId(sessionId, data.id);
        }

        // Extract text from output
        let enhanced = '';
        if (data.output && Array.isArray(data.output)) {
          for (const item of data.output) {
            if (item.type === 'message' && item.content) {
              for (const c of item.content) {
                if (c.type === 'output_text' && c.text) {
                  enhanced += c.text;
                }
              }
            }
          }
        }

        if (!enhanced) {
          return callback({ error: 'No response from GPT' });
        }

        callback({ enhanced, responseId: data.id });
      } catch (err) {
        console.error('[AI-Enhance] Error:', err.message);
        callback({ error: err.message });
      }
    });

    // --- AI Reset conversation ---
    socket.on('ai-reset', ({ sessionId } = {}, callback) => {
      if (sessionId) {
        db.updateGptResponseId(sessionId, '');
      }
      if (typeof callback === 'function') callback({ ok: true });
    });

    // --- Input ---
    socket.on('input', (data) => {
      if (!currentSessionId) return;
      const session = sessions.get(currentSessionId);
      if (!session || session.exited) return;
      session.lastActivity = Date.now();
      try {
        session.pty.write(data);
      } catch (_) {}
    });

    // --- Resize ---
    socket.on('resize', ({ cols, rows }) => {
      if (!currentSessionId) return;
      const session = sessions.get(currentSessionId);
      if (!session || session.exited) return;
      if (cols > 0 && rows > 0) {
        try {
          session.pty.resize(cols, rows);
          session.cols = cols;
          session.rows = rows;
        } catch (_) {}
      }
    });

    // --- Disconnect: detach only, don't kill ---
    socket.on('disconnect', () => {
      if (currentSessionId) {
        const session = sessions.get(currentSessionId);
        if (session) detachSocket(session, socket);
      }
      currentSessionId = null;
    });
  });
}

module.exports = { setupTerminal, initSessions, listSessions, getSessionsByProject, createSession, destroySession, renameSession, getSessionInfo: (id) => { const s = sessions.get(id); return s ? getSessionInfo(s) : null; } };
