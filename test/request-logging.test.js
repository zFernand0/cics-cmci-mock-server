/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, basic } = require('./helpers');
const { formatRequestTarget } = require('../src/request-logging');

test('request logging is disabled by default', async t => {
  const { request } = await setup(t, { logger: { log: assert.fail } });
  assert.equal((await request('/health')).status, 200);
});

test('request logging prints each completed request, its query, status and duration', async t => {
  const logs = [];
  const { request } = await setup(t, { config: { logRequests: true }, logger: { log: line => logs.push(line) } });
  assert.equal((await request('/CICSSystemManagement/CICSProgram?count=1')).status, 200);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/CICSSystemManagement/CICSProgram', { auth: null })).status, 401);
  assert.equal((await request('/auth/generate-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid-json'
  })).status, 400);
  assert.equal((await request('/health', { method: 'OPTIONS' })).status, 204);
  assert.equal(logs.length, 5);
  assert.match(logs[0], /^GET \/CICSSystemManagement\/CICSProgram\?count=1 -> 200 \(\d+\.\d ms\)$/);
  assert.match(logs[1], /^GET \/missing -> 404 /);
  assert.match(logs[2], /^GET \/CICSSystemManagement\/CICSProgram -> 401 /);
  assert.match(logs[3], /^POST \/auth\/generate-otp -> 400 /);
  assert.match(logs[4], /^OPTIONS \/health -> 204 /);
});

test('request logs omit headers/bodies and redact sensitive query parameters', async t => {
  const logs = [];
  const { request } = await setup(t, { config: { logRequests: true }, logger: { log: line => logs.push(line) } });
  await request('/health?password=private-pass&Password=another-pass&access_token=private-token&otp=654321&count=1', {
    headers: { Authorization: basic(), Cookie: 'secret-cookie', 'X-Custom': 'private-header' }
  });
  const generated = await request('/auth/generate-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}'
  });
  assert.equal(generated.status, 200);
  const output = logs.join('\n');
  for (const value of ['private-pass', 'another-pass', 'private-token', '654321',
    basic(), 'secret-cookie', 'private-header', 'testuser', generated.json.otp]) {
    assert.equal(output.includes(value), false, `Must not log ${value}`);
  }
  assert.match(logs[0], /password=%5BREDACTED%5D/);
  assert.match(logs[0], /Password=%5BREDACTED%5D/);
  assert.match(logs[0], /access_token=%5BREDACTED%5D/);
  assert.match(logs[0], /count=1/);
});

test('LOG_REQUESTS enables console logging for embedded apps', async t => {
  const logs = [];
  t.mock.method(console, 'log', line => logs.push(line));
  const { request } = await setup(t, { env: { LOG_REQUESTS: 'true' } });
  await request('/health');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^GET \/health -> 200 /);
});

test('request targets hide URL credentials and tolerate malformed URLs', () => {
  assert.equal(formatRequestTarget('http://user:password@host/health'), '/health');
  assert.equal(formatRequestTarget('http://['), '<invalid-url>');
  assert.equal(formatRequestTarget('/CICSSystemManagement/CICSProgram?CRITERIA=(PROGRAM=D*)'),
    '/CICSSystemManagement/CICSProgram?CRITERIA=(PROGRAM=D*)');
  assert.equal(formatRequestTarget('/health?password=a&password=b'), '/health?password=%5BREDACTED%5D');
});
