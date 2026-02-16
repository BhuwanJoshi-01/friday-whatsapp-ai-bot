'use strict';

/**
 * Express Server — HTTP API for external integrations (n8n, dashboards).
 * Mounts route modules and exports the server for the orchestrator.
 */

const express = require('express');
const config = require('../config');
const logger = require('../core/logger');

const app = express();
app.use(express.json());

// Basic request logging
app.use((req, res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'HTTP request');
  next();
});

// Mount routes
app.use('/health', require('./health.routes'));
app.use('/api/messages', require('./messages.routes'));
app.use('/api/contacts', require('./contacts.routes'));
app.use('/api/admin', require('./admin.routes'));
app.use('/api/gemini', require('./gemini.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error({ err, url: req.url }, 'HTTP error');
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start the HTTP server.
 */
function start() {
  const port = config.app.port;
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info({ port }, 'HTTP server listening');
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error({ port }, 'Port already in use. Please kill the process or change the port in .env');
      }
      reject(err);
    });
  });
}

module.exports = { app, start };
