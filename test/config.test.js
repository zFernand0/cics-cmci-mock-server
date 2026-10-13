/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../src/config');
const { createApp } = require('../src/app');

test('configuration is immutable, validated and independent of machine environment', () => {
  const config = createConfig();
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9080);
  assert.equal(config.otpTtlMs, 300000);
  assert.ok(Object.isFrozen(config));
  assert.equal(createConfig({}, { PORT: '0', HOST: 'localhost', AUTO_CACHE: 'false', BODY_LIMIT: '1mb' }).port, 0);
  assert.equal(createConfig({}, { AUTO_CACHE: 'false' }).autoCache, false);
  assert.equal(createConfig({}, { AUTO_CACHE: 'true' }).autoCache, true);
  assert.equal(createConfig({ port: 1234, autoCache: false }, { PORT: '4321', AUTO_CACHE: 'true' }).port, 1234);
  assert.equal(createConfig({ autoCache: false }, { AUTO_CACHE: 'true' }).autoCache, false);
  assert.equal(typeof createApp({ env: { AUTO_CACHE: 'false' } }), 'function');
});

for (const config of [
  { port: -1 }, { port: 65536 }, { port: 'bad' }, { port: 1.5 },
  { maxRecords: 0 }, { maxResultSets: 0 }, { maxCachedRecords: 0 },
  { cacheTtlMs: 0 }, { sessionTtlMs: -10 }, { otpTtlMs: 'NaN' },
  { otpSingleUse: 'yes' }, { autoCache: 1 }, { cacheMissFallback: '' },
  { host: '' }, { host: 123 }, { bodyLimit: '' }, { bodyLimit: 'bad' }, { bodyLimit: '0kb' },
  { defaultCount: 5, maxRecords: 4 }, { maxRecords: 200000 },
  { port: Number.MAX_SAFE_INTEGER + 1 }
]) {
  test(`rejects invalid configuration ${JSON.stringify(config)}`, () => assert.throws(() => createConfig(config)));
}

for (const fixtures of [
  { Unknown: [] }, { CICSResultCache: [] }, { CICSProgram: 'invalid' },
  { CICSProgram: [null] }, { CICSProgram: [1] }, { CICSProgram: [[]] },
  { CICSProgram: [{ 'invalid name': 'x' }] }, { CICSProgram: [{ name: {} }] },
  { CICSProgram: [{ name: null }] }
]) {
  test(`rejects invalid fixtures ${JSON.stringify(fixtures)}`, () => assert.throws(() => createApp({ fixtures })));
}

test('rejects fixtures exceeding the per-request record bound', () => {
  assert.throws(() => createApp({ config: { maxRecords: 3 }, fixtures: { CICSProgram: [{}, {}, {}, {}] } }));
});
