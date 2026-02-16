'use strict';

/**
 * Learning Engine — observes owner's manual replies and learns patterns.
 * Over time, the AI becomes more like the owner in tone and response style.
 */

const logger = require('../core/logger');
const gemini = require('../ai/gemini-client');
const learningRepo = require('../database/repositories/learning.repo');
const messagesRepo = require('../database/repositories/messages.repo');

const EXTRACT_PROMPT = `Analyze this owner's reply to a WhatsApp message and extract the response pattern.
Return JSON: {"style": "<brief description of tone/style>", "key_phrases": ["<characteristic phrases>"], "approach": "<how they handle this type of message>"}

Context (what the user said before):
"[CONTEXT]"

Owner's reply:
"[REPLY]"`;

/**
 * Learn from an owner's manual reply.
 * Correlates with the previous inbound message to extract patterns.
 */
async function learnFromOwner(jid, ownerText) {
  try {
    if (!ownerText || ownerText.trim().length < 5) return;

    // Skip commands
    if (ownerText.startsWith('!') || ownerText.startsWith('/')) return;

    // Get the last inbound message from this contact (what prompted the owner's reply)
    const recentInbound = messagesRepo.getRecent(jid, 5);
    const lastInbound = recentInbound.find((m) => m.direction === 'inbound');

    if (!lastInbound) return;

    // Detect intent of the original message for categorization
    const prompt = EXTRACT_PROMPT
      .replace('[CONTEXT]', lastInbound.content.substring(0, 200))
      .replace('[REPLY]', ownerText.substring(0, 300));

    const raw = await gemini.generate(prompt, { temperature: 0.1, maxTokens: 150 });
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const pattern = JSON.parse(jsonStr);

    learningRepo.store({
      jid,
      pattern_type: 'owner_reply',
      context_intent: lastInbound.intent || 'general',
      incoming_sample: lastInbound.content.substring(0, 500),
      owner_response: ownerText.substring(0, 500),
      extracted_pattern: pattern,
      confidence: 0.6, // Initial confidence, grows with reinforcement
    });

    logger.debug({ jid, intent: lastInbound.intent }, 'Learned from owner reply');
  } catch (err) {
    logger.debug({ err: err.message }, 'Learning extraction failed (non-critical)');
  }
}

/**
 * Get relevant learned patterns for generating a reply.
 * @param {string} jid - Contact JID (for contact-specific patterns)
 * @param {string} intent - Message intent
 * @returns {Array} Matching patterns sorted by confidence
 */
function getRelevantPatterns(jid, intent) {
  // Get contact-specific patterns first, then general ones
  const contactPatterns = learningRepo.getPatterns({ jid, intent, minConfidence: 0.5 });
  const generalPatterns = learningRepo.getPatterns({ intent, minConfidence: 0.7 });

  // Merge and deduplicate, prioritizing contact-specific
  const seen = new Set();
  const merged = [];

  for (const p of contactPatterns) {
    seen.add(p.id);
    merged.push(p);
  }
  for (const p of generalPatterns) {
    if (!seen.has(p.id)) {
      merged.push(p);
    }
  }

  return merged.slice(0, 5); // Top 5
}

/**
 * Get learning stats.
 */
function getStats() {
  const all = learningRepo.listAll();
  const byIntent = {};
  for (const p of all) {
    byIntent[p.context_intent] = (byIntent[p.context_intent] || 0) + 1;
  }
  return {
    totalPatterns: all.length,
    byIntent,
    avgConfidence: all.length > 0
      ? (all.reduce((sum, p) => sum + p.confidence, 0) / all.length).toFixed(2)
      : 0,
  };
}

module.exports = {
  learnFromOwner,
  getRelevantPatterns,
  getStats,
};
