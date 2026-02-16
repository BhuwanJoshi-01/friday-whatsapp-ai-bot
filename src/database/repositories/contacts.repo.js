'use strict';

/**
 * contacts.repo.js — CRUD for the contacts table.
 */

const { getDb } = require('../connection');

function getByJid(jid) {
  return getDb().prepare('SELECT * FROM contacts WHERE jid = ?').get(jid);
}

function upsert(jid, data = {}) {
  const existing = getByJid(jid);
  if (existing) {
    // Update only provided fields + bump last_seen and message_count
    const fields = [];
    const values = [];

    if (data.display_name !== undefined) { fields.push('display_name = ?'); values.push(data.display_name); }
    if (data.phone_number !== undefined) { fields.push('phone_number = ?'); values.push(data.phone_number); }
    if (data.relationship_type !== undefined) { fields.push('relationship_type = ?'); values.push(data.relationship_type); }
    if (data.vip_tier !== undefined) { fields.push('vip_tier = ?'); values.push(data.vip_tier); }
    if (data.custom_tone !== undefined) { fields.push('custom_tone = ?'); values.push(typeof data.custom_tone === 'object' ? JSON.stringify(data.custom_tone) : data.custom_tone); }
    if (data.preferred_language !== undefined) { fields.push('preferred_language = ?'); values.push(data.preferred_language); }
    if (data.auto_reply_enabled !== undefined) { fields.push('auto_reply_enabled = ?'); values.push(data.auto_reply_enabled ? 1 : 0); }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }
    if (data.last_mood !== undefined) { fields.push('last_mood = ?'); values.push(data.last_mood); }
    if (data.is_bot !== undefined) { fields.push('is_bot = ?'); values.push(data.is_bot ? 1 : 0); }
    if (data.metadata !== undefined) { fields.push('metadata = ?'); values.push(typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : data.metadata); }

    // Always update
    fields.push("last_seen_at = datetime('now')");
    fields.push('message_count = message_count + 1');

    if (fields.length > 0) {
      values.push(jid);
      getDb().prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE jid = ?`).run(...values);
    }
    return getByJid(jid);
  }

  // Insert new contact
  const phone = data.phone_number || jid.replace(/@.*/, '');
  getDb().prepare(`
    INSERT INTO contacts (jid, phone_number, display_name, relationship_type, vip_tier, custom_tone, preferred_language, auto_reply_enabled, notes, message_count, last_mood, is_bot, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    jid,
    phone,
    data.display_name || null,
    data.relationship_type || 'unknown',
    data.vip_tier || 0,
    data.custom_tone ? (typeof data.custom_tone === 'object' ? JSON.stringify(data.custom_tone) : data.custom_tone) : null,
    data.preferred_language || 'en',
    data.auto_reply_enabled !== undefined ? (data.auto_reply_enabled ? 1 : 0) : 1,
    data.notes || null,
    data.last_mood || null,
    data.is_bot ? 1 : 0,
    data.metadata ? (typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : data.metadata) : null,
  );
  return getByJid(jid);
}

function updateProfile(jid, updates) {
  return upsert(jid, updates);
}

function setAutoReply(jid, enabled) {
  getDb().prepare('UPDATE contacts SET auto_reply_enabled = ? WHERE jid = ?').run(enabled ? 1 : 0, jid);
}

function setVipTier(jid, tier) {
  getDb().prepare('UPDATE contacts SET vip_tier = ? WHERE jid = ?').run(tier, jid);
}

function listVIP(minTier = 1) {
  return getDb().prepare('SELECT * FROM contacts WHERE vip_tier >= ? ORDER BY vip_tier DESC, last_seen_at DESC').all(minTier);
}

function listAll() {
  return getDb().prepare('SELECT * FROM contacts ORDER BY last_seen_at DESC').all();
}

function listActive(hours = 24) {
  return getDb().prepare(`
    SELECT * FROM contacts
    WHERE last_seen_at >= datetime('now', ? || ' hours')
    ORDER BY vip_tier DESC, last_seen_at DESC
  `).all(-hours);
}

function search(query) {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT * FROM contacts
    WHERE display_name LIKE ? OR phone_number LIKE ? OR jid LIKE ? OR notes LIKE ?
    ORDER BY last_seen_at DESC
  `).all(pattern, pattern, pattern, pattern);
}

module.exports = {
  getByJid,
  upsert,
  updateProfile,
  setAutoReply,
  setVipTier,
  listVIP,
  listAll,
  listActive,
  search,
};
