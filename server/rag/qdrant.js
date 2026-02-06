const { QdrantClient } = require('@qdrant/js-client-rest');
const { EMBEDDING_DIMS } = require('./embedder');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

const client = new QdrantClient({ url: QDRANT_URL });

function collectionName(projectName) {
  return `rag_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function healthCheck() {
  try {
    const result = await client.api('cluster').clusterStatus();
    return { ok: true, status: result.data?.result?.status || 'unknown' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function createCollection(projectName) {
  const name = collectionName(projectName);
  try {
    await client.createCollection(name, {
      vectors: {
        size: EMBEDDING_DIMS,
        distance: 'Cosine',
      },
    });
  } catch (err) {
    // Collection might already exist
    if (!err.message?.includes('already exists')) throw err;
  }
}

async function deleteCollection(projectName) {
  const name = collectionName(projectName);
  try {
    await client.deleteCollection(name);
  } catch (err) {
    if (!err.message?.includes('not found') && !err.message?.includes("doesn't exist")) throw err;
  }
}

async function upsertPoints(projectName, points) {
  const name = collectionName(projectName);
  // points: [{ id, vector, payload }]
  const BATCH = 100;
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    await client.upsert(name, {
      wait: true,
      points: batch,
    });
  }
}

async function deletePointsByFile(projectName, filePath) {
  const name = collectionName(projectName);
  try {
    await client.delete(name, {
      wait: true,
      filter: {
        must: [{ key: 'file_path', match: { value: filePath } }],
      },
    });
  } catch {
    // ignore if collection doesn't exist
  }
}

async function search(projectName, vector, limit = 8) {
  const name = collectionName(projectName);
  const results = await client.search(name, {
    vector,
    limit,
    with_payload: true,
  });
  return results.map(r => ({
    score: r.score,
    filePath: r.payload.file_path,
    startLine: r.payload.start_line,
    endLine: r.payload.end_line,
    content: r.payload.content,
  }));
}

async function getCollectionInfo(projectName) {
  const name = collectionName(projectName);
  try {
    const info = await client.getCollection(name);
    return {
      exists: true,
      pointsCount: info.points_count,
      vectorsCount: info.vectors_count,
    };
  } catch {
    return { exists: false, pointsCount: 0, vectorsCount: 0 };
  }
}

module.exports = {
  healthCheck,
  createCollection,
  deleteCollection,
  upsertPoints,
  deletePointsByFile,
  search,
  getCollectionInfo,
};
