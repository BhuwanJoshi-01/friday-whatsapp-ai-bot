'use strict';

/**
 * Chat Session Manager — maintains per-contact Gemini chat sessions
 * with windowed context, automatic pruning, and conversation summaries.
 * Replaces the old unbounded `chats` Map.
 */

const config = require('../config');
const logger = require('../core/logger');
const gemini = require('./gemini-client');
const promptBuilder = require('./prompt-builder');

const MAX_SESSIONS = 200; // Max concurrent open sessions
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle before eviction

class ChatSessionManager {
  constructor() {
    /** @type {Map<string, { history: any[], lastAccess: number, turnCount: number, systemInstruction: string }>} */
    this._sessions = new Map();

    // Periodic cleanup every 5 minutes
    this._cleanupTimer = setInterval(() => this._evictStale(), 5 * 60 * 1000);
    this._cleanupTimer.unref();
  }

  /**
   * Get or initialize a chat session entry.
   */
  _getEntry(jid, contactProfile = null) {
    let entry = this._sessions.get(jid);

    if (entry) {
      entry.lastAccess = Date.now();
      return entry;
    }

    // Build personalized system instruction once
    const systemInstruction = promptBuilder.buildSystemPrompt(contactProfile);

    entry = { 
      history: [], 
      lastAccess: Date.now(), 
      turnCount: 0,
      systemInstruction 
    };
    
    this._sessions.set(jid, entry);

    // If we've exceeded max sessions, evict oldest
    if (this._sessions.size > MAX_SESSIONS) {
      this._evictOldest();
    }

    logger.debug({ jid, totalSessions: this._sessions.size }, 'Initialized new chat session history');
    return entry;
  }

  /**
   * Send a message through a contact's session.
   * Every call creates a fresh chat session with a new key from the pool.
   * @param {string} jid - Contact JID
   * @param {string} userMessage - The inbound message text
   * @param {object} [contactProfile] - Contact profile object
   * @returns {Promise<string>} AI reply text
   */
  async reply(jid, userMessage, contactProfile = null) {
    const entry = this._getEntry(jid, contactProfile);
    const poolSize = config.gemini.apiKeys?.length || 1;
    let lastErr = null;

    for (let i = 0; i < poolSize; i++) {
        try {
          // Create fresh chat session using NEXT available key
          // This will throw QuotaError if all keys are exhausted
          const chat = gemini.createChat(entry.systemInstruction, { history: entry.history });
          
          const result = await gemini.sendMessage(chat, userMessage);
          
          // Update entry state
          entry.history = result.history;
          entry.turnCount++;
          entry.lastAccess = Date.now();

          return result.text;
        } catch (err) {
          if (err.name === 'QuotaError') {
            lastErr = err;
            if (err.message.includes('All Gemini keys')) {
              break; // No point in retrying if they are all exhausted
            }
            logger.warn({ jid, attempt: i + 1 }, 'Selected key was rate limited, switching to next key...');
            continue; 
          }
          throw err;
        }
    }
    
    throw lastErr || new Error('All keys in pool are exhausted');
  }

  /**
   * Legacy getOrCreate for backward compatibility (if needed).
   */
  getOrCreate(jid, contactProfile = null) {
    return this._getEntry(jid, contactProfile);
  }

  /**
   * Send a message through a contact's session.
   */
  // reply() already defined above


  /**
   * Reset a specific contact's session (e.g., after context compression).
   */
  reset(jid) {
    this._sessions.delete(jid);
    logger.debug({ jid }, 'Chat session reset');
  }

  /**
   * Reset all sessions.
   */
  resetAll() {
    this._sessions.clear();
    logger.info('All chat sessions reset');
  }

  /**
   * Get session info for a contact.
   */
  getInfo(jid) {
    const entry = this._sessions.get(jid);
    if (!entry) return null;
    return {
      turnCount: entry.turnCount,
      lastAccess: entry.lastAccess,
      idleMs: Date.now() - entry.lastAccess,
    };
  }

  /**
   * Get count of active sessions.
   */
  get size() {
    return this._sessions.size;
  }

  /**
   * Evict sessions older than SESSION_TTL_MS.
   */
  _evictStale() {
    const now = Date.now();
    let evicted = 0;
    for (const [jid, entry] of this._sessions) {
      if (now - entry.lastAccess > SESSION_TTL_MS) {
        this._sessions.delete(jid);
        evicted++;
      }
    }
    if (evicted > 0) {
      logger.debug({ evicted, remaining: this._sessions.size }, 'Evicted stale chat sessions');
    }
  }

  /**
   * Evict the oldest session by lastAccess.
   */
  _evictOldest() {
    let oldestJid = null;
    let oldestTime = Infinity;
    for (const [jid, entry] of this._sessions) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestJid = jid;
      }
    }
    if (oldestJid) {
      this._sessions.delete(oldestJid);
      logger.debug({ jid: oldestJid }, 'Evicted oldest chat session (capacity)');
    }
  }

  /**
   * Cleanup on shutdown.
   */
  destroy() {
    clearInterval(this._cleanupTimer);
    this._sessions.clear();
  }
}

// Singleton
module.exports = new ChatSessionManager();
