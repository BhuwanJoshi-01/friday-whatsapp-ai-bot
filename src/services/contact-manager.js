'use strict';

/**
 * Contact Manager — handles contact enrichment, VIP tiering, auto-reply toggles.
 * Bridges transport events with the contacts repository.
 */

const bus = require('../core/event-bus');
const logger = require('../core/logger');
const contactsRepo = require('../database/repositories/contacts.repo');

/**
 * Initialize — wire up event listeners.
 */
function init() {
  // Auto-enrich contact on first message
  bus.on('transport:message:raw', (msg) => {
    try {
      if (msg.pushName && msg.jid) {
        contactsRepo.upsert(msg.jid, { display_name: msg.pushName });
      }
    } catch (err) {
      logger.debug({ err }, 'Contact upsert failed (non-critical)');
    }
  });

  logger.info('Contact manager initialized');
}

/**
 * Set VIP tier for a contact.
 * @param {string} jid
 * @param {number} tier - 0=normal, 1=friend, 2=important, 3=critical
 */
function setVip(jid, tier) {
  contactsRepo.setVipTier(jid, tier);
  logger.info({ jid, tier }, 'VIP tier updated');
}

/**
 * Toggle auto-reply for a contact.
 */
function toggleAutoReply(jid, enabled) {
  contactsRepo.setAutoReply(jid, enabled);
  logger.info({ jid, enabled }, 'Auto-reply toggled');
}

/**
 * Update contact profile fields.
 */
function updateProfile(jid, fields) {
  contactsRepo.updateProfile(jid, fields);
}

/**
 * Get contact info.
 */
function getContact(jid) {
  return contactsRepo.getByJid(jid);
}

/**
 * List all VIP contacts.
 */
function listVip() {
  return contactsRepo.listVIP();
}

/**
 * List all contacts.
 */
function listAll() {
  return contactsRepo.listAll();
}

/**
 * List contacts active within given hours.
 */
function listActive(hours = 24) {
  return contactsRepo.listActive(hours);
}

/**
 * Search contacts by name/jid.
 */
function search(query) {
  return contactsRepo.search(query);
}

module.exports = {
  init,
  setVip,
  toggleAutoReply,
  updateProfile,
  getContact,
  listVip,
  listAll,
  listActive,
  search,
};
