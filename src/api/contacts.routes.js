'use strict';

const { Router } = require('express');
const contactManager = require('../services/contact-manager');

const router = Router();

/**
 * GET /api/contacts — List all contacts.
 */
router.get('/', (req, res) => {
  try {
    const contacts = contactManager.listAll();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/contacts/active?hours=
 */
router.get('/active', (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const contacts = contactManager.listActive(hours);
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/contacts/vip
 */
router.get('/vip', (req, res) => {
  try {
    const contacts = contactManager.listVip();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/contacts/:jid
 */
router.get('/:jid', (req, res) => {
  try {
    const contact = contactManager.getContact(req.params.jid);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/contacts/:jid — Update contact profile.
 */
router.put('/:jid', (req, res) => {
  try {
    contactManager.updateProfile(req.params.jid, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/contacts/:jid/vip — Set VIP tier.
 * Body: { tier: 0-3 }
 */
router.post('/:jid/vip', (req, res) => {
  try {
    const tier = parseInt(req.body.tier, 10);
    if (isNaN(tier) || tier < 0 || tier > 3) {
      return res.status(400).json({ error: 'Tier must be 0-3' });
    }
    contactManager.setVip(req.params.jid, tier);
    res.json({ success: true, tier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/contacts/:jid/auto-reply — Toggle auto-reply.
 * Body: { enabled: boolean }
 */
router.post('/:jid/auto-reply', (req, res) => {
  try {
    contactManager.toggleAutoReply(req.params.jid, req.body.enabled !== false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
