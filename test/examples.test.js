/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { setup } = require('./helpers');

for (const example of ['test-client.js', 'retained-result-sets-demo.js']) {
  test(`documented example completes against an isolated server: ${example}`, { timeout: 10000 }, async t => {
    const { url } = await setup(t);
    const child = spawn(process.execPath, [resolve(__dirname, '../examples', example)], {
      env: { ...process.env, MOCK_SERVER_URL: url }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 0, output);
    assert.match(output, /completed successfully|tests passed/i);
  });
}
