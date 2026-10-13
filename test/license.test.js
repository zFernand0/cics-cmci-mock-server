/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { processFile } = require('../scripts/add-license-headers');

test('license check fails for missing headers without modifying files', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmci-license-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'sample.js');
  const source = 'module.exports = 1;\n';
  writeFileSync(path, source);
  const check = () => spawnSync(process.execPath, [resolve(__dirname, '../scripts/add-license-headers.js'), path, '--dry-run'], { encoding: 'utf8' });
  assert.equal(check().status, 1);
  assert.equal(readFileSync(path, 'utf8'), source);
  processFile(path);
  assert.match(readFileSync(path, 'utf8'), /SPDX-License-Identifier: Apache-2.0/);
  assert.equal(check().status, 0);
});

test('adding a shell header preserves the executable shebang', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmci-license-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'sample.sh');
  writeFileSync(path, '#!/usr/bin/env bash\necho hello\n');
  processFile(path);
  const content = readFileSync(path, 'utf8');
  assert.equal(content.split('\n')[0], '#!/usr/bin/env bash');
  assert.equal(content.match(/#!/g).length, 1);
  assert.ok(content.includes('SPDX-License-Identifier'));
  assert.ok(content.endsWith('echo hello\n'));
});
