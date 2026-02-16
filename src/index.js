'use strict';

/**
 * src/index.js — Boot orchestrator for the WhatsApp AI Personal Operator.
 *
 * Initialization order:
 * 1. Config (validates .env)
 * 2. Logger
 * 3. Lifecycle (shutdown hooks)
 * 4. Database (SQLite + migrations)
 * 5. Services init (contact manager, admin commands, message router)
 * 6. Transport (WhatsApp connection)
 * 7. HTTP API server
 * 8. Scheduled tasks (summaries, follow-ups, memory compression)
 */

const config = require('./config');
const logger = require('./core/logger');
const lifecycle = require('./core/lifecycle');
const bus = require('./core/event-bus');

async function boot() {
  logger.info({ env: config.app.env, lib: config.whatsapp.lib }, `Starting ${config.persona.botName}...`);

  // --- 1. Database ---
  const { getDb, closeDb } = require('./database/connection');
  const { runMigrations } = require('./database/migrations');
  const db = getDb();
  runMigrations(db);
  lifecycle.registerShutdown('database', closeDb);
  logger.info('Database initialized');

  // --- 2. Services ---
  const contactManager = require('./services/contact-manager');
  const adminCommands = require('./services/admin-commands');
  const messageRouter = require('./services/message-router');

  contactManager.init();
  adminCommands.init();
  messageRouter.init();
  logger.info('Services initialized');

  // --- 3. n8n webhook forwarder ---
  if (config.n8n.webhook) {
    bus.on('n8n:forward', async (data) => {
      try {
        const fetch = require('node-fetch');
        await fetch(config.n8n.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        logger.debug({ jid: data.jid }, 'Forwarded to n8n');
      } catch (err) {
        logger.warn({ err: err.message }, 'n8n forward failed');
      }
    });
    logger.info({ webhook: config.n8n.webhook }, 'n8n webhook forwarder active');
  }

  // --- 4. Transport ---
  const transport = require('./transport/transport-manager');
  lifecycle.registerShutdown('transport', transport.disconnect);

  try {
    await transport.connect();
  } catch (err) {
    logger.error({ err }, 'Transport connection failed');
    // Don't exit — HTTP API is still useful
  }

  // --- 5. HTTP API ---
  const server = require('./api/server');
  const httpServer = await server.start();
  lifecycle.registerShutdown('http', () => new Promise((resolve) => {
    httpServer.close(() => resolve());
  }));

  // --- 6. Scheduled tasks ---
  try {
    const { Cron } = require('croner');
    const memoryManager = require('./services/memory-manager');
    const ownerSummary = require('./services/owner-summary');
    const followUpTracker = require('./services/follow-up-tracker');
    const scheduleAssistant = require('./services/schedule-assistant');
    const voiceSummary = require('./services/voice-summary');

    // Owner summary — every N hours
    const summaryHours = config.summary.intervalHours;
    new Cron(`0 */${summaryHours} * * *`, async () => {
      try {
        logger.info('Running scheduled owner summary');
        const summary = await ownerSummary.generateSummary();
        const latest = ownerSummary.getLatest();

        // Send to owner via WhatsApp
        if (transport.isReady() && summary) {
          const ownerJid = config.whatsapp.ownerJid;
          await transport.sendMessage(ownerJid, `📋 *Periodic Summary*\n\n${summary}`);

          // Voice note if enabled
          if (config.summary.voiceEnabled) {
            const audio = await voiceSummary.generateVoiceNote(summary);
            if (audio) {
              await transport.sendMedia(ownerJid, audio, {
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
              });
            }
          }

          if (latest) ownerSummary.markDelivered(latest.id);
        }
      } catch (err) {
        logger.error({ err }, 'Scheduled summary failed');
      }
    });

    // Follow-up check — every 30 minutes
    new Cron('*/30 * * * *', async () => {
      try {
        const reminders = followUpTracker.getReminders();
        if (reminders.length > 0 && transport.isReady()) {
          const ownerJid = config.whatsapp.ownerJid;
          const text = '⏰ *Follow-up Reminders:*\n' + reminders.map((r) =>
            `• ${r.display_name || r.jid}: ${r.description}`
          ).join('\n');
          await transport.sendMessage(ownerJid, text);
        }
      } catch (err) {
        logger.error({ err }, 'Follow-up check failed');
      }
    });

    // Schedule reminders — every 5 minutes
    new Cron('*/5 * * * *', async () => {
      try {
        const due = scheduleAssistant.getDueReminders();
        if (due.length > 0 && transport.isReady()) {
          const ownerJid = config.whatsapp.ownerJid;
          for (const s of due) {
            await transport.sendMessage(ownerJid, `🔔 Reminder: *${s.title}* at ${s.event_at}`);
          }
        }
      } catch (err) {
        logger.error({ err }, 'Schedule reminder failed');
      }
    });

    // Memory compression — daily at 3 AM
    new Cron('0 3 * * *', async () => {
      try {
        logger.info('Running scheduled memory compression');
        await memoryManager.compressAll();
        memoryManager.pruneSummaries();
      } catch (err) {
        logger.error({ err }, 'Memory compression failed');
      }
    });

    logger.info('Scheduled tasks registered');
  } catch (err) {
    logger.warn({ err: err.message }, 'croner not available — scheduled tasks disabled');
  }

  // --- 7. Mood alerts → owner ---
  bus.on('alert:mood', async ({ jid, mood, intensity, text }) => {
    try {
      if (transport.isReady()) {
        const ownerJid = config.whatsapp.ownerJid;
        await transport.sendMessage(ownerJid,
          `⚠️ *Mood Alert* from ${jid}\nMood: ${mood} (intensity: ${intensity.toFixed(1)})\nMessage: "${text.substring(0, 100)}"`
        );
      }
    } catch (err) {
      logger.debug({ err }, 'Mood alert send failed');
    }
  });

  logger.info(`${config.persona.botName} is ready! 🚀`);
}

// --- GO ---
boot().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
