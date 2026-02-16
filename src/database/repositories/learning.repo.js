'use strict';

/**
 * learning.repo.js — CRUD for the learning_data table.
 */

const { getDb } = require('../connection');

function store(data) {
  // Check if a similar pattern already exists to reinforce it
  const existing = getDb().prepare(`
    SELECT * FROM learning_data
    WHERE pattern_type = ? AND (jid = ? OR jid IS NULL)
    AND context_intent = ?
    ORDER BY times_reinforced DESC LIMIT 1
  `).get(data.pattern_type, data.jid || null, data.context_intent || null);

  if (existing) {
    // Reinforce existing pattern
    getDb().prepare(`
      UPDATE learning_data
      SET times_reinforced = times_reinforced + 1,
          confidence = MIN(1.0, confidence + 0.05),
          owner_response = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(data.owner_response, existing.id);
    return existing.id;
  }

  const result = getDb().prepare(`
    INSERT INTO learning_data (jid, pattern_type, context_intent, incoming_sample, owner_response, extracted_pattern, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.jid || null,
    data.pattern_type,
    data.context_intent || null,
    data.incoming_sample || null,
    data.owner_response,
    data.extracted_pattern ? (typeof data.extracted_pattern === 'object' ? JSON.stringify(data.extracted_pattern) : data.extracted_pattern) : null,
    data.confidence || 0.5,
  );
  return result.lastInsertRowid;
}

/**
 * Get learned patterns for prompt building.
 * Returns high-confidence patterns, optionally filtered by contact and intent.
 */
function getPatterns(opts = {}) {
  const { jid, intent, minConfidence = 0.3, limit = 10 } = opts;

  let sql = 'SELECT * FROM learning_data WHERE confidence >= ?';
  const params = [minConfidence];

  if (jid) {
    sql += ' AND (jid = ? OR jid IS NULL)';
    params.push(jid);
  }
  if (intent) {
    sql += ' AND (context_intent = ? OR context_intent IS NULL)';
    params.push(intent);
  }

  sql += ' ORDER BY confidence DESC, times_reinforced DESC LIMIT ?';
  params.push(limit);

  return getDb().prepare(sql).all(...params);
}

function listAll(limit = 50) {
  return getDb().prepare('SELECT * FROM learning_data ORDER BY updated_at DESC LIMIT ?').all(limit);
}

module.exports = {
  store,
  getPatterns,
  listAll,
};
