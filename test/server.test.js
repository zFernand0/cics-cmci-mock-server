/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { startServer, createApp } = require('../server');
const { setup } = require('./helpers');

test('importing the module starts no sockets or timers and retains the Express export', () => {
  const result = spawnSync(process.execPath, ['-e', "const app = require('./server'); console.log(typeof app, typeof app.createApp)"],
    { cwd: resolve(__dirname, '..'), timeout: 3000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function function');
  assert.equal(typeof createApp, 'function');
});

test('startServer honors environment settings and removes signal handlers on close', async t => {
  const logs = [];
  const signals = process.listenerCount('SIGTERM');
  const server = startServer({ env: { PORT: '0', DEFAULT_COUNT: '1' }, logger: { log: message => logs.push(message), error: assert.fail } });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, 'listening');
  assert.equal(process.listenerCount('SIGTERM'), signals + 1);
  assert.ok(logs[0].includes(`:${server.address().port}`));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  await response.text();
  await new Promise(resolve => server.close(resolve));
  assert.equal(process.listenerCount('SIGTERM'), signals);
});

test('CLI rejects invalid configuration with a helpful error', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: resolve(__dirname, '..'), env: { ...process.env, PORT: 'invalid' }, timeout: 3000, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT must be an integer/);
});

test('CLI exits cleanly after SIGTERM', async t => {
  const child = spawn(process.execPath, ['server.js'], { cwd: resolve(__dirname, '..'), env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child.stdout, 'data');
  const closed = once(child, 'exit');
  child.kill('SIGTERM');
  const [code, signal] = await closed;
  assert.equal(code, 0);
  assert.equal(signal, null);
});

test('startServer reports port collisions and leaves no signal handlers', async t => {
  const { server: occupied } = await setup(t);
  const logs = [];
  const signals = process.listenerCount('SIGTERM');
  const server = startServer({ env: { PORT: String(occupied.address().port) }, logger: { log: assert.fail, error: message => logs.push(message) } });
  await new Promise(resolve => server.once('error', resolve));
  assert.match(logs[0], /Cannot start CMCI mock server.*EADDRINUSE/);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  server.close();
  await once(server, 'close');
  assert.equal(process.listenerCount('SIGTERM'), signals);
});
