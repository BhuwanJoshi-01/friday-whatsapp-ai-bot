'use strict';

/**
 * Context Compressor — summarizes old conversation turns into a compact
 * summary to keep the AI context window manageable.
 * Works with SQLite conversation_summaries table.
 */

const gemini = require('./gemini-client');
const logger = require('../core/logger');

const COMPRESS_PROMPT = `Summarize this WhatsApp conversation between a user and a bot. Keep it under 150 words. Preserve: key topics discussed, any promises made, important facts mentioned, and the overall tone. This summary will be used as context for future conversations.

Conversation:
`;

/**
 * Compress a set of messages into a concise summary.
 * @param {Array<{direction: string, content: string, created_at: string}>} messages
 * @returns {Promise<string>} Summary text
 */
async function compress(messages) {
  if (!messages || messages.length === 0) {
    return '';
  }

  const lines = messages.map((m) => {
    const speaker = m.direction === 'inbound' ? 'User' : 'Bot';
    return `${speaker}: ${m.content}`;
  });

  try {
    const summary = await gemini.generate(COMPRESS_PROMPT + lines.join('\n'), {
      temperature: 0.2,
      maxTokens: 200,
    });
    return summary;
  } catch (err) {
    logger.warn({ err: err.message }, 'Context compression failed');
    // Fallback: return last few messages as-is
    return lines.slice(-5).join('\n');
  }
}

/**
 * Build a progressive summary by merging an old summary with new messages.
 * This avoids re-reading the full history every time.
 * @param {string} existingSummary - Previous compressed summary
 * @param {Array<{direction: string, content: string}>} newMessages
 * @returns {Promise<string>} Updated summary
 */
async function merge(existingSummary, newMessages) {
  if (!newMessages || newMessages.length === 0) {
    return existingSummary;
  }

  const newLines = newMessages.map((m) => {
    const speaker = m.direction === 'inbound' ? 'User' : 'Bot';
    return `${speaker}: ${m.content}`;
  });

  const mergePrompt = `Here is a summary of past conversations:\n"${existingSummary}"\n\nHere are new messages:\n${newLines.join('\n')}\n\nCreate an updated summary (under 150 words) that combines both. Preserve key facts, promises, and tone.`;

  try {
    return await gemini.generate(mergePrompt, { temperature: 0.2, maxTokens: 200 });
  } catch (err) {
    logger.warn({ err: err.message }, 'Summary merge failed');
    return existingSummary;
  }
}

module.exports = {
  compress,
  merge,
};
