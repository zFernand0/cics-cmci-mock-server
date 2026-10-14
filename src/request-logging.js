/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const { performance } = require('node:perf_hooks');

function formatRequestTarget(originalUrl) {
  let url;
  try { url = new URL(originalUrl, 'http://mock'); }
  catch { return '<invalid-url>'; }
  for (const key of [...url.searchParams.keys()]) {
    if (/password|authorization|cookie|token|secret|otp|credential/i.test(key)) {
      url.searchParams.set(key, '[REDACTED]');
    }
  }
  return url.pathname + url.search;
}

function requestLogging(logger = console) {
  return (req, res, next) => {
    const started = performance.now();
    res.once('finish', () => {
      const elapsed = (performance.now() - started).toFixed(1);
      logger.log(`${req.method} ${formatRequestTarget(req.originalUrl)} -> ${res.statusCode} (${elapsed} ms)`);
    });
    next();
  };
}

module.exports = { formatRequestTarget, requestLogging };
