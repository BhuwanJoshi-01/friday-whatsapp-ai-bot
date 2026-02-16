'use strict';

/**
 * Rate Limiter — prevents excessive AI calls per contact.
 * Uses a sliding window counter in memory (fast) with periodic SQLite logging.
 */

const config = require('../config');
const logger = require('../core/logger');

// In-memory sliding window: jid -> [timestamp, timestamp, ...]
const windows = new Map();

/**
 * Check if a contact is within rate limits.
 * @param {string} jid
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs?: number }}
 */
function check(jid) {
  const now = Date.now();
  const windowMs = config.safety.rateLimitWindowMs;
  const max = config.safety.rateLimitMax;

  let timestamps = windows.get(jid);
  if (!timestamps) {
    timestamps = [];
    windows.set(jid, timestamps);
  }

  // Prune expired timestamps
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= max) {
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    logger.warn({ jid, count: timestamps.length, max }, 'Rate limit exceeded');
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  return { allowed: true, remaining: max - timestamps.length };
}

/**
 * Record a usage event for a contact.
 * Call this AFTER processing (not before) to track actual AI calls.
 */
function record(jid) {
  const now = Date.now();
  let timestamps = windows.get(jid);
  if (!timestamps) {
    timestamps = [];
    windows.set(jid, timestamps);
  }
  timestamps.push(now);
}

/**
 * Reset rate limit for a specific contact (admin command).
 */
function reset(jid) {
  windows.delete(jid);
}

/**
 * Get current usage stats for a contact.
 */
function stats(jid) {
  const now = Date.now();
  const windowMs = config.safety.rateLimitWindowMs;
  const max = config.safety.rateLimitMax;
  const timestamps = windows.get(jid);

  if (!timestamps) return { count: 0, max, windowMs };

  const cutoff = now - windowMs;
  const active = timestamps.filter((t) => t >= cutoff);
  return { count: active.length, max, windowMs };
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = config.safety.rateLimitWindowMs;
  for (const [jid, timestamps] of windows) {
    const cutoff = now - windowMs;
    const active = timestamps.filter((t) => t >= cutoff);
    if (active.length === 0) {
      windows.delete(jid);
    } else {
      windows.set(jid, active);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { check, record, reset, stats };
