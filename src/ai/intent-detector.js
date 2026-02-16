'use strict';

/**
 * Intent Detector — classifies inbound messages by intent using Gemini.
 * Returns structured intent + confidence for routing.
 */

const gemini = require('./gemini-client');
const logger = require('../core/logger');

const INTENT_LABELS = [
  'general', 'question', 'schedule', 'followup', 'urgent',
  'knowledge', 'command', 'media', 'greeting', 'farewell',
  'gratitude', 'complaint',
];

const MOOD_LABELS = [
  'happy', 'sad', 'angry', 'anxious', 'excited',
  'frustrated', 'neutral', 'confused', 'grateful', 'urgent',
];

const ANALYZE_PROMPT = `Analyze this WhatsApp message and provide a structured JSON response.
1. intent: ONE from [${INTENT_LABELS.join(', ')}]
2. confidence: 0.0 to 1.0
3. mood: ONE from [${MOOD_LABELS.join(', ')}]
4. moodIntensity: 0.0 to 1.0
5. language: 2-letter code (e.g. en, ne, hi)

Return ONLY a single valid JSON object. No markdown, no backticks.
Schema: {"intent": "...", "confidence": 0.5, "mood": "...", "moodIntensity": 0.5, "language": "..."}

Message: `;

/**
 * Detect both intent and mood in a single AI call to save quota.
 * @param {string} text - The message text
 * @returns {Promise<{intent: string, confidence: number, mood: string, moodIntensity: number, language: string}>}
 */
async function analyze(text) {
  if (!text || text.trim().length === 0) {
    return { intent: 'general', confidence: 1.0, mood: 'neutral', moodIntensity: 0.0, language: 'en' };
  }

  // Fast-path: command detection
  if (text.startsWith('!') || text.startsWith('/')) {
    return { intent: 'command', confidence: 1.0, mood: 'neutral', moodIntensity: 0.0, language: 'en' };
  }

  // Fast-path: simple greetings
  const lower = text.toLowerCase().trim();
  const greetingRegex = /^(hi+|hello+|hey+|namaste+|yo+|sup+|hola+|gm|gn|good\s*(morning|night|evening))$/i;
  const shortRegex = /^(ok|okay|yes|no|thanks|thank\s*you|fine|good|working|wow|nice|cool)$/i;

  if (greetingRegex.test(lower) || shortRegex.test(lower)) {
    return { 
      intent: greetingRegex.test(lower) ? 'greeting' : 'general', 
      confidence: 0.95, 
      mood: 'happy', 
      moodIntensity: 0.5, 
      language: detectSimpleLanguage(lower) 
    };
  }

  try {
    const raw = await gemini.generate(ANALYZE_PROMPT + `"${text}"`, {
      temperature: 0.1,
      maxTokens: 100,
    });

    logger.debug({ raw, text }, 'Raw AI analysis response');

    // Parse JSON from response
    let jsonStr = raw.trim();
    
    // Extract everything between first { and last }
    const firstBrace = jsonStr.indexOf('{');
    let lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1 && lastBrace <= firstBrace) {
      // Truncated JSON — attempt repair
      jsonStr = _repairTruncatedJson(jsonStr.substring(firstBrace));
    }

    try {
      const result = JSON.parse(jsonStr);
      const analysis = {
        intent: INTENT_LABELS.includes(result.intent) ? result.intent : 'general',
        confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5,
        mood: MOOD_LABELS.includes(result.mood) ? result.mood : 'neutral',
        moodIntensity: typeof result.moodIntensity === 'number' ? Math.min(1, Math.max(0, result.moodIntensity)) : 0.5,
        language: result.language || 'en'
      };
      
      logger.info({ intent: analysis.intent, confidence: analysis.confidence, mood: analysis.mood }, 'Message analysis complete');
      return analysis;
    } catch (parseErr) {
      // Attempt to extract partial fields from the broken JSON
      const partial = _extractPartialFields(jsonStr);
      if (partial) {
        logger.warn({ jsonStr, text: text.substring(0, 50) }, 'Recovered partial analysis from truncated JSON');
        return partial;
      }
      logger.warn({ jsonStr, err: parseErr.message, text: text.substring(0, 50) }, 'Failed to parse analysis JSON');
      throw parseErr;
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'AI analysis failed, using defaults');
    return { intent: 'general', confidence: 0.3, mood: 'neutral', moodIntensity: 0.3, language: 'en' };
  }
}

/**
 * Legacy detect method for backward compatibility.
 */
async function detect(text) {
  const result = await analyze(text);
  return { intent: result.intent, confidence: result.confidence, language: result.language };
}

/**
 * Simple language hint for greetings (no AI call needed).
 */
function detectSimpleLanguage(text) {
  if (['namaste'].includes(text)) return 'ne';
  return 'en';
}

/**
 * Attempt to repair a truncated JSON string by closing open strings/braces.
 */
function _repairTruncatedJson(jsonStr) {
  let repaired = jsonStr;
  // Count quotes — if odd, close the open string
  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }
  // Close any open braces
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }
  return repaired;
}

/**
 * Extract partial fields from a broken/truncated JSON string using regex.
 * Returns a valid analysis object if at least intent was found.
 */
function _extractPartialFields(jsonStr) {
  const intentMatch = jsonStr.match(/"intent"\s*:\s*"([^"]+)"/i);
  if (!intentMatch) return null;

  const intent = INTENT_LABELS.includes(intentMatch[1]) ? intentMatch[1] : 'general';

  const confMatch = jsonStr.match(/"confidence"\s*:\s*(\d+\.?\d*)/i);
  const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5;

  const moodMatch = jsonStr.match(/"mood"\s*:\s*"([^"]+)"/i);
  const mood = moodMatch && MOOD_LABELS.includes(moodMatch[1]) ? moodMatch[1] : 'neutral';

  const intensityMatch = jsonStr.match(/"moodIntensity"\s*:\s*(\d+\.?\d*)/i);
  const moodIntensity = intensityMatch ? Math.min(1, Math.max(0, parseFloat(intensityMatch[1]))) : 0.5;

  const langMatch = jsonStr.match(/"language"\s*:\s*"([^"]+)"/i);
  const language = langMatch ? langMatch[1] : 'en';

  return { intent, confidence, mood, moodIntensity, language };
}

module.exports = {
  detect,
  analyze,
  INTENT_LABELS,
  MOOD_LABELS,
};
