/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const crypto = require('node:crypto');

function createAuth(state, config) {
  function reject(res, message) {
    return res.set('WWW-Authenticate', 'Basic realm="CICS CMCI Mock"').status(401).json({ error: message });
  }

  function authenticate(req, res, next) {
    const authorization = req.get('authorization');
    const token = req.get('ltpatoken2') || req.cookies.LtpaToken2;
    if (token) {
      const session = state.sessions.get(state.ltpaTokens.get(token));
      if (session) {
        session.lastActivity = state.now();
        req.session = session;
        return next();
      }
      if (!authorization) return reject(res, 'Invalid or expired LtpaToken2');
    }
    if (!authorization) return reject(res, 'Authentication required');
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match) return reject(res, 'Authentication required');
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return reject(res, 'Invalid username or password');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    let valid = username === 'adminusr' && password === 'adminpas';
    if (username === 'testuser') {
      const stored = state.otps.get(username);
      valid = Boolean(stored && state.now() < stored.expiresAt && stored.otp === password);
      if (valid && config.otpSingleUse) state.otps.delete(username);
    }
    if (!valid) return reject(res, 'Invalid username or password');
    req.session = state.getSession(username);
    res.cookie('LtpaToken2', req.session.ltpaToken2, {
      httpOnly: true, secure: req.secure, sameSite: 'lax',
      maxAge: Math.max(0, req.session.expiresAt - state.now())
    });
    return next();
  }

  function requireAdmin(req, res, next) {
    if (req.session.username !== 'adminusr') return res.status(403).json({ error: 'Admin authentication required' });
    return next();
  }

  function generateOTP() {
    const existing = state.otps.get('testuser');
    const isReused = Boolean(existing);
    const stored = existing || { otp: String(crypto.randomInt(100000, 1000000)), expiresAt: state.now() + config.otpTtlMs };
    state.otps.set('testuser', stored);
    const seconds = Math.ceil((stored.expiresAt - state.now()) / 1000);
    return {
      message: `${isReused ? 'Reusing existing' : 'New'} OTP for testuser`,
      otp: stored.otp, expiresIn: `${seconds} seconds`,
      expiresAt: new Date(stored.expiresAt).toISOString(), expiresInSeconds: seconds,
      isReused, usage: "Use this OTP as the password with username 'testuser' for authentication"
    };
  }

  return { authenticate, requireAdmin, generateOTP };
}

module.exports = { createAuth };
