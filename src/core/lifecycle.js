'use strict';

/**
 * Graceful lifecycle manager.
 * Registers shutdown hooks, handles SIGINT/SIGTERM, cleans up resources.
 */

const logger = require('./logger');

const shutdownHooks = [];
let shuttingDown = false;

/**
 * Register a function to be called during graceful shutdown.
 * @param {string} name - Human-readable name for logging
 * @param {Function} fn - Async/sync cleanup function
 */
function registerShutdown(name, fn) {
  shutdownHooks.push({ name, fn });
}

/**
 * Execute all shutdown hooks in reverse order (LIFO) then exit.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown initiated');

  for (let i = shutdownHooks.length - 1; i >= 0; i--) {
    const hook = shutdownHooks[i];
    try {
      logger.info(`Shutting down: ${hook.name}`);
      await hook.fn();
    } catch (err) {
      logger.error({ err, hook: hook.name }, 'Shutdown hook failed');
    }
  }

  logger.info('All shutdown hooks complete. Bye.');
  process.exit(0);
}

// Attach signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Log uncaught errors (but don't swallow them silently)
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

module.exports = { registerShutdown, shutdown };
