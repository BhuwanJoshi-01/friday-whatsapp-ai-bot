'use strict';

const { Router } = require('express');
const transport = require('../transport/transport-manager');
const chatSession = require('../ai/chat-session');

const router = Router();

router.get('/', (req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  res.json({
    status: transport.isReady() ? 'ok' : 'degraded',
    uptime: Math.floor(uptime),
    transport: {
      lib: transport.getLib(),
      connected: transport.isReady(),
    },
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    activeSessions: chatSession.size,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
