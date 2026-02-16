'use strict';

/**
 * Owner Summary — generates periodic briefings for the bot owner.
 * Summarizes conversations, follow-ups, schedules, and mood alerts.
 */

const logger = require('../core/logger');
const config = require('../config');
const gemini = require('../ai/gemini-client');
const promptBuilder = require('../ai/prompt-builder');
const messagesRepo = require('../database/repositories/messages.repo');
const followUpTracker = require('./follow-up-tracker');
const scheduleAssistant = require('./schedule-assistant');
const db = require('../database/connection');
const { nanoid } = require('nanoid');

/**
 * Generate and store a summary for the owner.
 * @param {number} [hours] - Hours to look back (default from config)
 * @returns {Promise<string>} Summary text
 */
async function generateSummary(hours) {
  const lookback = hours || config.summary.intervalHours;

  try {
    // Get recent messages across all contacts
    const recentMessages = messagesRepo.getRecentGlobal(200);

    // Filter to the lookback window
    // SQLite stores dates as 'YYYY-MM-DD HH:MM:SS' (no T, no Z)
    const cutoffDate = new Date(Date.now() - lookback * 60 * 60 * 1000);
    const cutoff = cutoffDate.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const inWindow = recentMessages.filter((m) => m.created_at >= cutoff);

    if (inWindow.length === 0) {
      return 'No new messages in the last period. All quiet! 🤫';
    }

    // Build summary prompt
    const summaryPrompt = promptBuilder.buildSummaryPrompt(inWindow);

    // Get pending follow-ups
    const pendingFollowUps = followUpTracker.listPending();
    const overdueFollowUps = followUpTracker.listOverdue();

    // Get upcoming schedules
    const upcoming = scheduleAssistant.listUpcoming(48);

    // Enrich prompt with follow-ups and schedules
    let fullPrompt = summaryPrompt;

    if (pendingFollowUps.length > 0) {
      fullPrompt += `\n\nPending follow-ups:\n${pendingFollowUps.map((f) => `- ${f.display_name || f.jid}: ${f.description} (due: ${f.due_at})`).join('\n')}`;
    }

    if (overdueFollowUps.length > 0) {
      fullPrompt += `\n\n⚠️ OVERDUE follow-ups:\n${overdueFollowUps.map((f) => `- ${f.display_name || f.jid}: ${f.description}`).join('\n')}`;
    }

    if (upcoming.length > 0) {
      fullPrompt += `\n\nUpcoming schedules:\n${upcoming.map((s) => `- ${s.title} at ${s.event_at}`).join('\n')}`;
    }

    const summary = await gemini.generate(fullPrompt, {
      temperature: 0.3,
      maxTokens: 500,
    });

    // Store in database
    _storeSummary(summary, cutoff, new Date().toISOString(), {
      messageCount: inWindow.length,
      pendingFollowUps: pendingFollowUps.length,
      overdueFollowUps: overdueFollowUps.length,
      upcomingSchedules: upcoming.length,
    });

    logger.info({ messageCount: inWindow.length, hours: lookback }, 'Owner summary generated');
    return summary;
  } catch (err) {
    logger.error({ err }, 'Failed to generate owner summary');
    return `Summary generation failed: ${err.message}`;
  }
}

/**
 * Store summary in database.
 */
function _storeSummary(text, periodStart, periodEnd, priorityItems) {
  try {
    const database = db.getDb();
    database.prepare(`
      INSERT INTO owner_summaries (id, summary_text, period_start, period_end, priority_items)
      VALUES (?, ?, ?, ?, ?)
    `).run(nanoid(), text, periodStart, periodEnd, JSON.stringify(priorityItems));
  } catch (err) {
    logger.debug({ err }, 'Failed to store summary (non-critical)');
  }
}

/**
 * Get the latest summary.
 */
function getLatest() {
  try {
    const database = db.getDb();
    return database.prepare(
      `SELECT * FROM owner_summaries ORDER BY created_at DESC LIMIT 1`
    ).get() || null;
  } catch {
    return null;
  }
}

/**
 * Mark a summary as delivered (sent to owner).
 */
function markDelivered(id) {
  try {
    const database = db.getDb();
    database.prepare(`UPDATE owner_summaries SET delivered = 1 WHERE id = ?`).run(id);
  } catch (err) {
    logger.debug({ err }, 'Failed to mark summary delivered');
  }
}

module.exports = {
  generateSummary,
  getLatest,
  markDelivered,
};
