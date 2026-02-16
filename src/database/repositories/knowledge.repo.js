'use strict';

/**
 * knowledge.repo.js — CRUD for the knowledge_base table.
 */

const { getDb } = require('../connection');

function add(data) {
  const result = getDb().prepare(`
    INSERT INTO knowledge_base (category, topic, question, answer, keywords, priority, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.category,
    data.topic,
    data.question || null,
    data.answer,
    data.keywords || null,
    data.priority || 1,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
  );
  return result.lastInsertRowid;
}

function getById(id) {
  return getDb().prepare('SELECT * FROM knowledge_base WHERE id = ?').get(id);
}

function update(id, data) {
  const fields = [];
  const values = [];

  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
  if (data.topic !== undefined) { fields.push('topic = ?'); values.push(data.topic); }
  if (data.question !== undefined) { fields.push('question = ?'); values.push(data.question); }
  if (data.answer !== undefined) { fields.push('answer = ?'); values.push(data.answer); }
  if (data.keywords !== undefined) { fields.push('keywords = ?'); values.push(data.keywords); }
  if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active ? 1 : 0); }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE knowledge_base SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getById(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
}

function listAll(activeOnly = true) {
  if (activeOnly) {
    return getDb().prepare('SELECT * FROM knowledge_base WHERE is_active = 1 ORDER BY category, priority DESC').all();
  }
  return getDb().prepare('SELECT * FROM knowledge_base ORDER BY category, priority DESC').all();
}

function listByCategory(category) {
  return getDb().prepare('SELECT * FROM knowledge_base WHERE category = ? AND is_active = 1 ORDER BY priority DESC').all(category);
}

/**
 * Search KB entries by keyword match or topic.
 */
function search(query) {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT * FROM knowledge_base
    WHERE is_active = 1 AND (
      keywords LIKE ? OR topic LIKE ? OR question LIKE ? OR answer LIKE ?
    )
    ORDER BY priority DESC
  `).all(pattern, pattern, pattern, pattern);
}

module.exports = {
  add,
  getById,
  update,
  remove,
  listAll,
  listByCategory,
  search,
};
