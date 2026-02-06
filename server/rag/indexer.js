const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanFiles, hashFile, chunkFile } = require('./chunker');
const { embedTexts } = require('./embedder');
const qdrant = require('./qdrant');
const db = require('../db');

const PROJECT_ROOT = '/root/ProjectList';

// In-memory progress store — survives SSE disconnects
const activeProgress = new Map();

function getProgress(projectName) {
  return activeProgress.get(projectName) || null;
}

async function indexProject(projectName, onProgress) {
  const projectDir = path.join(PROJECT_ROOT, projectName);
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectName}`);
  }

  // Initialize progress store
  activeProgress.set(projectName, { progress: 0, total: 0, current: 0, message: 'Starting...', logs: [], startedAt: Date.now() });

  const emit = (type, data) => {
    if (onProgress) onProgress({ type, ...data });
    // Update in-memory store
    const p = activeProgress.get(projectName);
    if (p) {
      if (data.message) {
        p.logs.push(data.message);
        if (p.logs.length > 100) p.logs = p.logs.slice(-100);
        p.message = data.message;
      }
      if (data.total != null) p.total = data.total;
      if (data.current != null) {
        p.current = data.current;
        p.progress = p.total ? Math.round((data.current / p.total) * 100) : 0;
      }
      p.type = type;
    }
  };

  // Get or create index record
  let index = db.getRagIndex(projectName);
  if (!index) {
    const id = crypto.randomUUID();
    db.upsertRagIndex(id, projectName, 'indexing', 0, 0, '');
    index = db.getRagIndex(projectName);
  } else {
    db.updateRagIndexStatus(projectName, 'indexing', '');
  }

  try {
    emit('status', { message: 'Scanning files...' });

    // Scan project files
    const files = scanFiles(projectDir);
    emit('progress', { message: `Found ${files.length} files to process`, total: files.length, current: 0 });

    // Ensure Qdrant collection exists
    await qdrant.createCollection(projectName);

    // Get existing indexed files for incremental indexing
    const existingFiles = db.getRagIndexedFiles(index.id);
    const existingMap = new Map(existingFiles.map(f => [f.file_path, f]));

    let totalChunks = 0;
    let processedFiles = 0;
    let skippedFiles = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = file.relativePath;

      let content;
      try {
        content = fs.readFileSync(file.fullPath, 'utf-8');
      } catch {
        processedFiles++;
        continue;
      }

      const fileHash = hashFile(content);

      // Check if file has changed since last indexing
      const existing = existingMap.get(relPath);
      if (existing && existing.file_hash === fileHash) {
        totalChunks += existing.chunk_count;
        skippedFiles++;
        processedFiles++;
        existingMap.delete(relPath);
        emit('progress', { message: `Skipped (unchanged): ${relPath}`, total: files.length, current: processedFiles });
        continue;
      }

      // Remove old vectors for this file if it was previously indexed
      if (existing) {
        await qdrant.deletePointsByFile(projectName, relPath);
      }

      // Chunk the file
      const chunks = chunkFile(content, relPath);
      if (chunks.length === 0) {
        processedFiles++;
        continue;
      }

      emit('progress', { message: `Embedding: ${relPath} (${chunks.length} chunks)`, total: files.length, current: processedFiles });

      // Generate embeddings
      const texts = chunks.map(c => `File: ${relPath}\n\n${c.content}`);
      const embeddings = await embedTexts(texts);

      // Prepare points for Qdrant
      const points = chunks.map((chunk, idx) => ({
        id: crypto.randomUUID(),
        vector: embeddings[idx],
        payload: {
          file_path: chunk.filePath,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          content: chunk.content,
          project: projectName,
        },
      }));

      // Upsert to Qdrant
      await qdrant.upsertPoints(projectName, points);

      // Update DB record for this file
      const fileId = existing ? existing.id : crypto.randomUUID();
      db.upsertRagIndexedFile(fileId, index.id, relPath, fileHash, chunks.length);

      totalChunks += chunks.length;
      processedFiles++;
      existingMap.delete(relPath);

      emit('progress', { message: `Indexed: ${relPath} (${chunks.length} chunks)`, total: files.length, current: processedFiles });
    }

    // Remove files that no longer exist in the project
    for (const [oldPath, oldFile] of existingMap) {
      await qdrant.deletePointsByFile(projectName, oldPath);
      db.deleteRagIndexedFile(index.id, oldPath);
      emit('progress', { message: `Removed: ${oldPath}` });
    }

    // Update index status
    db.updateRagIndexCounts(projectName, processedFiles - skippedFiles + skippedFiles, totalChunks);
    db.updateRagIndexStatus(projectName, 'ready', '');

    emit('done', {
      message: `Indexing complete: ${processedFiles} files, ${totalChunks} chunks (${skippedFiles} unchanged)`,
      totalFiles: processedFiles,
      totalChunks,
      skippedFiles,
    });

    // Mark done in progress store (keep it for 10s so final poll catches it)
    const p = activeProgress.get(projectName);
    if (p) { p.progress = 100; p.type = 'done'; p.message = `Done: ${processedFiles} files, ${totalChunks} chunks`; }
    setTimeout(() => activeProgress.delete(projectName), 10000);

    return { totalFiles: processedFiles, totalChunks, skippedFiles };
  } catch (err) {
    db.updateRagIndexStatus(projectName, 'error', err.message);
    emit('error', { message: err.message });
    // Keep error in store briefly
    const p = activeProgress.get(projectName);
    if (p) { p.type = 'error'; p.message = err.message; }
    setTimeout(() => activeProgress.delete(projectName), 10000);
    throw err;
  }
}

async function deleteProjectIndex(projectName) {
  const index = db.getRagIndex(projectName);
  if (index) {
    db.deleteRagIndexedFiles(index.id);
  }
  db.deleteRagIndex(projectName);
  await qdrant.deleteCollection(projectName);
}

module.exports = { indexProject, deleteProjectIndex, getProgress };
