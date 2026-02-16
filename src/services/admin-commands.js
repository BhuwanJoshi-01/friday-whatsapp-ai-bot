'use strict';

/**
 * Admin Commands — handles owner commands (messages starting with ! or /).
 * Dispatches to appropriate services.
 */

const bus = require('../core/event-bus');
const logger = require('../core/logger');
const config = require('../config');
const transport = require('../transport/transport-manager');
const contactManager = require('./contact-manager');
const followUpTracker = require('./follow-up-tracker');
const scheduleAssistant = require('./schedule-assistant');
const knowledgeBase = require('./knowledge-base');
const learningEngine = require('./learning-engine');
const offlineAssistant = require('./offline-assistant');
const chatSession = require('../ai/chat-session');
const loopDetector = require('../safety/loop-detector');
const rateLimiter = require('../safety/rate-limiter');

const HELP_TEXT = `*${config.persona.botName} Admin Commands*

!status — Bot status + stats
!help — This help menu
!vip <jid> <tier> — Set VIP tier (0-3)
!disable <jid> — Disable auto-reply for contact
!enable <jid> — Enable auto-reply for contact
!followups — List pending follow-ups
!schedules — Upcoming schedules
!kb add <category> | <question> | <answer> — Add KB entry
!kb search <query> — Search KB
!learning — Learning stats
!reset <jid> — Reset chat session
!unhalt <jid> — Clear loop halt
!resume <jid> — Force-resume auto-reply
!contacts — List active contacts
!summary — Generate owner summary now`;

/**
 * Initialize — listen for command events.
 */
function init() {
  bus.on('intent:command', handleCommand);
  logger.info('Admin commands initialized');
}

/**
 * Handle a command message.
 */
async function handleCommand(msg) {
  try {
    logger.debug({ jid: msg.jid, text: msg.text, isFromMe: msg.isFromMe }, 'Processing admin command');
    
    // Only owner can run commands
    const ownerJid = config.whatsapp.ownerJid;
    // Check both @c.us and @s.whatsapp.net formats
    const isOwner = msg.jid === ownerJid
      || msg.jid === ownerJid.replace('@c.us', '@s.whatsapp.net')
      || msg.isFromMe;

    logger.debug({ ownerJid, msgJid: msg.jid, isFromMe: msg.isFromMe, isOwner }, 'Owner check result');

    if (!isOwner) {
      logger.debug({ jid: msg.jid }, 'Non-owner tried to run command');
      return;
    }

    const text = msg.text.trim();
    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase().replace(/^[!/]/, '');
    const argStr = args.join(' ');

    let reply;

    switch (command) {
      case 'help':
        reply = HELP_TEXT;
        break;

      case 'status':
        reply = _buildStatus();
        break;

      case 'vip':
        reply = _handleVip(args);
        break;

      case 'disable':
        if (args[0]) {
          contactManager.toggleAutoReply(args[0], false);
          reply = `Auto-reply disabled for ${args[0]}`;
        } else {
          reply = 'Usage: !disable <jid>';
        }
        break;

      case 'enable':
        if (args[0]) {
          contactManager.toggleAutoReply(args[0], true);
          reply = `Auto-reply enabled for ${args[0]}`;
        } else {
          reply = 'Usage: !enable <jid>';
        }
        break;

      case 'followups':
        reply = _formatFollowUps();
        break;

      case 'schedules':
        reply = _formatSchedules();
        break;

      case 'kb':
        reply = _handleKb(args);
        break;

      case 'learning':
        reply = _formatLearning();
        break;

      case 'reset':
        if (args[0]) {
          chatSession.reset(args[0]);
          reply = `Chat session reset for ${args[0]}`;
        } else {
          chatSession.resetAll();
          reply = 'All chat sessions reset';
        }
        break;

      case 'unhalt':
        if (args[0]) {
          loopDetector.clearHalt(args[0]);
          reply = `Loop halt cleared for ${args[0]}`;
        } else {
          reply = 'Usage: !unhalt <jid>';
        }
        break;

      case 'resume':
        if (args[0]) {
          offlineAssistant.forceResume(args[0]);
          reply = `Auto-reply force-resumed for ${args[0]}`;
        } else {
          reply = 'Usage: !resume <jid>';
        }
        break;

      case 'contacts':
        reply = _formatContacts();
        break;

      case 'summary': {
        const ownerSummary = require('./owner-summary');
        reply = await ownerSummary.generateSummary();

        // Also send voice note if enabled
        if (config.summary.voiceEnabled) {
          try {
            const voiceSummary = require('./voice-summary');
            const audio = await voiceSummary.generateVoiceNote(reply);
            if (audio) {
              await transport.sendMessage(msg.jid, reply);
              await transport.sendMedia(msg.jid, audio, {
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
              });
              reply = null; // Already sent text + voice
            }
          } catch (voiceErr) {
            logger.debug({ err: voiceErr.message }, 'Voice summary failed for !summary command');
          }
        }
        break;
      }

      default:
        reply = `Unknown command: ${command}\nType !help for available commands.`;
    }

    if (reply) {
      await transport.sendMessage(msg.jid, reply);
    }
  } catch (err) {
    logger.error({ err }, 'Admin command error');
    try {
      await transport.sendMessage(msg.jid, `Command failed: ${err.message}`);
    } catch { /* ignore */ }
  }
}

function _buildStatus() {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  const sessions = chatSession.size;

  return `*${config.persona.botName} Status*
⏱ Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
💾 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB
🔌 Transport: ${transport.getLib()} (${transport.isReady() ? 'connected' : 'disconnected'})
💬 Active sessions: ${sessions}
📚 Learning: ${learningEngine.getStats().totalPatterns} patterns`;
}

function _handleVip(args) {
  if (args.length < 2) return 'Usage: !vip <jid> <tier (0-3)>';
  const [jid, tierStr] = args;
  const tier = parseInt(tierStr, 10);
  if (isNaN(tier) || tier < 0 || tier > 3) return 'Tier must be 0-3';
  contactManager.setVip(jid, tier);
  return `VIP tier set to ${tier} for ${jid}`;
}

function _formatFollowUps() {
  const pending = followUpTracker.listPending();
  if (pending.length === 0) return 'No pending follow-ups. ✅';
  return '*Pending Follow-ups:*\n' + pending.map((f) =>
    `• ${f.display_name || f.jid}: ${f.description} (due: ${f.due_at})`
  ).join('\n');
}

function _formatSchedules() {
  const upcoming = scheduleAssistant.listUpcoming(72);
  if (upcoming.length === 0) return 'No upcoming schedules. 📭';
  return '*Upcoming Schedules:*\n' + upcoming.map((s) =>
    `• ${s.title} — ${s.event_at}`
  ).join('\n');
}

function _handleKb(args) {
  if (args.length === 0) return 'Usage: !kb add <cat>|<q>|<a> or !kb search <query>';
  const [subCmd, ...rest] = args;

  if (subCmd === 'add') {
    const parts = rest.join(' ').split('|').map((s) => s.trim());
    if (parts.length < 3) return 'Usage: !kb add <category> | <question> | <answer>';
    const id = knowledgeBase.add({
      category: parts[0],
      question: parts[1],
      answer: parts[2],
      topic: parts[1].substring(0, 50),
    });
    return `KB entry added (ID: ${id})`;
  }

  if (subCmd === 'search') {
    const query = rest.join(' ');
    const results = knowledgeBase.search(query);
    if (results.length === 0) return 'No KB matches found.';
    return '*KB Results:*\n' + results.slice(0, 5).map((k) =>
      `• [${k.category}] ${k.question}\n  → ${k.answer}`
    ).join('\n\n');
  }

  return 'Unknown KB subcommand. Use: add, search';
}

function _formatLearning() {
  const stats = learningEngine.getStats();
  let text = `*Learning Stats*\n📊 Total patterns: ${stats.totalPatterns}\n📈 Avg confidence: ${stats.avgConfidence}`;
  if (Object.keys(stats.byIntent).length > 0) {
    text += '\n\nBy intent:';
    for (const [intent, count] of Object.entries(stats.byIntent)) {
      text += `\n• ${intent}: ${count}`;
    }
  }
  return text;
}

function _formatContacts() {
  const active = contactManager.listActive(24);
  if (active.length === 0) return 'No active contacts in the last 24h.';
  return '*Active Contacts (24h):*\n' + active.slice(0, 20).map((c) =>
    `• ${c.display_name || c.jid} ${c.vip_tier > 0 ? '⭐'.repeat(c.vip_tier) : ''}`
  ).join('\n');
}

module.exports = { init, handleCommand };
