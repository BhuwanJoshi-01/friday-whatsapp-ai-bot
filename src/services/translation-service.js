'use strict';

/**
 * Translation Service — detects language and translates messages
 * using Gemini for high-quality contextual translation.
 */

const config = require('../config');
const logger = require('../core/logger');
const gemini = require('../ai/gemini-client');

/**
 * Detect the language of a message.
 * This is typically already done by intent-detector; use that result when available.
 * @param {string} text
 * @returns {Promise<string>} Language code (e.g., 'en', 'ne', 'hi')
 */
async function detectLanguage(text) {
  if (!text || text.length < 3) return config.translation.defaultLanguage;

  try {
    const raw = await gemini.generate(
      `Detect the language of this text. Respond with ONLY the ISO 639-1 code (e.g., en, ne, hi, es, fr).\n\nText: "${text}"`,
      { temperature: 0, maxTokens: 5 }
    );
    return raw.trim().toLowerCase().substring(0, 5);
  } catch {
    return config.translation.defaultLanguage;
  }
}

/**
 * Translate text from one language to another.
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @param {string} [sourceLang] - Source language code (auto-detected if not provided)
 * @returns {Promise<string>} Translated text
 */
async function translate(text, targetLang, sourceLang) {
  if (!config.translation.autoTranslate) return text;
  if (!text || text.trim().length === 0) return text;

  const source = sourceLang || await detectLanguage(text);
  if (source === targetLang) return text; // No translation needed

  try {
    const prompt = `Translate the following text from ${source} to ${targetLang}. Keep the tone and style. Return ONLY the translation, nothing else.\n\nText: "${text}"`;
    const translated = await gemini.generate(prompt, { temperature: 0.2, maxTokens: 300 });
    return translated;
  } catch (err) {
    logger.warn({ err: err.message, source, target: targetLang }, 'Translation failed');
    return text;
  }
}

/**
 * Auto-translate a message if the contact has a different preferred language.
 * @param {string} text - Bot's reply in default language
 * @param {object} contact - Contact profile with preferred_language
 * @returns {Promise<string>} Translated text (or original if same language)
 */
async function autoTranslateReply(text, contact) {
  if (!config.translation.autoTranslate) return text;
  if (!contact || !contact.preferred_language) return text;
  if (contact.preferred_language === config.translation.defaultLanguage) return text;

  return translate(text, contact.preferred_language, config.translation.defaultLanguage);
}

module.exports = {
  detectLanguage,
  translate,
  autoTranslateReply,
};
