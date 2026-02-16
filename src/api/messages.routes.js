'use strict';

const { Router } = require('express');
const transport = require('../transport/transport-manager');
const messagesRepo = require('../database/repositories/messages.repo');
const logger = require('../core/logger');

const router = Router();

/**
 * POST /api/messages/send — Send a message (replaces old /send-message).
 * Body: { to, message }
 */
router.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing "to" or "message" in body' });
    }

    if (!transport.isReady()) {
      return res.status(503).json({ error: 'WhatsApp transport not ready' });
    }

    await transport.sendMessage(to, message);

    // Record outbound message
    messagesRepo.insert({
      jid: to,
      direction: 'outbound',
      content: message,
      content_type: 'text',
      is_ai_generated: false,
    });

    res.json({ success: true, to, message });
  } catch (err) {
    logger.error({ err }, 'Send message failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/messages/recent?jid=&limit=
 */
router.get('/recent', (req, res) => {
  try {
    const { jid, limit } = req.query;
    if (!jid) return res.status(400).json({ error: 'Missing jid parameter' });

    const messages = messagesRepo.getRecent(jid, parseInt(limit, 10) || 20);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/messages/search?q=
 */
router.get('/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q parameter' });

    const results = messagesRepo.search(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
