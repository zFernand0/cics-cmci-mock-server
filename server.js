/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const { createApp } = require('./src/app');
const { createConfig } = require('./src/config');
const http = require('node:http');

// Preserve the exported Express app while allowing isolated instances.
const app = createApp();
module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;

function startServer({ env = process.env, logger = console } = {}) {
  const config = createConfig({}, env);
  const serverApp = createApp({ config, logger });
  const server = http.createServer(serverApp);
  server.on('error', error => {
    logger.error(`Cannot start CMCI mock server: ${error.message}`);
    process.exitCode = 1;
  });
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.once('close', () => {
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  });
  server.listen(config.port, config.host, () => {
    logger.log(`CICS CMCI Mock Server: http://${config.host}:${server.address().port}`);
  });
  return server;
}

if (require.main === module) {
  try { startServer(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
