'use strict';

/**
 * Loop Detector — detects bot-to-bot echo loops and repetitive messaging.
 * Halts auto-reply for a contact when a loop pattern is detected.
 */

const config = require('../config');
const logger = require('../core/logger');

// jid -> { messages: string[], haltedUntil: number }
const state = new Map();

const WINDOW_SIZE = 6;     // Look at last N messages
const SIMILARITY_THRESHOLD = 0.8;

/**
 * Check if a contact is in a suspected loop.
 * @param {string} jid
 * @param {string} text - New incoming message
 * @returns {{ loopDetected: boolean, isHalted: boolean, haltRemainingMs?: number }}
 */
function check(jid, text) {
  let entry = state.get(jid);
  if (!entry) {
    entry = { messages: [], haltedUntil: 0 };
    state.set(jid, entry);
  }

  const now = Date.now();

  // If halted, check if halt has expired
  if (entry.haltedUntil > now) {
    return {
      loopDetected: true,
      isHalted: true,
      haltRemainingMs: entry.haltedUntil - now,
    };
  }

  // Reset halt if expired
  if (entry.haltedUntil > 0 && entry.haltedUntil <= now) {
    entry.haltedUntil = 0;
    entry.messages = [];
  }

  // Add new message to window
  entry.messages.push(text.toLowerCase().trim());
  if (entry.messages.length > WINDOW_SIZE) {
    entry.messages.shift();
  }

  // Check for loop pattern
  const threshold = config.safety.loopDetectThreshold;
  if (entry.messages.length >= threshold) {
    const recent = entry.messages.slice(-threshold);
    if (_hasRepetition(recent)) {
      entry.haltedUntil = now + config.safety.haltDurationMs;
      logger.warn({ jid, pattern: recent, haltMs: config.safety.haltDurationMs }, 'Loop detected, halting auto-reply');
      return { loopDetected: true, isHalted: true, haltRemainingMs: config.safety.haltDurationMs };
    }
  }

  return { loopDetected: false, isHalted: false };
}

/**
 * Check if messages are repetitive (same or very similar).
 */
function _hasRepetition(messages) {
  if (messages.length < 2) return false;

  // Check if all messages are identical
  const unique = new Set(messages);
  if (unique.size === 1) return true;

  // Check if messages are very similar (Jaccard similarity on word sets)
  const first = new Set(messages[0].split(/\s+/));
  let similarCount = 0;
  for (let i = 1; i < messages.length; i++) {
    const words = new Set(messages[i].split(/\s+/));
    const intersection = [...first].filter((w) => words.has(w)).length;
    const union = new Set([...first, ...words]).size;
    if (union > 0 && intersection / union >= SIMILARITY_THRESHOLD) {
      similarCount++;
    }
  }

  return similarCount >= messages.length - 1;
}

/**
 * Manually clear halt for a contact (admin command).
 */
function clearHalt(jid) {
  state.delete(jid);
  logger.info({ jid }, 'Loop halt cleared');
}

/**
 * Check if a contact is currently halted.
 */
function isHalted(jid) {
  const entry = state.get(jid);
  if (!entry) return false;
  return entry.haltedUntil > Date.now();
}

module.exports = { check, clearHalt, isHalted };
