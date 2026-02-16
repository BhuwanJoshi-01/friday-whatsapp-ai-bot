'use strict';

/**
 * Mood Detector — analyzes sentiment and emotional tone of messages
 * using Gemini. Used for adaptive responses and VIP alerting.
 */

const gemini = require('./gemini-client');
const logger = require('../core/logger');

const MOOD_LABELS = [
  'happy', 'sad', 'angry', 'anxious', 'excited',
  'frustrated', 'neutral', 'confused', 'grateful', 'urgent',
];

const MOOD_PROMPT = `Analyze the emotional tone of this WhatsApp message. Choose ONE mood from: ${MOOD_LABELS.join(', ')}.
Rate intensity from 0.0 (barely noticeable) to 1.0 (very strong).
Respond ONLY with valid JSON: {"mood": "<mood>", "intensity": <number>}

Message: `;

/**
 * Detect mood of a message.
 * @param {string} text
 * @returns {Promise<{mood: string, intensity: number}>}
 */
async function detect(text) {
  if (!text || text.trim().length < 3) {
    return { mood: 'neutral', intensity: 0.5 };
  }

  try {
    const raw = await gemini.generate(MOOD_PROMPT + `"${text}"`, {
      temperature: 0.1,
      maxTokens: 60,
    });

    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);

    const mood = MOOD_LABELS.includes(result.mood) ? result.mood : 'neutral';
    const intensity = typeof result.intensity === 'number'
      ? Math.min(1, Math.max(0, result.intensity))
      : 0.5;

    return { mood, intensity };
  } catch (err) {
    logger.debug({ err: err.message }, 'Mood detection failed, defaulting to neutral');
    return { mood: 'neutral', intensity: 0.5 };
  }
}

/**
 * Check if mood indicates something that needs owner attention.
 */
function isAlertWorthy(mood, intensity) {
  const alertMoods = ['angry', 'frustrated', 'urgent', 'sad', 'anxious'];
  return alertMoods.includes(mood) && intensity >= 0.7;
}

module.exports = {
  detect,
  isAlertWorthy,
  MOOD_LABELS,
};
