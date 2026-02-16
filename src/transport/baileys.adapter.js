'use strict';

/**
 * Baileys adapter — implements the unified transport interface.
 * Handles multi-file auth, QR, reconnect, message normalization.
 * Uses @whiskeysockets/baileys v6+ (active fork).
 */

const { EventEmitter } = require('events');
const config = require('../config');
const logger = require('../core/logger');

class BaileysAdapter extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this._ready = false;
    this._connecting = false;
    this._reconnectAttempts = 0;
    this._maxReconnect = 5;
  }

  async connect() {
    if (this._connecting) return;
    this._connecting = true;

    try {
      const baileys = require('@whiskeysockets/baileys');
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;
      const qrcode = require('qrcode-terminal');
      const pino = require('pino');

      // Clean up old socket if it exists
      if (this.sock) {
        try { this.sock.end(); } catch { /* ignore */ }
        this.sock = null;
      }
      this._ready = false;

      const authFolder = './baileys_auth';
      logger.info({ authFolder }, 'Using Baileys multi-file auth state');
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);

      // Fetch latest WA Web version for protocol compatibility
      let version;
      try {
        const vInfo = await fetchLatestBaileysVersion();
        version = vInfo.version;
        logger.info({ version }, 'Fetched latest Baileys WA version');
      } catch (e) {
        logger.warn({ err: e.message }, 'Could not fetch latest version, using default');
      }

      const socketOpts = {
        auth: state,
        browser: Browsers.ubuntu('Friday'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        logger: pino({ level: 'silent' }), // Silence Baileys internal logging
      };
      if (version) socketOpts.version = version;

      this.sock = makeWASocket(socketOpts);

      // --- Save credentials on update ---
      this.sock.ev.on('creds.update', async () => {
        try { await saveCreds(); } catch (e) {
          logger.warn({ err: e.message }, 'Failed to save Baileys creds');
        }
      });

      // --- Connection state ---
      this.sock.ev.on('connection.update', (update) => {
        // ... (existing code)
      });

      // --- Presence updates (detect typing) ---
      this.sock.ev.on('presence.update', ({ id, presences }) => {
        // If the owner (isFromMe) is composing, emit an owner activity event
        // Note: id is the contact's JID. presences[ownerJid] might contain the info.
        // In Baileys, linked devices usually receive presence updates.
        for (const [jid, presence] of Object.entries(presences)) {
          if (presence.lastKnownPresence === 'composing') {
            // Check if this JID belongs to the owner account (including linked devices)
            const isOwner = jid.startsWith(config.whatsapp.ownerJid.split('@')[0]);
            if (isOwner) {
              logger.debug({ jid: id }, 'Owner is typing, emitting message:owner:typing');
              this.emit('message:owner:typing', { jid: id });
            }
          }
        }
      });

      // --- Inbound messages ---
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Only process newly received messages
        if (type !== 'notify') return;

        for (const msg of messages) {
          try {
            if (!msg.message) continue;
            
            const normalized = this._normalizeInbound(msg);

            // Log incoming messages for debugging
            logger.info({ jid: normalized.jid, fromMe: normalized.isFromMe, text: normalized.text }, 'New WhatsApp message received');

            if (normalized.isFromMe) {
              logger.debug({ jid: normalized.jid }, 'BaileysAdapter emitting message:owner');
              this.emit('message:owner', normalized);
            } else {
              logger.debug({ jid: normalized.jid }, 'BaileysAdapter emitting message:raw');
              this.emit('message:raw', normalized);
            }
          } catch (err) {
            logger.error({ err }, 'Error processing Baileys message');
          }
        }
      });
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Normalize a Baileys message to the standard shape.
   */
  _normalizeInbound(msg) {
    const jid = msg.key?.remoteJid || '';
    const isGroup = jid.endsWith('@g.us');
    const isFromMe = msg.key?.fromMe || false;

    // Extract text from various message types
    let text = '';
    const m = msg.message;
    if (m) {
      text = m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || m.documentMessage?.caption
        || '';
    }

    // Detect content type
    let contentType = 'text';
    if (m?.imageMessage) contentType = 'image';
    else if (m?.videoMessage) contentType = 'video';
    else if (m?.audioMessage) contentType = 'voice';
    else if (m?.documentMessage) contentType = 'document';
    else if (m?.stickerMessage) contentType = 'sticker';

    return {
      jid,
      text,
      timestamp: typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : (msg.messageTimestamp?.low || Math.floor(Date.now() / 1000)),
      contentType,
      waMessageId: msg.key?.id || null,
      isFromMe,
      isGroup,
      pushName: msg.pushName || null,
      hasMedia: ['image', 'video', 'voice', 'document'].includes(contentType),
      rawMsg: msg,
      sourceLib: 'baileys',
    };
  }

  async sendMessage(jid, text) {
    // Baileys uses @s.whatsapp.net for individual chats (NOT @c.us)
    const toJid = jid.includes('@') ? jid.replace('@c.us', '@s.whatsapp.net') : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    return this.sock.sendMessage(toJid, { text });
  }

  async sendMedia(jid, media, options = {}) {
    const toJid = jid.includes('@') ? jid.replace('@c.us', '@s.whatsapp.net') : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;

    if (options.ptt || options.mimetype?.includes('audio')) {
      return this.sock.sendMessage(toJid, {
        audio: media,
        mimetype: options.mimetype || 'audio/ogg; codecs=opus',
        ptt: true,
      });
    }

    if (options.mimetype?.includes('image')) {
      return this.sock.sendMessage(toJid, {
        image: media,
        caption: options.caption || '',
      });
    }

    // Generic document
    return this.sock.sendMessage(toJid, {
      document: media,
      mimetype: options.mimetype || 'application/octet-stream',
      fileName: options.filename || 'file',
    });
  }

  async simulateTyping(jid, durationMs = 2000) {
    const toJid = jid.includes('@') ? jid.replace('@c.us', '@s.whatsapp.net') : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    await this.sock.sendPresenceUpdate('composing', toJid);
    await new Promise((r) => setTimeout(r, durationMs));
    await this.sock.sendPresenceUpdate('paused', toJid);
  }

  async disconnect() {
    this._ready = false;
    if (this.sock) {
      try { this.sock.end(); } catch { /* ignore */ }
      this.sock = null;
    }
  }

  isReady() {
    return this._ready;
  }
}

module.exports = BaileysAdapter;
