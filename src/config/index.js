'use strict';

/**
 * Centralized configuration loader.
 * Reads .env, validates required keys via zod, exports a frozen config object.
 */

require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // WhatsApp
  LIB: z.enum(['webjs', 'baileys']).default('baileys'),
  WEBJS_HEADLESS: z.string().default('true'),
  OWNER_JID: z.string().min(1, 'OWNER_JID is required (e.g., 977xxxxxxxxxx@c.us)'),

  // Gemini AI (legacy, now using Groq)
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEYS: z.string().optional().default(''),
  GEMINI_MODEL: z.string().optional().default('gemini-1.5-flash-latest'),
  GEMINI_MAX_TOKENS: z.coerce.number().int().positive().optional().default(1024),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).optional().default(0.7),

  // Groq AI
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  GROQ_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),

  // Database
  DB_PATH: z.string().default('./data/whatsapp-bot.db'),

  // Safety
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  LOOP_DETECT_THRESHOLD: z.coerce.number().int().positive().default(3),
  OLD_MESSAGE_THRESHOLD_SEC: z.coerce.number().int().positive().default(60),
  HALT_DURATION_MS: z.coerce.number().int().positive().default(600000),

  // Summaries
  SUMMARY_INTERVAL_HOURS: z.coerce.number().positive().default(4),
  SUMMARY_VOICE_ENABLED: z.string().default('false'),

  // TTS
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().default(''),
  TTS_LANGUAGE: z.string().default('en-US'),
  TTS_VOICE: z.string().default('en-US-Neural2-D'),

  // n8n
  N8N_WEBHOOK: z.string().optional().default(''),

  // Translation
  DEFAULT_LANGUAGE: z.string().default('en'),
  AUTO_TRANSLATE: z.string().default('true'),

  // Server
  PORT: z.coerce.number().int().positive().default(3009),

  // Persona
  BOT_NAME: z.string().default('Friday'),
  OWNER_NAME: z.string().default('Bhuwan'),
});

let parsed;
try {
  parsed = envSchema.parse(process.env);
} catch (err) {
  console.error('❌ Configuration validation failed:');
  if (err.issues) {
    err.issues.forEach(issue => {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    });
  }
  process.exit(1);
}

const config = Object.freeze({
  app: {
    env: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.PORT,
  },
  whatsapp: {
    lib: parsed.LIB,
    headless: parsed.WEBJS_HEADLESS.toLowerCase() === 'true',
    ownerJid: parsed.OWNER_JID,
  },
  gemini: {
    apiKey: parsed.GEMINI_API_KEY,
    apiKeys: (parsed.GEMINI_API_KEYS || parsed.GEMINI_API_KEY).split(',').map(k => k.trim()).filter(Boolean),
    model: parsed.GEMINI_MODEL,
    maxTokens: parsed.GEMINI_MAX_TOKENS,
    temperature: parsed.GEMINI_TEMPERATURE,
  },
  groq: {
    apiKey: parsed.GROQ_API_KEY,
    model: parsed.GROQ_MODEL,
    maxTokens: parsed.GROQ_MAX_TOKENS,
    temperature: parsed.GROQ_TEMPERATURE,
  },
  database: {
    path: parsed.DB_PATH,
  },
  safety: {
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    loopDetectThreshold: parsed.LOOP_DETECT_THRESHOLD,
    oldMessageThresholdSec: parsed.OLD_MESSAGE_THRESHOLD_SEC,
    haltDurationMs: parsed.HALT_DURATION_MS,
  },
  summary: {
    intervalHours: parsed.SUMMARY_INTERVAL_HOURS,
    voiceEnabled: parsed.SUMMARY_VOICE_ENABLED.toLowerCase() === 'true',
  },
  tts: {
    credentialsPath: parsed.GOOGLE_APPLICATION_CREDENTIALS,
    language: parsed.TTS_LANGUAGE,
    voice: parsed.TTS_VOICE,
  },
  n8n: {
    webhookUrl: parsed.N8N_WEBHOOK,
  },
  translation: {
    defaultLanguage: parsed.DEFAULT_LANGUAGE,
    autoTranslate: parsed.AUTO_TRANSLATE.toLowerCase() === 'true',
  },
  persona: {
    botName: parsed.BOT_NAME,
    ownerName: parsed.OWNER_NAME,
  },
});

module.exports = config;
