'use strict';

/**
 * Memory Manager — handles conversation compression, pruning,
 * and long-term memory via summaries stored in SQLite.
 */

const logger = require('../core/logger');
const config = require('../config');
const messagesRepo = require('../database/repositories/messages.repo');
const db = require('../database/connection');
const compressor = require('../ai/context-compressor');
const chatSession = require('../ai/chat-session');

const COMPRESS_THRESHOLD = 50; // Compress when > N messages for a contact

/**
 * Compress old messages for a contact into a summary.
 * Keeps recent messages intact, summarizes older ones.
 */
async function compressContact(jid) {
  try {
    const recentCount = 20;
    const allRecent = messagesRepo.getRecent(jid, recentCount + COMPRESS_THRESHOLD);

    if (allRecent.length <= recentCount) {
      return; // Not enough messages to compress
    }

    // Messages to compress (everything except the most recent N)
    const toCompress = allRecent.slice(0, allRecent.length - recentCount);

    // Get existing summary
    const existingSummary = _getLatestSummary(jid);

    let newSummary;
    if (existingSummary) {
      newSummary = await compressor.merge(existingSummary.summary_text, toCompress);
    } else {
      newSummary = await compressor.compress(toCompress);
    }

    if (newSummary) {
      _saveSummary(jid, newSummary, toCompress);

      // Delete the compressed messages from DB to save space
      const oldestId = toCompress[0].id;
      const newestId = toCompress[toCompress.length - 1].id;
      messagesRepo.deleteRange(jid, oldestId, newestId);

      // Reset the chat session so it picks up the new summary
      chatSession.reset(jid);

      logger.info({ jid, compressed: toCompress.length }, 'Conversation compressed');
    }
  } catch (err) {
    logger.error({ err, jid }, 'Conversation compression failed');
  }
}

/**
 * Compress all contacts that have accumulated enough messages.
 */
async function compressAll() {
  try {
    const database = db.getDb();
    const contacts = database.prepare(
      `SELECT jid, COUNT(*) as count FROM messages GROUP BY jid HAVING count > ?`
    ).all(COMPRESS_THRESHOLD + 20);

    for (const { jid } of contacts) {
      await compressContact(jid);
    }

    logger.info({ contactCount: contacts.length }, 'Bulk compression complete');
  } catch (err) {
    logger.error({ err }, 'Bulk compression failed');
  }
}

/**
 * Get the latest conversation summary for a contact.
 */
function _getLatestSummary(jid) {
  try {
    const database = db.getDb();
    return database.prepare(
      `SELECT * FROM conversation_summaries WHERE jid = ? ORDER BY created_at DESC LIMIT 1`
    ).get(jid) || null;
  } catch {
    return null;
  }
}

/**
 * Save a conversation summary.
 */
function _saveSummary(jid, summaryText, compressedMessages) {
  const database = db.getDb();
  const { nanoid } = require('nanoid');
  const messageRange = JSON.stringify({
    firstId: compressedMessages[0].id,
    lastId: compressedMessages[compressedMessages.length - 1].id,
    count: compressedMessages.length,
  });

  database.prepare(`
    INSERT INTO conversation_summaries (id, jid, summary_text, message_range, turn_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), jid, summaryText, messageRange, compressedMessages.length);
}

/**
 * Get the conversation context for a contact (summary + recent messages).
 * Used by the prompt builder.
 */
function getContext(jid) {
  const summary = _getLatestSummary(jid);
  const recent = messagesRepo.getRecent(jid, 10);

  return {
    summary: summary ? summary.summary_text : null,
    recentMessages: recent,
  };
}

/**
 * Prune very old summaries (keep only latest 5 per contact).
 */
function pruneSummaries() {
  try {
    const database = db.getDb();
    database.prepare(`
      DELETE FROM conversation_summaries 
      WHERE id NOT IN (
        SELECT id FROM conversation_summaries cs2 
        WHERE cs2.jid = conversation_summaries.jid 
        ORDER BY created_at DESC LIMIT 5
      )
    `).run();
    logger.debug('Old summaries pruned');
  } catch (err) {
    logger.debug({ err }, 'Summary pruning failed (non-critical)');
  }
}

module.exports = {
  compressContact,
  compressAll,
  getContext,
  pruneSummaries,
};
