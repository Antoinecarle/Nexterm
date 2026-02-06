const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { GoogleGenAI, Modality } = require('@google/genai');
const router = express.Router();
const db = require('../db');
const qdrant = require('../rag/qdrant');
const { embedQuery } = require('../rag/embedder');
const imageGenerator = require('../image-generator');

const GPT_MODEL = 'gpt-5-mini-2025-08-07';
const MODEL_MAP = { fast: 'gemini-2.5-flash-image', quality: 'gemini-3-pro-image-preview' };
const GENERATED_DIR = path.join(__dirname, '..', '..', 'media', 'generated');

// Ensure generated dir exists
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// ─── Projects Indexed ───

router.get('/projects-indexed', (req, res) => {
  try {
    const indexes = db.getAllRagIndexes().filter(i => i.status === 'ready');
    res.json({ projects: indexes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Campaigns CRUD ───

router.get('/campaigns', (req, res) => {
  try {
    const campaigns = db.getAllCampaigns();
    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id', (req, res) => {
  try {
    const campaign = db.getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const items = db.getCampaignItems(req.params.id);
    res.json({ campaign, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', (req, res) => {
  try {
    const campaign = db.getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Delete associated generated images
    const items = db.getCampaignItems(req.params.id);
    for (const item of items) {
      if (item.image_path) {
        const imgPath = path.join(GENERATED_DIR, path.basename(item.image_path));
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
    }

    db.deleteCampaign(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Campaign (ChatGPT + RAG) ───

router.post('/generate-campaign', async (req, res) => {
  try {
    const { projectName, platform, description, imageCount } = req.body;
    if (!projectName || !platform || !description) {
      return res.status(400).json({ error: 'projectName, platform, and description are required' });
    }

    // Check RAG index
    const index = db.getRagIndex(projectName);
    if (!index || index.status !== 'ready') {
      return res.status(400).json({ error: 'Project is not indexed. Please index it first in the RAG section.' });
    }

    // Create campaign in DB
    const campaignId = crypto.randomUUID();
    db.createCampaign(campaignId, projectName, platform, '', description, 'generating', {});

    try {
      // Embed description for RAG context
      const queryVector = await embedQuery(description);

      // Search Qdrant for project context
      const results = await qdrant.search(projectName, queryVector, 8);

      const context = results.map((r, i) =>
        `--- Source ${i + 1}: ${r.filePath} (lines ${r.startLine}-${r.endLine}) ---\n${r.content}`
      ).join('\n\n');

      // Platform-specific instructions
      const platformGuides = {
        linkedin: 'Professional tone, longer form content (1300+ chars), use relevant hashtags (3-5), include a call to action. Format with line breaks for readability.',
        twitter: 'Concise and punchy (max 280 chars per tweet), use 1-3 hashtags, conversational tone. Create a thread of 3-5 tweets.',
        instagram: 'Visual-first approach, engaging caption with storytelling, use 10-15 relevant hashtags, include emojis. Focus on lifestyle/behind-the-scenes angles.',
        facebook: 'Conversational and engaging, medium-length posts, encourage comments/shares, use 2-3 hashtags max.',
      };

      const platformGuide = platformGuides[platform.toLowerCase()] || platformGuides.linkedin;
      const postCount = imageCount || 3;

      const systemPrompt = `You are a marketing content expert. Generate a social media campaign based on the project context provided.

Platform: ${platform}
Platform guidelines: ${platformGuide}

Project context from codebase:
${context}

Generate exactly ${postCount} posts for this campaign. Each post should highlight different aspects of the project.

IMPORTANT: Respond ONLY with valid JSON. No markdown. No explanation. No extra text.

JSON format:
{
  "title": "Campaign title",
  "posts": [
    {
      "content": "The full post text with hashtags",
      "image_prompt": "A detailed prompt for generating an accompanying image (describe visual style, composition, colors, mood)",
      "hashtags": ["tag1", "tag2"]
    }
  ]
}`;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.responses.create({
        model: GPT_MODEL,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Campaign brief: ${description}` },
        ],
      });

      const answer = response.output
        .filter(o => o.type === 'message')
        .flatMap(o => o.content)
        .filter(c => c.type === 'output_text')
        .map(c => c.text)
        .join('\n');

      // Parse JSON response
      const cleaned = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const campaignData = JSON.parse(cleaned);

      // Update campaign title
      db.updateCampaignData(campaignId, campaignData);
      db.updateCampaignStatus(campaignId, 'ready');

      // Create campaign items
      const items = [];
      for (let i = 0; i < campaignData.posts.length; i++) {
        const post = campaignData.posts[i];
        const itemId = crypto.randomUUID();
        db.createCampaignItem(
          itemId, campaignId, 'post',
          post.content, '', post.image_prompt,
          { hashtags: post.hashtags || [] }, i
        );
        items.push({
          id: itemId,
          item_type: 'post',
          content: post.content,
          image_prompt: post.image_prompt,
          metadata: { hashtags: post.hashtags || [] },
          sort_order: i,
          image_path: '',
        });
      }

      const campaign = db.getCampaign(campaignId);
      res.json({ campaign, items, title: campaignData.title });

    } catch (err) {
      db.updateCampaignStatus(campaignId, 'error');
      throw err;
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generation Jobs ───

// Helper: merge live progress from in-memory Map into DB job
function enrichJobWithLive(job) {
  const live = imageGenerator.getJobProgress(job.id);
  if (live) {
    return { ...job, _live: live };
  }
  return { ...job, _live: null };
}

// POST /jobs — Create a studio generation job
router.post('/jobs', (req, res) => {
  try {
    const { prompt, quantity, aspectRatio, model } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(400).json({ error: 'Google AI API key is not configured. Set it in Settings > API Keys.' });
    }

    const count = Math.min(Math.max(quantity || 1, 1), 10);
    const resolvedModel = MODEL_MAP[model] || MODEL_MAP.fast;
    const jobId = crypto.randomUUID();
    const userId = req.user?.userId || 'anonymous';

    db.createGenerationJob(jobId, userId, 'studio', resolvedModel, prompt, count, aspectRatio || '1:1', '', []);
    imageGenerator.startJob(jobId, 'studio');

    res.json({ jobId, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /jobs/campaign-batch — Create a campaign batch generation job
router.post('/jobs/campaign-batch', (req, res) => {
  try {
    const { campaignId, model } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });
    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(400).json({ error: 'Google AI API key is not configured.' });
    }

    const campaign = db.getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const items = db.getCampaignItems(campaignId);
    const itemIds = items.map(i => i.id);
    if (itemIds.length === 0) return res.status(400).json({ error: 'No campaign items to generate images for' });

    const resolvedModel = MODEL_MAP[model] || MODEL_MAP.fast;
    const jobId = crypto.randomUUID();
    const userId = req.user?.userId || 'anonymous';

    db.createGenerationJob(jobId, userId, 'campaign', resolvedModel, `Campaign: ${campaign.campaign_data?.title || campaignId}`, itemIds.length, '1:1', campaignId, itemIds);
    imageGenerator.startJob(jobId, 'campaign');

    res.json({ jobId, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs — List recent jobs for user
router.get('/jobs', (req, res) => {
  try {
    const userId = req.user?.userId || 'anonymous';
    const jobs = db.getGenerationJobsByUser(userId).map(enrichJobWithLive);
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs/active — Active jobs with live progress
router.get('/jobs/active', (req, res) => {
  try {
    const userId = req.user?.userId || 'anonymous';
    const jobs = db.getActiveGenerationJobs(userId).map(enrichJobWithLive);
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs/:id — Single job detail
router.get('/jobs/:id', (req, res) => {
  try {
    const job = db.getGenerationJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: enrichJobWithLive(job) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /jobs/:id — Delete a job
router.delete('/jobs/:id', (req, res) => {
  try {
    const job = db.getGenerationJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    db.deleteGenerationJob(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Legacy endpoints (backward compat) ───

router.post('/generate-images', (req, res) => {
  const { prompt, quantity, aspectRatio, model } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  if (!process.env.GOOGLE_AI_API_KEY) {
    return res.status(400).json({ error: 'Google AI API key is not configured. Set it in Settings > API Keys.' });
  }

  const count = Math.min(Math.max(quantity || 1, 1), 10);
  const resolvedModel = MODEL_MAP[model] || MODEL_MAP.fast;
  const jobId = crypto.randomUUID();
  const userId = req.user?.userId || 'anonymous';

  db.createGenerationJob(jobId, userId, 'studio', resolvedModel, prompt, count, aspectRatio || '1:1', '', []);
  imageGenerator.startJob(jobId, 'studio');

  res.json({ jobId, status: 'pending', message: 'Use GET /api/media-ai/jobs/:id to track progress' });
});

router.post('/generate-campaign-images', (req, res) => {
  const { itemId, prompt, model } = req.body;
  if (!itemId || !prompt) return res.status(400).json({ error: 'itemId and prompt are required' });
  if (!process.env.GOOGLE_AI_API_KEY) {
    return res.status(400).json({ error: 'Google AI API key is not configured.' });
  }

  const item = db.getCampaignItem(itemId);
  if (!item) return res.status(404).json({ error: 'Campaign item not found' });

  const resolvedModel = MODEL_MAP[model] || MODEL_MAP.fast;
  const jobId = crypto.randomUUID();
  const userId = req.user?.userId || 'anonymous';

  db.createGenerationJob(jobId, userId, 'campaign', resolvedModel, prompt, 1, '1:1', item.campaign_id, [itemId]);
  imageGenerator.startJob(jobId, 'campaign');

  res.json({ jobId, status: 'pending' });
});

module.exports = router;
