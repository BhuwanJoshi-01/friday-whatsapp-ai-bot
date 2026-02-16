'use strict';

/**
 * Structured logger using pino.
 * JSON in production, pretty-print in development.
 */

const config = require('../config');

let pino;
try {
  pino = require('pino');
} catch {
  // Fallback if pino not installed yet
  pino = null;
}

let logger;

if (pino) {
  const options = {
    level: config.app.logLevel,
  };

  if (config.app.env === 'development') {
    try {
      // pino-pretty for dev readability + file logging
      options.transport = {
        targets: [
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
          {
            target: 'pino/file',
            options: { destination: './logs/app.log', mkdir: true },
            level: 'debug'
          }
        ]
      };
    } catch (err) {
      // pino/file transport error or targets not supported in old pino
    }
  }

  logger = pino(options);
} else {
  // Minimal console fallback
  logger = {
    trace: (...args) => console.debug('[TRACE]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    fatal: (...args) => console.error('[FATAL]', ...args),
    child: () => logger,
  };
}

module.exports = logger;
