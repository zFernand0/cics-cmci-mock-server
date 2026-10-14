/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { createConfig } = require('./config');
const { createState } = require('./state');
const { createAuth } = require('./auth');
const { RESOURCE_TYPES, keyData } = require('./resources');
const { sendResponse } = require('./cmci');
const { createCmciRouter } = require('./cmci-routes');
const { createAdminRouter } = require('./admin-routes');
const { requestLogging } = require('./request-logging');

function normalizeFixtures(fixtures, maxRecords) {
  const normalized = Object.create(null);
  for (const [name, records] of Object.entries(fixtures)) {
    const type = name.toLowerCase();
    if (!Object.hasOwn(RESOURCE_TYPES, type) || type === 'cicsresultcache') throw new TypeError(`Unknown fixture resource: ${name}`);
    if (!Array.isArray(records) || records.length > maxRecords) throw new TypeError(`Fixture ${name} must be an array within MAX_RECORDS`);
    normalized[type] = records.map((attributes, index) => {
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new TypeError('Fixture records must be attribute objects');
      const data = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (!/^[a-z_][a-z\d_]*$/i.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) {
          throw new TypeError('Fixture attributes must have XML names and scalar values');
        }
        data[key.toLowerCase()] = String(value);
      }
      return { $: { _keydata: keyData(type, index), ...data } };
    });
  }
  return normalized;
}

function createApp(options = {}) {
  const config = createConfig(options.config, options.env);
  const state = createState(config, options.now);
  const auth = createAuth(state, config);
  const fixtures = normalizeFixtures(options.fixtures || {}, config.maxRecords);
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  if (config.logRequests) app.use(requestLogging(options.logger));
  app.use(cors());
  app.use(cookieParser());
  // Expiry is enforced on every request; no timers or sockets start on import.
  app.use((req, res, next) => { state.cleanup(); next(); });
  app.use(express.text({ type: ['application/xml', 'text/xml', 'application/*+xml'], limit: config.bodyLimit }));
  app.use(express.json({ limit: config.bodyLimit }));

  app.use('/CICSSystemManagement', createCmciRouter(state, config, auth, fixtures));

  app.get('/health', (req, res) => res.json({
    status: 'healthy', timestamp: new Date(state.now()).toISOString(),
    activeSessions: state.sessions.size, ltpaTokens: state.ltpaTokens.size,
    cacheEntries: [...state.results.values()].filter(entry => entry.legacy).length,
    retainedResultSets: state.results.size, cachedRecords: state.cachedRecords
  }));

  app.post('/auth/generate-otp', (req, res) => {
    const username = req.body?.username;
    if (typeof username !== 'string' || !username) return res.status(400).json({ error: 'Username is required' });
    if (username !== 'testuser') return res.status(403).json({ error: 'OTP is only available for testuser' });
    return res.json(auth.generateOTP());
  });
  app.get('/auth/otp-status/:username', (req, res) => {
    if (req.params.username !== 'testuser') return res.status(403).json({ error: 'OTP status is only available for testuser' });
    const stored = state.otps.get('testuser');
    if (!stored) return res.json({ hasOTP: false, message: 'No active OTP for this user' });
    const seconds = Math.ceil((stored.expiresAt - state.now()) / 1000);
    return res.json({ hasOTP: true, expiresAt: new Date(stored.expiresAt).toISOString(),
      timeRemainingSeconds: seconds, message: `OTP is valid for ${seconds} more seconds` });
  });

  app.use('/admin', createAdminRouter(state, auth));

  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error instanceof URIError ? 400 : 500);
    const message = status === 500 ? 'Internal server error' : error.message;
    if (status === 500) options.logger?.error('Unhandled server error', error);
    if (req.originalUrl.split('?')[0].toLowerCase().startsWith('/cicssystemmanagement')) {
      return sendResponse(req, res, { status, code: error.code || 'INVALIDDATA', message });
    }
    return res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
