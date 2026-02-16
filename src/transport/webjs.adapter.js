'use strict';

/**
 * whatsapp-web.js adapter — implements the unified transport interface.
 * Handles QR, LocalAuth, Puppeteer config, reconnect logic, message normalization.
 */

const { EventEmitter } = require('events');
const config = require('../config');
const logger = require('../core/logger');

class WebJsAdapter extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this._ready = false;
    this._reconnecting = false;
    this._connecting = false;
  }

  async connect() {
    if (this._connecting) return;
    this._connecting = true;

    try {
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const qrcode = require('qrcode-terminal');

      // Clean up old client if it exists
      if (this.client) {
        try { await this.client.destroy(); } catch (e) { /* ignore */ }
        this.client = null;
      }

      const puppeteerArgs = {
        puppeteer: {
          headless: config.whatsapp.headless,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
          ],
        },
      };

      const localAuth = new LocalAuth({
        clientId: 'operator',
        dataPath: './.wwebjs_auth_local',
        rmMaxRetries: 5,
      });

      this.client = new Client(Object.assign({ authStrategy: localAuth }, puppeteerArgs));

      // --- Event wiring ---

      this.client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
        logger.info('Scan QR code to login (whatsapp-web.js)');
        this.emit('qr', qr);
      });

      this.client.on('ready', () => {
        if (this._ready) return; // Prevent double ready logs
        this._ready = true;
        logger.info('whatsapp-web.js client ready');
        if (this.client && this.client.info) {
          logger.info({ info: this.client.info.wid }, 'Client info');
        }
        this.emit('ready');
      });

      this.client.on('auth_failure', (msg) => {
        logger.error({ msg }, 'whatsapp-web.js auth failure');
      });

      this.client.on('disconnected', (reason) => {
        this._ready = false;
        logger.warn({ reason }, 'whatsapp-web.js disconnected');
        this.emit('disconnected', reason);

        const isLogout = reason && String(reason).toLowerCase().includes('logout');

        if (isLogout) {
          // WhatsApp explicitly logged us out — clear session and stop
          logger.warn('Session logged out by WhatsApp. Clearing auth. Please restart to re-pair.');
          const fs = require('fs');
          try { fs.rmSync('./.wwebjs_auth_local', { recursive: true, force: true }); } catch { /* ok */ }
          return; // Do NOT auto-reconnect on logout
        }

        // Only reconnect on non-logout disconnects
        if (!this._reconnecting) {
          this._reconnecting = true;
          logger.warn({ delay: 5000 }, 'Reinitializing transport in 5000ms');
          setTimeout(async () => {
            try {
              this._reconnecting = false;
              await this.connect();
            } catch (e) {
              logger.error({ err: e.message }, 'Reconnection failed');
              this._reconnecting = false;
            }
          }, 5000);
        }
      });

      // --- Inbound messages ---
      this.client.on('message', async (msg) => {
        try {
          const normalized = this._normalizeInbound(msg);
          if (normalized.isFromMe) return;
          this.emit('message:raw', normalized);
        } catch (err) {
          logger.error({ err }, 'Error processing inbound message (webjs)');
        }
      });

      // --- Owner sent messages (for commands + learning) ---
      this.client.on('message_create', (msg) => {
        try {
          const isFromMe = msg.fromMe || (msg.key && msg.key.fromMe);
          if (!isFromMe) return;
          const normalized = this._normalizeOutbound(msg);
          this.emit('message:owner', normalized);
        } catch (err) {
          logger.error({ err }, 'Error processing owner message (webjs)');
        }
      });

      // --- Initialize with retries ---
      await this._initWithRetries(3);
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Normalize a whatsapp-web.js inbound message to a standard shape.
   */
  _normalizeInbound(msg) {
    const from = msg.from;
    const to = msg.to;
    const isFromMe = msg.fromMe || false;
    const contact = isFromMe ? to : from;
    const isGroup = contact ? contact.endsWith('@g.us') : false;

    return {
      jid: contact,
      text: msg.body || '',
      timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
      contentType: msg.type || 'text',
      waMessageId: msg.id ? msg.id._serialized : null,
      isFromMe,
      isGroup,
      pushName: msg._data && msg._data.notifyName ? msg._data.notifyName : null,
      hasMedia: msg.hasMedia || false,
      rawMsg: msg,
      sourceLib: 'webjs',
    };
  }

  /**
   * Normalize a whatsapp-web.js outbound (owner sent) message.
   */
  _normalizeOutbound(msg) {
    return {
      jid: msg.to,
      text: msg.body || '',
      timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
      contentType: msg.type || 'text',
      waMessageId: msg.id ? msg.id._serialized : null,
      isFromMe: true,
      isGroup: msg.to ? msg.to.endsWith('@g.us') : false,
      sourceLib: 'webjs',
    };
  }

  async _initWithRetries(maxAttempts) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({ attempt, maxAttempts }, 'webjs: initializing');
        await this.client.initialize();
        logger.info('webjs: initialization succeeded');
        return;
      } catch (err) {
        logger.error({ attempt, err: err.message }, 'webjs: init failed');
        try { if (this.client.destroy) await this.client.destroy(); } catch { /* ignore */ }
        if (attempt < maxAttempts) {
          const backoff = 1000 * Math.pow(2, attempt - 1);
          logger.info({ backoff }, 'webjs: retrying');
          await sleep(backoff);
        } else {
          throw err;
        }
      }
    }
  }

  async sendMessage(jid, text) {
    const toId = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@c.us`;
    return this.client.sendMessage(toId, text);
  }

  async sendMedia(jid, media, options = {}) {
    const { MessageMedia } = require('whatsapp-web.js');
    const toId = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@c.us`;

    let msgMedia;
    if (Buffer.isBuffer(media)) {
      const base64 = media.toString('base64');
      msgMedia = new MessageMedia(options.mimetype || 'application/octet-stream', base64, options.filename);
    } else {
      msgMedia = media;
    }

    return this.client.sendMessage(toId, msgMedia, {
      caption: options.caption,
      sendAudioAsVoice: options.ptt || false,
    });
  }

  async simulateTyping(jid, durationMs = 2000) {
    const chat = await this.client.getChatById(jid);
    if (chat) {
      await chat.sendStateTyping();
      await new Promise((r) => setTimeout(r, durationMs));
      await chat.clearState();
    }
  }

  async disconnect() {
    this._ready = false;
    if (this.client) {
      try { await this.client.destroy(); } catch { /* ignore */ }
      this.client = null;
    }
  }

  isReady() {
    return this._ready;
  }
}

module.exports = WebJsAdapter;
