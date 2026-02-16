'use strict';

/**
 * Schedule Assistant — handles scheduling requests detected by intent.
 * Parses natural language dates, creates schedule entries, sends reminders.
 */

const logger = require('../core/logger');
const gemini = require('../ai/gemini-client');
const schedulesRepo = require('../database/repositories/schedules.repo');
const config = require('../config');

const PARSE_PROMPT = `Extract scheduling information from this message. Return JSON:
{"title": "<event title>", "date": "<ISO 8601 datetime>", "remindBefore": "<minutes before to remind, default 30>", "recurrence": "<none|daily|weekly|monthly>"}
If the message is not about scheduling, return: {"isSchedule": false}

Current date/time: `;

/**
 * Handle a scheduling request.
 * @param {string} jid - Contact JID
 * @param {string} text - User's message
 * @param {object} contact - Contact profile
 * @returns {Promise<string>} Confirmation message
 */
async function handleScheduleRequest(jid, text, contact) {
  try {
    const now = new Date().toISOString();
    const prompt = PARSE_PROMPT + now + `\n\nMessage: "${text}"`;
    const raw = await gemini.generate(prompt, { temperature: 0.1, maxTokens: 150 });

    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);

    if (result.isSchedule === false) {
      return `I'm not sure what you'd like to schedule. Could you rephrase? For example: "Remind me about the meeting tomorrow at 3pm"`;
    }

    // Use SQLite-compatible format (no T, no Z) so datetime('now') comparisons work
    const rawEventAt = result.date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const eventAt = new Date(rawEventAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const remindMinutes = result.remindBefore || 30;
    const remindAt = new Date(new Date(rawEventAt).getTime() - remindMinutes * 60 * 1000)
      .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    const id = schedulesRepo.create({
      jid,
      title: result.title || text.substring(0, 100),
      description: text,
      event_at: eventAt,
      remind_at: remindAt,
      recurrence: result.recurrence || 'none',
    });

    const eventDate = new Date(eventAt);
    const formatted = eventDate.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    logger.info({ jid, id, title: result.title, eventAt }, 'Schedule created');
    return `Got it! I've scheduled "${result.title}" for ${formatted}. I'll remind ${config.persona.ownerName} ${remindMinutes} minutes before. 📅`;
  } catch (err) {
    logger.error({ err }, 'Schedule parsing failed');
    return `I had trouble understanding that scheduling request. Could you try again with a specific date and time?`;
  }
}

/**
 * Get upcoming schedules for owner briefing.
 */
function listUpcoming(hours = 24) {
  return schedulesRepo.listUpcoming(hours);
}

/**
 * Get schedules that need reminders sent now.
 */
function getDueReminders() {
  return schedulesRepo.listDueReminders();
}

/**
 * Complete a schedule.
 */
function complete(id) {
  return schedulesRepo.complete(id);
}

/**
 * Cancel a schedule.
 */
function cancel(id) {
  return schedulesRepo.cancel(id);
}

/**
 * Snooze a schedule.
 */
function snooze(id, minutes = 15) {
  return schedulesRepo.snooze(id, minutes);
}

module.exports = {
  handleScheduleRequest,
  listUpcoming,
  getDueReminders,
  complete,
  cancel,
  snooze,
};
