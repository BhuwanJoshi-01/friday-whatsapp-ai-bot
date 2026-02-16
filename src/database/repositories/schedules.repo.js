'use strict';

/**
 * schedules.repo.js — CRUD for the schedules table.
 */

const { getDb } = require('../connection');

function create(data) {
  const result = getDb().prepare(`
    INSERT INTO schedules (jid, title, description, event_at, remind_at, recurrence, status, source_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.jid || null,
    data.title,
    data.description || null,
    data.event_at,
    data.remind_at || null,
    data.recurrence || null,
    data.status || 'active',
    data.source_message_id || null,
  );
  return result.lastInsertRowid;
}

function getById(id) {
  return getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id);
}

function listUpcoming(limit = 20) {
  return getDb().prepare(`
    SELECT s.*, c.display_name FROM schedules s
    LEFT JOIN contacts c ON s.jid = c.jid
    WHERE s.status = 'active' AND s.event_at >= datetime('now')
    ORDER BY s.event_at ASC LIMIT ?
  `).all(limit);
}

function listDueReminders() {
  return getDb().prepare(`
    SELECT s.*, c.display_name FROM schedules s
    LEFT JOIN contacts c ON s.jid = c.jid
    WHERE s.status = 'active' AND s.remind_at <= datetime('now') AND s.remind_at IS NOT NULL
    ORDER BY s.remind_at ASC
  `).all();
}

function complete(id) {
  getDb().prepare("UPDATE schedules SET status = 'completed' WHERE id = ?").run(id);
}

function cancel(id) {
  getDb().prepare("UPDATE schedules SET status = 'cancelled' WHERE id = ?").run(id);
}

function snooze(id, newRemindAt) {
  getDb().prepare("UPDATE schedules SET status = 'snoozed', remind_at = ? WHERE id = ?").run(newRemindAt, id);
}

module.exports = {
  create,
  getById,
  listUpcoming,
  listDueReminders,
  complete,
  cancel,
  snooze,
};
