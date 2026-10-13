/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const crypto = require('node:crypto');
const { CmciError } = require('./cmci');

function createState(config, now = Date.now) {
  const sessions = new Map();
  const usernames = new Map();
  const ltpaTokens = new Map();
  const otps = new Map();
  const results = new Map();
  const requestIndex = new Map();
  let cachedRecords = 0;

  function deleteResult(token) {
    const entry = results.get(token);
    if (!entry) return false;
    results.delete(token);
    requestIndex.delete(entry.key);
    cachedRecords -= entry.data.length;
    return true;
  }

  function deleteSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    usernames.delete(session.username);
    ltpaTokens.delete(session.ltpaToken2);
    for (const [token, entry] of results) if (entry.sessionId === id) deleteResult(token);
  }

  function cleanup() {
    const time = now();
    for (const [id, session] of sessions) if (time >= session.expiresAt) deleteSession(id);
    for (const [username, otp] of otps) if (time >= otp.expiresAt) otps.delete(username);
    for (const [token, entry] of results) {
      if (time - entry.lastAccessed >= config.cacheTtlMs) deleteResult(token);
    }
  }

  function getSession(username) {
    let session = sessions.get(usernames.get(username));
    if (!session) {
      const time = now();
      session = {
        id: crypto.randomBytes(16).toString('hex').toUpperCase(), username,
        loginTime: time, lastActivity: time, expiresAt: time + config.sessionTtlMs,
        ltpaToken2: crypto.randomBytes(64).toString('base64url')
      };
      sessions.set(session.id, session);
      usernames.set(username, session.id);
    }
    if (!session.ltpaToken2) session.ltpaToken2 = crypto.randomBytes(64).toString('base64url');
    ltpaTokens.set(session.ltpaToken2, session.id);
    session.lastActivity = now();
    return session;
  }

  function storeResult({ key, resourceType, path, data, sessionId, query, legacy }) {
    const existing = results.get(requestIndex.get(key));
    if (existing) {
      existing.legacy ||= legacy;
      touchResult(existing.token);
      return existing;
    }
    while (results.size >= config.maxResultSets || cachedRecords + data.length > config.maxCachedRecords) {
      deleteResult(results.keys().next().value);
    }
    const time = now();
    const token = crypto.randomBytes(8).toString('hex').toUpperCase();
    const entry = { token, key, resourceType, path, data, sessionId, query,
      legacy, createdAt: time, lastAccessed: time };
    results.set(token, entry);
    requestIndex.set(key, token);
    cachedRecords += data.length;
    return entry;
  }

  function findResult(token, sessionId, resourceType, path) {
    const entry = results.get(token);
    if (!entry) return null;
    if (entry.sessionId !== sessionId) throw new CmciError(403, 'NOTAVAILABLE', 'Access denied');
    if (resourceType && (entry.resourceType !== resourceType || entry.path !== path)) {
      throw new CmciError(404, 'NOTAVAILABLE', 'Cache token belongs to another resource or context');
    }
    return entry;
  }

  function touchResult(token) {
    const entry = results.get(token);
    entry.lastAccessed = now();
    // Map insertion order doubles as an LRU list, without scanning cache keys.
    results.delete(token);
    results.set(token, entry);
  }

  function clearResults(legacyOnly = false) {
    let count = 0;
    for (const [token, entry] of results) {
      if (!legacyOnly || entry.legacy) { deleteResult(token); count++; }
    }
    return count;
  }

  return { sessions, ltpaTokens, otps, results, requestIndex, now, cleanup,
    getSession, deleteSession, storeResult, findResult, touchResult,
    deleteResult, clearResults, get cachedRecords() { return cachedRecords; } };
}

module.exports = { createState };
