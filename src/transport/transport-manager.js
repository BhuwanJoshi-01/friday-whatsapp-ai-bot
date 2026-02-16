'use strict';

/**
 * Transport Manager — factory + unified API for WhatsApp libraries.
 * Delegates to the active adapter (webjs or baileys).
 * All modules interact with WhatsApp through this interface only.
 */

const config = require('../config');
const logger = require('../core/logger');
const bus = require('../core/event-bus');

let adapter = null;

/**
 * Initialize the transport layer based on config.
 */
async function connect() {
  const lib = config.whatsapp.lib;
  logger.info({ lib }, 'Initializing WhatsApp transport');

  if (lib === 'baileys') {
    const BaileysAdapter = require('./baileys.adapter');
    adapter = new BaileysAdapter();
  } else {
    const WebJsAdapter = require('./webjs.adapter');
    adapter = new WebJsAdapter();
  }

  // Pipe adapter events to the global event bus
  adapter.on('message:raw', (msg) => {
    logger.debug({ jid: msg.jid, isFromMe: msg.isFromMe }, 'Emitting transport:message:raw');
    bus.safeEmit('transport:message:raw', msg);
  });
  adapter.on('message:owner', (msg) => {
    logger.debug({ jid: msg.jid, isFromMe: msg.isFromMe }, 'Emitting transport:message:owner');
    bus.safeEmit('transport:message:owner', msg);
  });
  adapter.on('message:owner:typing', (data) => {
    logger.debug({ jid: data.jid }, 'Emitting transport:message:owner:typing');
    bus.safeEmit('transport:message:owner:typing', data);
  });
  adapter.on('ready', () => bus.safeEmit('transport:ready'));
  adapter.on('disconnected', (reason) => bus.safeEmit('transport:disconnected', reason));
  adapter.on('qr', (qr) => bus.safeEmit('transport:qr', qr));

  await adapter.connect();
  logger.info({ lib }, 'WhatsApp transport connected');
}

/**
 * Send a text message.
 * @param {string} jid - Recipient JID or phone number
 * @param {string} text - Message text
 */
async function sendMessage(jid, text) {
  if (!adapter) throw new Error('Transport not initialized');
  return adapter.sendMessage(jid, text);
}

/**
 * Send a media message (audio/image/document).
 * @param {string} jid - Recipient JID
 * @param {Buffer} media - Media buffer
 * @param {object} options - { mimetype, filename, caption, ptt (for voice) }
 */
async function sendMedia(jid, media, options = {}) {
  if (!adapter) throw new Error('Transport not initialized');
  return adapter.sendMedia(jid, media, options);
}

/**
 * Simulate typing indicator.
 */
async function simulateTyping(jid, durationMs = 2000) {
  if (!adapter) return;
  try {
    await adapter.simulateTyping(jid, durationMs);
  } catch (err) {
    logger.debug({ err }, 'Typing simulation failed (non-critical)');
  }
}

/**
 * Disconnect the transport.
 */
async function disconnect() {
  if (adapter) {
    await adapter.disconnect();
    adapter = null;
  }
}

function isReady() {
  return adapter !== null && adapter.isReady();
}

function getLib() {
  return config.whatsapp.lib;
}

module.exports = {
  connect,
  sendMessage,
  sendMedia,
  simulateTyping,
  disconnect,
  isReady,
  getLib,
};
