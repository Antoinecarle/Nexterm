const express = require('express');
const crypto = require('crypto');
const OpenAI = require('openai');
const router = express.Router();
const db = require('../db');
const qdrant = require('../rag/qdrant');
const { embedQuery } = require('../rag/embedder');
const { indexProject, deleteProjectIndex, getProgress } = require('../rag/indexer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GPT_MODEL = 'gpt-5-mini-2025-08-07';

// ─── Health Check ───

router.get('/health', async (req, res) => {
  try {
    const health = await qdrant.healthCheck();
    res.json(health);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Index Status ───

router.get('/status', async (req, res) => {
  try {
    const indexes = db.getAllRagIndexes();
    const health = await qdrant.healthCheck();
    res.json({ indexes, qdrant: health });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status/:projectName', async (req, res) => {
  try {
    const index = db.getRagIndex(req.params.projectName);
    if (!index) return res.json({ status: 'not_indexed' });
    const collectionInfo = await qdrant.getCollectionInfo(req.params.projectName);
    res.json({ ...index, collection: collectionInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Index Management ───

router.post('/index/:projectName', async (req, res) => {
  const { projectName } = req.params;

  // Check if already indexing
  const existing = db.getRagIndex(projectName);
  if (existing && existing.status === 'indexing') {
    // If no active progress in memory, the server restarted mid-indexing — reset and allow
    const progress = getProgress(projectName);
    if (progress) {
      return res.status(409).json({ error: 'Indexing already in progress' });
    }
    // Stale "indexing" status — reset it so we can re-index
    db.updateRagIndexStatus(projectName, 'error', 'Indexing interrupted (server restart)');
  }

  // SSE stream for progress
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await indexProject(projectName, (event) => {
      send(event);
    });
    send({ type: 'done', ...result });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

router.get('/index/:projectName/progress', (req, res) => {
  const progress = getProgress(req.params.projectName);
  if (!progress) {
    // No active indexing in memory — check DB for status
    const index = db.getRagIndex(req.params.projectName);
    if (index && index.status === 'indexing') {
      // Server may have restarted mid-indexing — reset to error
      db.updateRagIndexStatus(req.params.projectName, 'error', 'Indexing interrupted (server restart)');
      return res.json({ active: false, status: 'error', message: 'Indexing interrupted (server restart)' });
    }
    return res.json({ active: false });
  }
  res.json({
    active: progress.type !== 'done' && progress.type !== 'error',
    progress: progress.progress,
    total: progress.total,
    current: progress.current,
    message: progress.message,
    logs: progress.logs.slice(-30),
    type: progress.type,
  });
});

router.delete('/index/:projectName', async (req, res) => {
  try {
    await deleteProjectIndex(req.params.projectName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/index/:projectName/files', (req, res) => {
  try {
    const index = db.getRagIndex(req.params.projectName);
    if (!index) return res.json({ files: [] });
    const files = db.getRagIndexedFiles(index.id);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RAG Query (one-shot) ───

router.post('/query', async (req, res) => {
  try {
    const { projectName, question } = req.body;
    if (!projectName || !question) {
      return res.status(400).json({ error: 'projectName and question are required' });
    }

    const index = db.getRagIndex(projectName);
    if (!index || index.status !== 'ready') {
      return res.status(400).json({ error: 'Project is not indexed' });
    }

    // Embed the question
    const queryVector = await embedQuery(question);

    // Search Qdrant
    const results = await qdrant.search(projectName, queryVector, 8);

    // Build context from search results
    const context = results.map((r, i) =>
      `--- Source ${i + 1}: ${r.filePath} (lines ${r.startLine}-${r.endLine}, score: ${r.score.toFixed(3)}) ---\n${r.content}`
    ).join('\n\n');

    // Call GPT
    const response = await openai.responses.create({
      model: GPT_MODEL,
      input: [
        {
          role: 'system',
          content: `You are a code assistant for the project "${projectName}". Answer questions based on the provided code context. Always reference the source files and line numbers. If the context doesn't contain enough information, say so.`
        },
        {
          role: 'user',
          content: `Context from the codebase:\n\n${context}\n\n---\n\nQuestion: ${question}`
        }
      ],
    });

    const answer = response.output
      .filter(o => o.type === 'message')
      .flatMap(o => o.content)
      .filter(c => c.type === 'output_text')
      .map(c => c.text)
      .join('\n');

    const sources = results.map(r => ({
      filePath: r.filePath,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
    }));

    res.json({ answer, sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RAG Chat (conversational) ───

router.post('/chat', async (req, res) => {
  try {
    const { projectName, conversationId, message } = req.body;
    if (!projectName || !message) {
      return res.status(400).json({ error: 'projectName and message are required' });
    }

    const index = db.getRagIndex(projectName);
    if (!index || index.status !== 'ready') {
      return res.status(400).json({ error: 'Project is not indexed' });
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      convId = crypto.randomUUID();
      db.createRagConversation(convId, projectName, message.slice(0, 100));
    }

    // Save user message
    const userMsgId = crypto.randomUUID();
    db.createRagMessage(userMsgId, convId, 'user', message, []);

    // Embed the question
    const queryVector = await embedQuery(message);

    // Search Qdrant
    const results = await qdrant.search(projectName, queryVector, 8);

    // Build context
    const context = results.map((r, i) =>
      `--- Source ${i + 1}: ${r.filePath} (lines ${r.startLine}-${r.endLine}, score: ${r.score.toFixed(3)}) ---\n${r.content}`
    ).join('\n\n');

    // Get conversation history (last 10 messages)
    const history = db.getRagRecentMessages(convId, 10);

    // Build messages for GPT
    const messages = [
      {
        role: 'system',
        content: `You are a code assistant for the project "${projectName}". Answer questions based on the provided code context. Always reference the source files and line numbers. If the context doesn't contain enough information, say so.`
      },
    ];

    // Add history (skip the user message we just saved)
    for (const msg of history) {
      if (msg.id === userMsgId) continue;
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current question with context
    messages.push({
      role: 'user',
      content: `Context from the codebase:\n\n${context}\n\n---\n\nQuestion: ${message}`
    });

    const response = await openai.responses.create({
      model: GPT_MODEL,
      input: messages,
    });

    const answer = response.output
      .filter(o => o.type === 'message')
      .flatMap(o => o.content)
      .filter(c => c.type === 'output_text')
      .map(c => c.text)
      .join('\n');

    const sources = results.map(r => ({
      filePath: r.filePath,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
    }));

    // Save assistant message
    const assistantMsgId = crypto.randomUUID();
    db.createRagMessage(assistantMsgId, convId, 'assistant', answer, sources);

    // Update conversation title if first exchange
    if (history.length === 0) {
      db.updateRagConversationTitle(convId, message.slice(0, 100));
    }

    res.json({ conversationId: convId, answer, sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversations ───

router.get('/conversations/:projectName', (req, res) => {
  try {
    const conversations = db.getRagConversationsByProject(req.params.projectName);
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:projectName/:id', (req, res) => {
  try {
    const conversation = db.getRagConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const messages = db.getRagMessages(req.params.id);
    res.json({ conversation, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:projectName', (req, res) => {
  try {
    const id = crypto.randomUUID();
    const title = req.body.title || 'New conversation';
    db.createRagConversation(id, req.params.projectName, title);
    const conversation = db.getRagConversation(id);
    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/conversations/:projectName/:id', (req, res) => {
  try {
    db.deleteRagConversation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
