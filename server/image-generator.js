const { GoogleGenAI, Modality } = require('@google/genai');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const GENERATED_DIR = path.join(__dirname, '..', 'media', 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// In-memory progress store (like rag/indexer.js pattern)
const activeJobs = new Map();

function getJobProgress(jobId) {
  return activeJobs.get(jobId) || null;
}

function getAllActiveProgress() {
  const result = {};
  for (const [id, progress] of activeJobs) {
    result[id] = progress;
  }
  return result;
}

async function generateSingleImage(ai, model, prompt, aspectRatio) {
  const ratioInstruction = aspectRatio && aspectRatio !== '1:1' ? ` Aspect ratio: ${aspectRatio}.` : '';
  const fullPrompt = `Generate an image for the following prompt.${ratioInstruction}\n\n${prompt}`;

  const response = await ai.models.generateContent({
    model,
    contents: fullPrompt,
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });

  if (response.candidates && response.candidates[0]) {
    const parts = response.candidates[0].content.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        const filename = `gen_${crypto.randomUUID()}.png`;
        const filePath = path.join(GENERATED_DIR, filename);
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        fs.writeFileSync(filePath, buffer);
        return { filename, path: `generated/${filename}`, size: buffer.length };
      }
    }
  }
  throw new Error('No image returned from model');
}

async function processStudioJob(jobId) {
  const job = db.getGenerationJob(jobId);
  if (!job) return;

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  const total = job.total_images;
  const resultPaths = [];
  let completed = 0;
  let failed = 0;

  // Init in-memory progress
  activeJobs.set(jobId, {
    status: 'processing',
    total,
    completed: 0,
    failed: 0,
    percentage: 0,
    resultPaths: [],
  });

  db.updateGenerationJobStatus(jobId, 'processing', '');

  for (let i = 0; i < total; i++) {
    try {
      const result = await generateSingleImage(ai, job.model, job.prompt, job.aspect_ratio);
      resultPaths.push(result);
      completed++;
    } catch (err) {
      console.error(`[ImageGen] Job ${jobId} image ${i + 1} failed:`, err.message);
      failed++;
    }

    // Update in-memory progress
    const progress = activeJobs.get(jobId);
    if (progress) {
      progress.completed = completed;
      progress.failed = failed;
      progress.percentage = Math.round(((completed + failed) / total) * 100);
      progress.resultPaths = resultPaths;
    }

    // Update DB progress
    db.updateGenerationJobProgress(jobId, completed, failed, resultPaths);
  }

  // Mark completed
  const finalStatus = failed === total ? 'failed' : 'completed';
  db.markGenerationJobCompleted(jobId, finalStatus, completed, failed, resultPaths);

  // Update in-memory
  const progress = activeJobs.get(jobId);
  if (progress) {
    progress.status = finalStatus;
    progress.percentage = 100;
  }

  // Cleanup from Map after 30s
  setTimeout(() => activeJobs.delete(jobId), 30000);
}

async function processCampaignJob(jobId) {
  const job = db.getGenerationJob(jobId);
  if (!job) return;

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  const itemIds = job.campaign_item_ids;
  const total = itemIds.length;
  const resultPaths = [];
  let completed = 0;
  let failed = 0;

  activeJobs.set(jobId, {
    status: 'processing',
    total,
    completed: 0,
    failed: 0,
    percentage: 0,
    resultPaths: [],
  });

  db.updateGenerationJobStatus(jobId, 'processing', '');

  for (let i = 0; i < total; i++) {
    const itemId = itemIds[i];
    const item = db.getCampaignItem(itemId);
    if (!item) {
      failed++;
      continue;
    }

    const prompt = item.image_prompt || item.content;
    try {
      const result = await generateSingleImage(ai, job.model, prompt, job.aspect_ratio);
      resultPaths.push(result);
      completed++;
      // Update campaign item image path
      db.updateCampaignItemImage(itemId, result.path);
    } catch (err) {
      console.error(`[ImageGen] Campaign job ${jobId} item ${itemId} failed:`, err.message);
      failed++;
    }

    const progress = activeJobs.get(jobId);
    if (progress) {
      progress.completed = completed;
      progress.failed = failed;
      progress.percentage = Math.round(((completed + failed) / total) * 100);
      progress.resultPaths = resultPaths;
    }

    db.updateGenerationJobProgress(jobId, completed, failed, resultPaths);
  }

  const finalStatus = failed === total ? 'failed' : 'completed';
  db.markGenerationJobCompleted(jobId, finalStatus, completed, failed, resultPaths);

  const progress = activeJobs.get(jobId);
  if (progress) {
    progress.status = finalStatus;
    progress.percentage = 100;
  }

  setTimeout(() => activeJobs.delete(jobId), 30000);
}

function startJob(jobId, type) {
  if (type === 'campaign') {
    processCampaignJob(jobId).catch(err => {
      console.error(`[ImageGen] Campaign job ${jobId} crashed:`, err.message);
      db.updateGenerationJobStatus(jobId, 'failed', err.message);
      const progress = activeJobs.get(jobId);
      if (progress) progress.status = 'failed';
      setTimeout(() => activeJobs.delete(jobId), 30000);
    });
  } else {
    processStudioJob(jobId).catch(err => {
      console.error(`[ImageGen] Studio job ${jobId} crashed:`, err.message);
      db.updateGenerationJobStatus(jobId, 'failed', err.message);
      const progress = activeJobs.get(jobId);
      if (progress) progress.status = 'failed';
      setTimeout(() => activeJobs.delete(jobId), 30000);
    });
  }
}

module.exports = { startJob, getJobProgress, getAllActiveProgress };
