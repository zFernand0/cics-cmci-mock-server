/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 9080,
  defaultCount: 3,
  maxRecords: 10000,
  maxResultSets: 100,
  maxCachedRecords: 100000,
  cacheTtlMs: 15 * 60 * 1000,
  sessionTtlMs: 8 * 60 * 60 * 1000,
  otpTtlMs: 5 * 60 * 1000,
  otpSingleUse: true,
  autoCache: true,
  cacheMissFallback: true,
  bodyLimit: '100kb'
});

const ENV_KEYS = {
  host: 'HOST', port: 'PORT', defaultCount: 'DEFAULT_COUNT',
  maxRecords: 'MAX_RECORDS', maxResultSets: 'MAX_RESULT_SETS',
  maxCachedRecords: 'MAX_CACHED_RECORDS', cacheTtlMs: 'CACHE_TTL_MS',
  sessionTtlMs: 'SESSION_TTL_MS', otpTtlMs: 'OTP_TTL_MS',
  otpSingleUse: 'OTP_SINGLE_USE', autoCache: 'AUTO_CACHE',
  cacheMissFallback: 'CACHE_MISS_FALLBACK', bodyLimit: 'BODY_LIMIT'
};

function createConfig(overrides = {}, env = {}) {
  const config = { ...DEFAULTS };
  for (const [key, envKey] of Object.entries(ENV_KEYS)) {
    const value = overrides[key] ?? env[envKey];
    if (value === undefined) continue;
    if (typeof DEFAULTS[key] === 'boolean') {
      if (![true, false, 'true', 'false'].includes(value)) {
        throw new TypeError(`${envKey} must be true or false`);
      }
      config[key] = value === true || value === 'true';
    } else if (typeof DEFAULTS[key] === 'number') {
      if (!/^\d+$/.test(String(value))) throw new TypeError(`${envKey} must be an integer`);
      config[key] = Number(value);
      const minimum = key === 'port' || key === 'defaultCount' ? 0 : 1;
      if (!Number.isSafeInteger(config[key]) || config[key] < minimum ||
          (key === 'port' && config[key] > 65535)) {
        throw new RangeError(`${envKey} is out of range`);
      }
    } else {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${envKey} must be a non-empty string`);
      if (key === 'bodyLimit' && (!/^\d+(?:\.\d+)?(?:b|kb|mb|gb)?$/i.test(value) || parseFloat(value) <= 0)) {
        throw new TypeError('BODY_LIMIT must be a positive size, such as 100kb');
      }
      config[key] = value;
    }
  }
  if (config.defaultCount > config.maxRecords) throw new RangeError('DEFAULT_COUNT exceeds MAX_RECORDS');
  if (config.maxRecords > config.maxCachedRecords) throw new RangeError('MAX_RECORDS exceeds MAX_CACHED_RECORDS');
  return Object.freeze(config);
}

module.exports = { createConfig };
