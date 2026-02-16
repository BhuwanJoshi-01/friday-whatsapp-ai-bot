'use strict';

/**
 * follow-ups.repo.js — CRUD for the follow_ups table.
 */

const { getDb } = require('../connection');

function create(data) {
  const result = getDb().prepare(`
    INSERT INTO follow_ups (jid, trigger_message_id, description, status, priority, due_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.jid,
    data.trigger_message_id || null,
    data.description,
    data.status || 'pending',
    data.priority || 1,
    data.due_at || null,
  );
  return result.lastInsertRowid;
}

function getById(id) {
  return getDb().prepare('SELECT * FROM follow_ups WHERE id = ?').get(id);
}

function listPending(jid = null) {
  if (jid) {
    return getDb().prepare(`
      SELECT f.*, c.display_name FROM follow_ups f
      LEFT JOIN contacts c ON f.jid = c.jid
      WHERE f.status = 'pending' AND f.jid = ?
      ORDER BY f.priority DESC, f.due_at ASC
    `).all(jid);
  }
  return getDb().prepare(`
    SELECT f.*, c.display_name FROM follow_ups f
    LEFT JOIN contacts c ON f.jid = c.jid
    WHERE f.status = 'pending'
    ORDER BY f.priority DESC, f.due_at ASC
  `).all();
}

function listOverdue() {
  return getDb().prepare(`
    SELECT f.*, c.display_name FROM follow_ups f
    LEFT JOIN contacts c ON f.jid = c.jid
    WHERE f.status IN ('pending', 'reminded') AND f.due_at <= datetime('now')
    ORDER BY f.priority DESC, f.due_at ASC
  `).all();
}

function resolve(id) {
  getDb().prepare(`
    UPDATE follow_ups SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?
  `).run(id);
}

function markReminded(id) {
  getDb().prepare(`
    UPDATE follow_ups SET status = 'reminded', reminded_count = reminded_count + 1 WHERE id = ?
  `).run(id);
}

function expire(id) {
  getDb().prepare(`
    UPDATE follow_ups SET status = 'expired' WHERE id = ?
  `).run(id);
}

module.exports = {
  create,
  getById,
  listPending,
  listOverdue,
  resolve,
  markReminded,
  expire,
};
