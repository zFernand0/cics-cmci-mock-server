/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const express = require('express');

function createAdminRouter(state, auth) {
  const admin = express.Router();
  admin.use(auth.authenticate, auth.requireAdmin);
  admin.get('/sessions', (req, res) => res.json([...state.sessions.values()].map(session => ({
    sessionId: session.id, username: session.username, loginTime: new Date(session.loginTime),
    lastActivity: new Date(session.lastActivity), expiresAt: new Date(session.expiresAt), ltpaToken2: session.ltpaToken2
  }))));
  admin.get('/ltpa-tokens', (req, res) => res.json({ count: state.ltpaTokens.size,
    ltpaTokens: [...state.ltpaTokens].map(([token, sessionId]) => ({ ltpaToken2: token,
      sessionId, username: state.sessions.get(sessionId).username,
      lastActivity: new Date(state.sessions.get(sessionId).lastActivity) })) }));
  admin.get('/cache', (req, res) => {
    const tokens = [...state.results.values()].filter(entry => entry.legacy).map(entry => entry.token);
    res.json({ legacyCacheTokens: tokens, legacyCacheCount: tokens.length });
  });
  admin.get('/retained-results', (req, res) => res.json({ count: state.results.size,
    retainedResultSets: [...state.results.values()].map(entry => ({ cacheToken: entry.token,
      resourceType: entry.resourceType, totalRecords: entry.data.length, sessionId: entry.sessionId,
      createdAt: new Date(entry.createdAt), lastAccessed: new Date(entry.lastAccessed), isExpired: false, query: entry.query })) }));
  admin.get('/otps', (req, res) => res.json({ count: state.otps.size,
    activeOTPs: [...state.otps].map(([username, otp]) => ({ username,
      expiresAt: new Date(otp.expiresAt), isExpired: false,
      timeRemainingSeconds: Math.ceil((otp.expiresAt - state.now()) / 1000) })) }));
  admin.delete('/retained-results/:token', (req, res) => {
    if (!state.deleteResult(req.params.token)) return res.status(404).json({ error: 'Retained result set not found' });
    return res.json({ message: `Retained result set ${req.params.token} deleted` });
  });
  admin.delete('/retained-results', (req, res) => res.json({ message: 'All retained result sets cleared', count: state.clearResults() }));
  admin.delete('/cache', (req, res) => res.json({ message: 'Legacy cache cleared', count: state.clearResults(true) }));
  admin.delete('/otps', (req, res) => {
    const count = state.otps.size;
    state.otps.clear();
    return res.json({ message: 'All OTPs cleared', count });
  });
  admin.delete('/ltpa-tokens', (req, res) => {
    const count = state.ltpaTokens.size;
    state.ltpaTokens.clear();
    for (const session of state.sessions.values()) delete session.ltpaToken2;
    return res.json({ message: 'All LtpaToken2 mappings cleared', count });
  });
  admin.delete('/sessions', (req, res) => {
    const sessionCount = state.sessions.size;
    const ltpaTokenCount = state.ltpaTokens.size;
    const retainedResultSetsCount = state.results.size;
    for (const id of state.sessions.keys()) state.deleteSession(id);
    return res.json({ message: 'All sessions, LtpaToken2 mappings, and retained result sets cleared',
      sessionCount, ltpaTokenCount, retainedResultSetsCount });
  });
  return admin;
}

module.exports = { createAdminRouter };
