'use strict';

/**
 * messages.repo.js — CRUD for the messages table.
 */

const { getDb } = require('../connection');

function insert(data) {
  const result = getDb().prepare(`
    INSERT INTO messages (jid, direction, content, content_type, intent, mood, is_ai_generated, source_lib, wa_message_id, reply_to_id, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.jid,
    data.direction,
    data.content,
    data.content_type || 'text',
    data.intent || null,
    data.mood || null,
    data.is_ai_generated ? 1 : 0,
    data.source_lib || null,
    data.wa_message_id || null,
    data.reply_to_id || null,
    data.token_count || null,
  );
  return result.lastInsertRowid;
}

function getById(id) {
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

/**
 * Get recent messages for a contact (short-term context window).
 */
function getRecent(jid, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM messages WHERE jid = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(jid, limit).reverse(); // reverse to chronological order
}

/**
 * Get messages in a date range for a contact.
 */
function getByDateRange(jid, startDate, endDate) {
  return getDb().prepare(`
    SELECT * FROM messages WHERE jid = ? AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(jid, startDate, endDate);
}

/**
 * Count messages since a given time (for summaries).
 */
function countSince(since) {
  const row = getDb().prepare('SELECT COUNT(*) as cnt FROM messages WHERE created_at >= ?').get(since);
  return row ? row.cnt : 0;
}

/**
 * Get unique contacts who sent messages since a given time.
 */
function activeContactsSince(since) {
  return getDb().prepare(`
    SELECT DISTINCT jid FROM messages
    WHERE direction = 'inbound' AND created_at >= ?
  `).all(since).map(r => r.jid);
}

/**
 * Get messages older than a threshold for compression.
 */
function getOlderThan(jid, maxId) {
  return getDb().prepare(`
    SELECT * FROM messages WHERE jid = ? AND id <= ?
    ORDER BY created_at ASC
  `).all(jid, maxId);
}

/**
 * Delete compressed messages (after summarization).
 */
function deleteRange(jid, fromId, toId) {
  getDb().prepare('DELETE FROM messages WHERE jid = ? AND id BETWEEN ? AND ?').run(jid, fromId, toId);
}

/**
 * Search messages by keyword.
 */
function search(query, limit = 50) {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT * FROM messages WHERE content LIKE ?
    ORDER BY created_at DESC LIMIT ?
  `).all(pattern, limit);
}

/**
 * Get last N messages across all contacts (for owner summary).
 */
function getRecentGlobal(limit = 100) {
  return getDb().prepare(`
    SELECT m.*, c.display_name, c.vip_tier, c.relationship_type
    FROM messages m
    LEFT JOIN contacts c ON m.jid = c.jid
    WHERE m.direction IN ('inbound', 'outbound', 'owner_manual')
    ORDER BY m.created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  insert,
  getById,
  getRecent,
  getByDateRange,
  countSince,
  activeContactsSince,
  getOlderThan,
  deleteRange,
  search,
  getRecentGlobal,
};
