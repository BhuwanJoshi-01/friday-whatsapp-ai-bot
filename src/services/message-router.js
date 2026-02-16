'use strict';

/**
 * Message Router — central orchestrator for inbound messages.
 * Runs the full pipeline: filter → enrich → detect → route → reply.
 * Listens to transport:message:raw and transport:message:owner events.
 */

const bus = require('../core/event-bus');
const logger = require('../core/logger');
const config = require('../config');
const transport = require('../transport/transport-manager');

// Safety
const messageFilter = require('../safety/message-filter');
const rateLimiter = require('../safety/rate-limiter');
const loopDetector = require('../safety/loop-detector');
const botDetector = require('../safety/bot-detector');

// AI
const chatSession = require('../ai/chat-session');
const intentDetector = require('../ai/intent-detector');
const moodDetector = require('../ai/mood-detector');
const promptBuilder = require('../ai/prompt-builder');
const geminiClient = require('../ai/gemini-client');

const FALLBACK_MESSAGES = [
  "Hey! I'm taking a short break right now. Bhuwan will get back to you soon! 😊",
  "Hi there! My brain is recharging at the moment. Bhuwan will reply shortly! ⚡",
  "Hey! I'm temporarily unavailable, but Bhuwan will catch up with you soon! 🙏",
];

// Repos
const contactsRepo = require('../database/repositories/contacts.repo');
const messagesRepo = require('../database/repositories/messages.repo');

// Services (lazy-loaded to avoid circular deps)
let contactManager, followUpTracker, scheduleAssistant, knowledgeBase, learningEngine, offlineAssistant;

function _loadServices() {
  if (contactManager) return;
  contactManager = require('./contact-manager');
  followUpTracker = require('./follow-up-tracker');
  scheduleAssistant = require('./schedule-assistant');
  knowledgeBase = require('./knowledge-base');
  learningEngine = require('./learning-engine');
  offlineAssistant = require('./offline-assistant');
}

/**
 * Initialize the router — wire up event listeners.
 */
function init() {
  _loadServices();

  bus.on('transport:message:raw', handleInbound);
  bus.on('transport:message:owner', handleOwnerMessage);
  bus.on('transport:message:owner:typing', (data) => {
    if (data.jid) offlineAssistant.recordTyping(data.jid);
  });

  _startResumeChecker();

  logger.info('Message router initialized');
  logger.debug('Message router event listeners set up');
}

/**
 * Periodically checks for conversations where the owner has stopped replying,
 * allowing the bot to resume auto-replies if the last message is still pending.
 */
function _startResumeChecker() {
  // Check every 30 seconds
  setInterval(async () => {
    try {
      const activityMap = offlineAssistant.getAllActivity();
      
      for (const jid of activityMap.keys()) {
        // If owner has been inactive for > 3 minutes (cooldown expired)
        if (!offlineAssistant.isOwnerActive(jid)) {
          // Get the very last message in this chat
          const latest = messagesRepo.getRecent(jid, 1);
          if (latest.length > 0) {
            const lastMsg = latest[0];

            // If the last message is from the user (inbound), bot should reply
            if (lastMsg.direction === 'inbound') {
              const contact = contactsRepo.getByJid(jid);
              if (contact && contact.auto_reply_enabled !== 0) {
                logger.info({ jid }, 'Auto-resuming conversation after 3 minutes of owner inactivity');
                
                // Construct a message object for the routing logic
                const pseudoMsg = {
                  jid,
                  text: lastMsg.content,
                  contentType: lastMsg.content_type || 'text',
                  pushName: contact.display_name
                };

                const intentResult = { intent: lastMsg.intent || 'general', confidence: 1.0 };
                const moodResult = { mood: lastMsg.mood || 'neutral', intensity: 1.0 };

                // Process the reply
                await _routeAndReply(pseudoMsg, contact, intentResult, moodResult);
              }
            }
          }
          // Remove from activity map so we don't check again until next owner activity
          activityMap.delete(jid);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in resume checker task');
    }
  }, 30000).unref();
}

/**
 * Handle an inbound message from a contact.
 */
async function handleInbound(msg) {
  try {
    // Step 1: Basic filtering
    const filterResult = messageFilter.filter(msg);
    if (!filterResult.pass) {
      logger.debug({ jid: msg.jid, reason: filterResult.reason }, 'Message filtered out');
      return;
    }

    // Step 2: Bot detection
    const botCheck = botDetector.check(msg);
    if (botCheck.isBot && botCheck.confidence >= 0.7) {
      logger.info({ jid: msg.jid, reason: botCheck.reason }, 'Bot message detected, skipping');
      // Still store the message for record
      messagesRepo.insert({
        jid: msg.jid, direction: 'inbound', content: msg.text,
        content_type: msg.contentType, is_ai_generated: false,
      });
      return;
    }

    // Step 3: Loop detection
    const loopCheck = loopDetector.check(msg.jid, msg.text);
    if (loopCheck.isHalted) {
      logger.warn({ jid: msg.jid, remainingMs: loopCheck.haltRemainingMs }, 'Contact halted (loop)');
      return;
    }

    // Step 4: Rate limit
    const rateCheck = rateLimiter.check(msg.jid);
    if (!rateCheck.allowed) {
      logger.warn({ jid: msg.jid }, 'Rate limited');
      return;
    }

    // Step 7: Upsert contact
    const contact = contactsRepo.upsert(msg.jid, { display_name: msg.pushName || undefined });

    // Step 8: Analyze message (Observe)
    // We do this before checking owner activity so the bot "observes" with full intelligence
    const analysis = await intentDetector.analyze(msg.text);
    const intentResult = { intent: analysis.intent, confidence: analysis.confidence, language: analysis.language };
    const moodResult = { mood: analysis.mood, intensity: analysis.moodIntensity };

    // Step 9: Store inbound message
    messagesRepo.insert({
      jid: msg.jid,
      direction: 'inbound',
      content: msg.text,
      content_type: msg.contentType,
      intent: intentResult.intent,
      mood: moodResult.mood,
      is_ai_generated: false,
    });

    // Step 10: Update contact mood
    if (moodResult.mood !== 'neutral') {
      contactsRepo.updateProfile(msg.jid, { last_mood: moodResult.mood });
    }

    // Step 11: Check if auto-reply is suppressed
    // 1. Check if auto-reply is disabled for this contact
    if (contact.auto_reply_enabled === 0) {
      logger.debug({ jid: msg.jid }, 'Auto-reply disabled for contact');
      return;
    }

    // 2. Check if owner is active (Stop AI replies)
    if (offlineAssistant.isOwnerActive(msg.jid)) {
      logger.info({ jid: msg.jid }, 'Owner active in chat, skipping AI reply (Observing)');
      return;
    }

    // Step 12: Emit mood alert if needed
    if (moodDetector.isAlertWorthy(moodResult.mood, moodResult.intensity)) {
      bus.safeEmit('alert:mood', { jid: msg.jid, mood: moodResult.mood, intensity: moodResult.intensity, text: msg.text });
    }

    // Step 13: Route and send reply
    await _routeAndReply(msg, contact, intentResult, moodResult);

  } catch (err) {
    // Handle quota or general AI failures gracefully
    const isAiError = err.name === 'QuotaError' || err.status === 429 || err.status === 404;
    
    if (isAiError && msg.jid) {
      const fallback = FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
      try {
        await transport.sendMessage(msg.jid, fallback);
        messagesRepo.insert({
          jid: msg.jid, direction: 'outbound', content: fallback,
          content_type: 'text', is_ai_generated: false,
        });
        logger.warn({ jid: msg.jid, status: err.status }, 'Sent fallback reply (AI error/quota)');
      } catch (sendErr) {
        logger.error({ err: sendErr }, 'Failed to send fallback message');
      }
      return;
    }
    logger.error({ err, jid: msg.jid }, 'Error in message router');
  }
}

/**
 * Route by intent and send the final reply.
 * (Steps 13-16 extracted from handleInbound)
 */
async function _routeAndReply(msg, contact, intentResult, moodResult) {
  let aiReply;

  switch (intentResult.intent) {
    case 'command':
      // Commands are handled by admin-commands service
      bus.safeEmit('intent:command', msg);
      return;

    case 'greeting':
      // If it's a simple greeting and we are quota-limited, use a static reply
      if (geminiClient.isQuotaExhausted()) {
        aiReply = `Hello! Friday here. I'm currently running in low-power mode because my owner didn' gave me enough food, but Bhuwan will be back soon to chat with you properly! 😊`;
      } else {
        aiReply = await _generateReply(msg, contact, intentResult, moodResult);
      }
      break;

    case 'schedule':
      aiReply = await scheduleAssistant.handleScheduleRequest(msg.jid, msg.text, contact);
      break;

    case 'knowledge':
      aiReply = await _handleKnowledgeQuery(msg, contact);
      break;

    default:
      aiReply = await _generateReply(msg, contact, intentResult, moodResult);
      break;
  }

  if (!aiReply || aiReply.trim().length === 0) {
    logger.warn({ jid: msg.jid, intent: intentResult.intent }, 'Empty AI reply, skipping send');
    return;
  }

  // Final check: Did owner start texting while we were waiting for AI?
  if (offlineAssistant.isOwnerActive(msg.jid)) {
    logger.info({ jid: msg.jid }, 'Owner interjected during AI generation, canceling AI reply');
    return;
  }

  // Step 14: Send reply
  logger.info({ jid: msg.jid, replyLength: aiReply.length, aiReply }, 'Sending AI reply');
  await transport.simulateTyping(msg.jid, Math.min(aiReply.length * 15, 1500));
  await transport.sendMessage(msg.jid, aiReply);

  // Step 14: Record outbound + rate limit
  messagesRepo.insert({
    jid: msg.jid,
    direction: 'outbound',
    content: aiReply,
    content_type: 'text',
    intent: intentResult.intent,
    is_ai_generated: true,
  });
  rateLimiter.record(msg.jid);
  logger.debug({ jid: msg.jid }, 'Message routing flow complete');
  followUpTracker.analyzeReply(msg.jid, aiReply);

  // Step 16: Forward to n8n if configured
  if (config.n8n.webhook) {
    bus.safeEmit('n8n:forward', { jid: msg.jid, text: msg.text, reply: aiReply, intent: intentResult.intent });
  }

  logger.info({ jid: msg.jid, intent: intentResult.intent, mood: moodResult.mood, aiReply }, 'Message processed');
}

/**
 * Handle owner's manual messages (for learning + conversation pause).
 */
async function handleOwnerMessage(msg) {
  try {
    logger.debug({ jid: msg.jid, text: msg.text, isFromMe: msg.isFromMe }, 'handleOwnerMessage called');
    
    const jid = msg.jid;
    if (!jid || msg.isGroup) return;

    // Ensure contact exists before inserting messages (FK constraint)
    contactsRepo.upsert(jid, { display_name: msg.pushName || undefined });

    // Mark owner as active for this contact (pause auto-reply)
    offlineAssistant.recordOwnerReply(jid);

    // Check if this is a command (starts with ! or /)
    if (msg.text && (msg.text.startsWith('!') || msg.text.startsWith('/'))) {
      // Process as command
      logger.debug({ jid: msg.jid, text: msg.text }, 'Detected owner command, emitting intent:command');
      bus.safeEmit('intent:command', msg);
      return;
    }

    // Store owner message
    messagesRepo.insert({
      jid,
      direction: 'owner_manual',
      content: msg.text,
      content_type: msg.contentType || 'text',
      is_ai_generated: false,
    });

    // Feed to learning engine
    learningEngine.learnFromOwner(jid, msg.text);

    logger.debug({ jid }, 'Owner message recorded');
  } catch (err) {
    logger.error({ err }, 'Error handling owner message');
  }
}

/**
 * Generate an AI reply using the chat session with full context.
 */
async function _generateReply(msg, contact, intentResult, moodResult) {
  // Build enriched prompt
  const context = {};

  // Get conversation summary if available
  try {
    const summaryRepo = require('../database/repositories/messages.repo');
    const recentMsgs = summaryRepo.getRecent(msg.jid, 5);
    if (recentMsgs.length > 0) {
      context.conversationSummary = recentMsgs.map((m) =>
        `${m.direction === 'inbound' ? 'User' : 'Bot'}: ${m.content}`
      ).join('\n');
    }
  } catch { /* ignore */ }

  // Get relevant knowledge
  try {
    const kbResults = knowledgeBase.search(msg.text);
    if (kbResults && kbResults.length > 0) {
      context.knowledgeHits = kbResults.map((k) => k.answer);
    }
  } catch { /* ignore */ }

  // Get learned patterns
  try {
    const patterns = learningEngine.getRelevantPatterns(msg.jid, intentResult.intent);
    if (patterns && patterns.length > 0) {
      context.learnedPatterns = patterns.map((p) => p.owner_response);
    }
  } catch { /* ignore */ }

  const enrichedMessage = promptBuilder.buildUserPrompt(msg.text, context);
  logger.debug({ jid: msg.jid, promptLength: enrichedMessage.length }, 'Sending enriched prompt to AI');
  return chatSession.reply(msg.jid, enrichedMessage, contact);
}

/**
 * Handle knowledge-base queries — check KB first, then fallback to AI.
 */
async function _handleKnowledgeQuery(msg, contact) {
  const results = knowledgeBase.search(msg.text);
  if (results && results.length > 0) {
    // Use KB answer directly if high confidence
    return results[0].answer;
  }
  // Fallback to regular AI reply
  return chatSession.reply(msg.jid, msg.text, contact);
}

module.exports = { init, handleInbound, handleOwnerMessage };
