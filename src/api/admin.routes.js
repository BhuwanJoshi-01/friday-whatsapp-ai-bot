'use strict';

const { Router } = require('express');
const followUpTracker = require('../services/follow-up-tracker');
const scheduleAssistant = require('../services/schedule-assistant');
const knowledgeBase = require('../services/knowledge-base');
const learningEngine = require('../services/learning-engine');
const ownerSummary = require('../services/owner-summary');
const memoryManager = require('../services/memory-manager');

const router = Router();

// --- Follow-ups ---

router.get('/follow-ups', (req, res) => {
  try {
    const pending = followUpTracker.listPending(req.query.jid);
    res.json({ followUps: pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/follow-ups/:id/resolve', (req, res) => {
  try {
    followUpTracker.resolve(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Schedules ---

router.get('/schedules', (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 48;
    const schedules = scheduleAssistant.listUpcoming(hours);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedules/:id/complete', (req, res) => {
  try {
    scheduleAssistant.complete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedules/:id/cancel', (req, res) => {
  try {
    scheduleAssistant.cancel(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Knowledge Base ---

router.get('/knowledge', (req, res) => {
  try {
    const { category, q } = req.query;
    if (q) {
      return res.json({ entries: knowledgeBase.search(q) });
    }
    res.json({ entries: knowledgeBase.list(category) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/knowledge', (req, res) => {
  try {
    const id = knowledgeBase.add(req.body);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/knowledge/:id', (req, res) => {
  try {
    knowledgeBase.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Learning ---

router.get('/learning', (req, res) => {
  try {
    res.json(learningEngine.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Summary ---

router.post('/summary', async (req, res) => {
  try {
    const hours = parseInt(req.body.hours, 10) || undefined;
    const summary = await ownerSummary.generateSummary(hours);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary/latest', (req, res) => {
  try {
    const latest = ownerSummary.getLatest();
    if (!latest) return res.status(404).json({ error: 'No summaries yet' });
    res.json({ summary: latest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Memory ---

router.post('/memory/compress', async (req, res) => {
  try {
    await memoryManager.compressAll();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
