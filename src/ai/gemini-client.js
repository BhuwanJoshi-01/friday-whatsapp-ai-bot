'use strict';

/**
 * Groq Client — thin wrapper around groq SDK.
 * Centralizes API key management, model selection, retry logic.
 */

const config = require('../config');
const logger = require('../core/logger');

let groqClient = null;
let groqAvailable = false;

function _ensureClient() {
  if (groqClient) return;

  try {
    const { Groq } = require('groq-sdk');
    groqClient = new Groq({
      apiKey: config.groq.apiKey,
    });
    groqAvailable = true;
    logger.info('Groq client initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Groq client');
    throw err;
  }
}

/**
 * Extract retry delay (in seconds) from a 429 error response.
 */
function _parseRetryDelay(err) {
  try {
    const msg = err.message || '';
    const match = msg.match(/retry\s*(?:in|Delay[":]*)\s*["']?(\d+(?:\.\d+)?)/i);
    if (match) return Math.ceil(parseFloat(match[1]));
  } catch { /* ignore */ }
  return 60; // default 60s
}

/**
 * Create a new chat session with system instruction baked in.
 * @param {string} systemInstruction - The persona/context prompt
 * @param {object} [opts] - Optional overrides { model, temperature, maxTokens }
 * @returns {object} Chat session
 */
function createChat(systemInstruction, opts = {}) {
  _ensureClient();

  const modelName = opts.model || config.groq.model;

  const chat = {
    model: modelName,
    systemInstruction,
    history: opts.history || [],
    temperature: opts.temperature ?? config.groq.temperature,
    maxTokens: opts.maxTokens ?? config.groq.maxTokens,
  };

  return chat;
}

/**
 * Send a message to a chat session and get the text reply.
 * Includes retry with exponential backoff.
 * @param {object} chat - Chat session from createChat()
 * @param {string} userMessage - The user's message text
 * @param {number} [maxRetries=2] - Number of retries on transient failure
 * @returns {Promise<string>} AI reply text
 */
async function sendMessage(chat, userMessage, maxRetries = 2) {
  _ensureClient();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Build messages array with system instruction and history
  const messages = [
    { role: 'system', content: chat.systemInstruction },
    ...chat.history,
    { role: 'user', content: userMessage }
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.debug({ userMessage: userMessage.substring(0, 100) }, 'Sending message to Groq');

      const completion = await groqClient.chat.completions.create({
        model: chat.model,
        messages: messages,
        temperature: chat.temperature,
        max_tokens: chat.maxTokens,
        stream: false, // For now, not streaming
      });

      const replyText = completion.choices[0].message.content.trim();

      // Update history
      chat.history.push({ role: 'user', content: userMessage });
      chat.history.push({ role: 'assistant', content: replyText });

      return {
        text: replyText,
        history: chat.history
      };
    } catch (err) {
      const status = err.status || (err.response ? err.response.status : null);

      if (status === 429) {
        const retryAfter = _parseRetryDelay(err);
        logger.warn({ retryAfter }, 'Groq API quota exceeded');
        throw new QuotaError('Groq API quota exceeded');
      }

      const isTransient = status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      if (isTransient && attempt < maxRetries) {
        const backoff = 1000 * Math.pow(2, attempt);
        logger.warn({ attempt, backoff, err: err.message }, 'Groq transient error, retrying');
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

/** Custom error class for quota exhaustion */
class QuotaError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'QuotaError';
    this.status = 429;
  }
}

/**
 * One-shot generate (no chat context).
 * @param {string} prompt - The prompt text
 * @param {object} [opts] - Optional overrides { model, temperature, maxTokens }
 * @returns {Promise<string>} Generated text
 */
async function generate(prompt, opts = {}) {
  _ensureClient();

  const modelName = opts.model || config.groq.model;

  try {
    const completion = await groqClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? config.groq.temperature,
      max_tokens: opts.maxTokens ?? config.groq.maxTokens,
    });

    return completion.choices[0].message.content.trim();
  } catch (err) {
    const status = err.status || (err.response ? err.response.status : null);
    if (status === 429) {
      throw new QuotaError('Groq API quota exceeded');
    }
    throw err;
  }
}

/**
 * List available Groq models.
 */
async function listModels() {
  _ensureClient();

  try {
    const models = await groqClient.models.list();
    return models.data.map(model => ({
      name: model.id,
      displayName: model.id,
      description: model.description || '',
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to list Groq models');
    return [];
  }
}

function isAvailable() {
  return groqAvailable;
}

function isQuotaExhausted() {
  // For Groq, we don't have a pool, so just check if client is available
  return !groqAvailable;
}

module.exports = {
  createChat,
  sendMessage,
  generate,
  listModels,
  isAvailable,
  isQuotaExhausted,
  QuotaError,
};
