'use strict';

/**
 * Bot Detector — identifies likely automated/bot accounts
 * to avoid bot-to-bot loops. Uses heuristics.
 */

const logger = require('../core/logger');

// Known patterns for bot behavior
const BOT_INDICATORS = [
  /\bthis is an automated/i,
  /\bdo not reply/i,
  /\bauto.?generated/i,
  /\bno.?reply/i,
  /\bpowered by/i,
  /\bbot\b/i,
  /\bsent via/i,
  /\bunsubscribe/i,
];

// JIDs that are always bots
const BOT_JIDS = new Set([
  'status@broadcast',
]);

/**
 * Check if a message appears to be from a bot.
 * @param {object} msg - Normalized message
 * @returns {{ isBot: boolean, confidence: number, reason?: string }}
 */
function check(msg) {
  // Known bot JID
  if (BOT_JIDS.has(msg.jid)) {
    return { isBot: true, confidence: 1.0, reason: 'known_bot_jid' };
  }

  // Check message text for bot-like patterns
  if (msg.text) {
    for (const pattern of BOT_INDICATORS) {
      if (pattern.test(msg.text)) {
        return { isBot: true, confidence: 0.7, reason: `text_pattern: ${pattern.source}` };
      }
    }
  }

  // Check pushName for bot indicators
  if (msg.pushName) {
    const lower = msg.pushName.toLowerCase();
    if (lower.includes('bot') || lower.includes('auto') || lower.includes('system') || lower.includes('noreply')) {
      return { isBot: true, confidence: 0.6, reason: `name_pattern: ${msg.pushName}` };
    }
  }

  return { isBot: false, confidence: 0.0 };
}

/**
 * Add a JID to the known bots set (persists only for session).
 */
function markAsBot(jid) {
  BOT_JIDS.add(jid);
  logger.info({ jid }, 'JID marked as bot');
}

module.exports = { check, markAsBot };
