'use strict';

/**
 * Prompt Builder — constructs dynamic system instructions and contextual prompts
 * personalized per contact (VIP tier, relationship, mood, language, learned patterns).
 */

const config = require('../config');

const BASE_PERSONA = `You are ${config.persona.botName}, ${config.persona.ownerName}'s personal assistant. You respond to WhatsApp messages sent to ${config.persona.ownerName}. Stay in character as ${config.persona.botName}. Respond casually and helpfully to the sender, under 50 words.

Never mention AI, Google, training, or technology.

Keep responses natural, witty, and concise.`;

/**
 * Build the full system instruction for a contact's chat session.
 * @param {object|null} contact - Contact profile from DB
 * @returns {string}
 */
function buildSystemPrompt(contact) {
  const parts = [BASE_PERSONA];

  if (contact) {
    // Relationship context
    if (contact.relationship_type && contact.relationship_type !== 'unknown') {
      parts.push(`The sender's relationship with ${config.persona.ownerName}: ${contact.relationship_type}.`);
    }

    // Display name
    if (contact.display_name) {
      parts.push(`The sender's name is ${contact.display_name}.`);
    }

    // VIP tier
    if (contact.vip_tier >= 2) {
      parts.push(`This is a VIP contact (tier ${contact.vip_tier}). Be extra attentive and prioritize their requests.`);
    }

    // Custom tone
    if (contact.custom_tone) {
      try {
        const tone = typeof contact.custom_tone === 'string' ? JSON.parse(contact.custom_tone) : contact.custom_tone;
        if (tone.style) parts.push(`Communication style preference: ${tone.style}.`);
        if (tone.formality) parts.push(`Formality level: ${tone.formality}.`);
      } catch { /* ignore parse errors */ }
    }

    // Language preference
    if (contact.preferred_language && contact.preferred_language !== config.translation.defaultLanguage) {
      parts.push(`Respond in ${contact.preferred_language} unless the sender writes in a different language.`);
    }

    // Last mood context
    if (contact.last_mood) {
      parts.push(`The sender's recent mood was: ${contact.last_mood}. Adjust your tone accordingly.`);
    }
  }

  return parts.join('\n');
}

/**
 * Build a contextual user prompt with enrichments.
 * This wraps the raw user message with any additional context (summaries, KB results, etc.)
 * so the AI has more to work with without polluting the system instruction.
 * @param {string} userMessage - Raw user message text
 * @param {object} [context] - Additional context
 * @param {string} [context.conversationSummary] - Compressed context from past conversations
 * @param {string[]} [context.knowledgeHits] - Relevant KB entries
 * @param {string[]} [context.learnedPatterns] - Owner's learned response patterns
 * @param {string} [context.pendingFollowUps] - Pending follow-up info
 * @returns {string}
 */
function buildUserPrompt(userMessage, context = {}) {
  const parts = [];

  if (context.conversationSummary) {
    parts.push(`[Previous conversation context: ${context.conversationSummary}]`);
  }

  if (context.knowledgeHits && context.knowledgeHits.length > 0) {
    parts.push(`[Relevant knowledge: ${context.knowledgeHits.join(' | ')}]`);
  }

  if (context.learnedPatterns && context.learnedPatterns.length > 0) {
    parts.push(`[${config.persona.ownerName}'s usual response style for this type of message: ${context.learnedPatterns.join('; ')}]`);
  }

  if (context.pendingFollowUps) {
    parts.push(`[You previously promised to follow up: ${context.pendingFollowUps}]`);
  }

  parts.push(userMessage);
  return parts.join('\n\n');
}

/**
 * Build a summary request prompt for the owner's daily/periodic briefing.
 * @param {object[]} recentMessages - Array of recent messages with contact info
 * @returns {string}
 */
function buildSummaryPrompt(recentMessages) {
  if (!recentMessages || recentMessages.length === 0) {
    return 'No new messages to summarize.';
  }

  const lines = recentMessages.map((m) => {
    const name = m.display_name || m.jid;
    const direction = m.direction === 'inbound' ? `${name} said` : `${config.persona.botName} replied`;
    return `- ${direction}: "${m.content}"`;
  });

  return `Summarize the following WhatsApp conversations for ${config.persona.ownerName}. Group by contact. Highlight anything that seems urgent or needs ${config.persona.ownerName}'s personal attention. Be concise.\n\n${lines.join('\n')}`;
}

/**
 * Build a follow-up detection prompt.
 * @param {string} aiReply - The AI's reply to analyze
 * @returns {string}
 */
function buildFollowUpDetectionPrompt(aiReply) {
  return `Analyze this message and determine if it contains a promise or commitment to follow up later. If yes, extract: what was promised, any deadline mentioned, and priority (1=low, 4=urgent). Respond in JSON format: {"hasFollowUp": boolean, "description": string, "dueHours": number, "priority": number}. If no follow-up, respond: {"hasFollowUp": false}\n\nMessage: "${aiReply}"`;
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
  buildSummaryPrompt,
  buildFollowUpDetectionPrompt,
  BASE_PERSONA,
};
