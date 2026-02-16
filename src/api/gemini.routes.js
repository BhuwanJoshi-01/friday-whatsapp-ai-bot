'use strict';

const { Router } = require('express');
const gemini = require('../ai/gemini-client');
const logger = require('../core/logger');

const router = Router();

/**
 * GET /api/gemini/models — List available models.
 */
router.get('/models', async (req, res) => {
  try {
    const models = await gemini.listModels();
    res.json({ models });
  } catch (err) {
    logger.error({ err }, 'List models failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/gemini/generate — One-shot generation.
 * Body: { prompt, temperature?, maxTokens? }
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt, temperature, maxTokens } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const result = await gemini.generate(prompt, { temperature, maxTokens });
    res.json({ result });
  } catch (err) {
    logger.error({ err }, 'Generate failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/gemini/chat — Chat with context (test endpoint).
 * Body: { from, message }
 */
router.post('/chat', async (req, res) => {
  try {
    const { from, message } = req.body;
    if (!from || !message) return res.status(400).json({ error: 'Missing from or message' });

    const chatSession = require('../ai/chat-session');
    const reply = await chatSession.reply(from, message);
    res.json({ reply });
  } catch (err) {
    logger.error({ err }, 'Chat failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
