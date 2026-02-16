'use strict';

/**
 * Follow-Up Tracker — detects promises in AI replies,
 * creates follow-up entries, and sends reminders when overdue.
 */

const logger = require('../core/logger');
const gemini = require('../ai/gemini-client');
const promptBuilder = require('../ai/prompt-builder');
const followUpsRepo = require('../database/repositories/follow-ups.repo');

/**
 * Analyze an AI reply for follow-up promises.
 * Called after every outbound auto-reply.
 */
async function analyzeReply(jid, aiReply) {
  try {
    const prompt = promptBuilder.buildFollowUpDetectionPrompt(aiReply);
    const raw = await gemini.generate(prompt, { temperature: 0.1, maxTokens: 100 });

    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);

    if (result.hasFollowUp) {
      const dueHours = result.dueHours || 24;
      // Use SQLite-compatible format (no T, no Z) so datetime('now') comparisons work
      const dueAt = new Date(Date.now() + dueHours * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      const id = followUpsRepo.create({
        jid,
        description: result.description || 'Follow up on conversation',
        due_at: dueAt,
        priority: result.priority || 2,
      });

      logger.info({ jid, id, description: result.description, dueAt }, 'Follow-up created');
      return id;
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Follow-up analysis failed (non-critical)');
  }
  return null;
}

/**
 * Get pending follow-ups for a contact or all contacts.
 */
function listPending(jid) {
  return followUpsRepo.listPending(jid);
}

/**
 * Get overdue follow-ups (past due date and not resolved).
 */
function listOverdue() {
  return followUpsRepo.listOverdue();
}

/**
 * Mark a follow-up as resolved.
 */
function resolve(id) {
  return followUpsRepo.resolve(id);
}

/**
 * Check for overdue follow-ups and return reminders.
 * Called periodically by the scheduler.
 * @returns {Array<{jid: string, description: string, due_at: string}>}
 */
function getReminders() {
  const overdue = followUpsRepo.listOverdue();
  const reminders = [];

  for (const fu of overdue) {
    // Only remind if not already reminded recently (< 3 times)
    if (fu.reminded_count < 3) {
      followUpsRepo.markReminded(fu.id);
      reminders.push({
        jid: fu.jid,
        description: fu.description,
        due_at: fu.due_at,
        display_name: fu.display_name,
        priority: fu.priority,
      });
    } else {
      // Auto-expire after too many reminders
      followUpsRepo.expire(fu.id);
    }
  }

  return reminders;
}

module.exports = {
  analyzeReply,
  listPending,
  listOverdue,
  resolve,
  getReminders,
};
