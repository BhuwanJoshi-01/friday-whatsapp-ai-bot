'use strict';

/**
 * Offline Assistant — manages the auto-reply vs manual-reply state.
 * Pauses auto-reply when the owner manually replies to a contact.
 * Resumes after a configurable cooldown period.
 */

const config = require('../config');
const logger = require('../core/logger');

// jid -> timestamp of last manual owner reply
const ownerActivity = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 min: don't auto-reply if owner replied within this window

/**
 * Record that the owner manually replied to a contact.
 * This pauses auto-reply for that contact.
 */
function recordOwnerReply(jid) {
  ownerActivity.set(jid, Date.now());
  logger.debug({ jid }, 'Owner activity recorded, auto-reply paused');
}

/**
 * Record that the owner is currently typing/texting.
 * This sets a shorter, temporary pause.
 */
function recordTyping(jid) {
  const now = Date.now();
  const TYPING_PAUSE_MS = 60 * 1000; // 1 min pause for typing
  
  const currentExpiry = (ownerActivity.get(jid) || 0) + COOLDOWN_MS;
  const newExpiry = now + TYPING_PAUSE_MS;
  
  if (newExpiry > currentExpiry) {
    // Set timestamp so that (now + TYPING_PAUSE_MS) - value = COOLDOWN_MS
    // value = now + TYPING_PAUSE_MS - COOLDOWN_MS
    ownerActivity.set(jid, now + TYPING_PAUSE_MS - COOLDOWN_MS);
    logger.debug({ jid }, 'Owner typing detected, auto-reply paused for 60s');
  }
}

/**
 * Check if the owner is currently active with a contact
 * (meaning auto-reply should be suppressed).
 */
function isOwnerActive(jid) {
  const lastReply = ownerActivity.get(jid);
  if (!lastReply) return false;

  const elapsed = Date.now() - lastReply;
  if (elapsed < COOLDOWN_MS) {
    return true;
  }

  // Cooldown expired, clean up
  ownerActivity.delete(jid);
  return false;
}

/**
 * Get the remaining cooldown time for a contact.
 */
function getCooldownRemaining(jid) {
  const lastReply = ownerActivity.get(jid);
  if (!lastReply) return 0;

  const remaining = COOLDOWN_MS - (Date.now() - lastReply);
  return remaining > 0 ? remaining : 0;
}

/**
 * Force-resume auto-reply for a contact (admin command).
 */
function forceResume(jid) {
  ownerActivity.delete(jid);
  logger.info({ jid }, 'Auto-reply force-resumed');
}

/**
 * Get all contacts where owner is currently active.
 */
function getActiveContacts() {
  const now = Date.now();
  const active = [];
  for (const [jid, ts] of ownerActivity) {
    if (now - ts < COOLDOWN_MS) {
      active.push({ jid, lastReply: ts, remainingMs: COOLDOWN_MS - (now - ts) });
    }
  }
  return active;
}

/**
 * Get all tracked owner activity (internal map exposure).
 */
function getAllActivity() {
  return ownerActivity;
}

module.exports = {
  recordOwnerReply,
  recordTyping,
  isOwnerActive,
  getCooldownRemaining,
  forceResume,
  getActiveContacts,
  getAllActivity,
};
