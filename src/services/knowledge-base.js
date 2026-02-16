'use strict';

/**
 * Knowledge Base — stores and retrieves factual Q&A pairs
 * that the bot can use to answer questions without AI.
 */

const logger = require('../core/logger');
const knowledgeRepo = require('../database/repositories/knowledge.repo');

/**
 * Add a knowledge entry.
 * @param {object} entry - { category, topic, question, answer, keywords, priority }
 * @returns {string} Entry ID
 */
function add(entry) {
  const id = knowledgeRepo.add(entry);
  logger.info({ id, topic: entry.topic }, 'Knowledge entry added');
  return id;
}

/**
 * Search the knowledge base for relevant entries.
 * @param {string} query - Search text
 * @returns {Array} Matching entries sorted by relevance
 */
function search(query) {
  if (!query || query.trim().length < 2) return [];
  return knowledgeRepo.search(query);
}

/**
 * Get all entries, optionally filtered by category.
 */
function list(category) {
  if (category) {
    return knowledgeRepo.listByCategory(category);
  }
  return knowledgeRepo.listAll(true);
}

/**
 * Update an entry.
 */
function update(id, fields) {
  return knowledgeRepo.update(id, fields);
}

/**
 * Remove an entry.
 */
function remove(id) {
  return knowledgeRepo.remove(id);
}

/**
 * Get entry by ID.
 */
function getById(id) {
  return knowledgeRepo.getById(id);
}

module.exports = { add, search, list, update, remove, getById };
