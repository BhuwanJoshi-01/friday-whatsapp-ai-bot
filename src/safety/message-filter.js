'use strict';

/**
 * Message Filter — pre-AI validation pipeline.
 * Drops old messages, filters group chats, checks rate limits, etc.
 * Returns { pass, reason } where pass=false means the message should be dropped.
 */

const config = require('../config');
const logger = require('../core/logger');

/**
 * Run all filter checks on a normalized message.
 * @param {object} msg - Normalized message from transport
 * @returns {{ pass: boolean, reason?: string }}
 */
function filter(msg) {
  // 1. Skip group messages (bot is for 1:1 only)
  if (msg.isGroup) {
    return { pass: false, reason: 'group_message' };
  }

  // 2. Skip empty messages
  if (!msg.text || msg.text.trim().length === 0) {
    // Allow media messages through (they might have captions later)
    if (!msg.hasMedia) {
      return { pass: false, reason: 'empty_message' };
    }
  }

  // 3. Skip stale/old messages (webhook replays, offline queue)
  const now = Math.floor(Date.now() / 1000);
  const age = now - (msg.timestamp || now);
  if (age > config.safety.oldMessageThresholdSec) {
    logger.debug({ jid: msg.jid, age }, 'Dropping stale message');
    return { pass: false, reason: 'stale_message' };
  }

  // 4. Skip status broadcasts
  if (msg.jid === 'status@broadcast') {
    return { pass: false, reason: 'status_broadcast' };
  }

  // 5. Skip owner's own messages (handled separately via message:owner event)
  if (msg.isFromMe) {
    return { pass: false, reason: 'own_message' };
  }

  return { pass: true };
}

module.exports = { filter };
