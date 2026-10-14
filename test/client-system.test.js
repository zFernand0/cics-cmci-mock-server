/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { parseArgs } = require('../scripts/test-client-system');

test('client system runner selects packages and forwards Jest options', () => {
  const options = parseArgs(['--client', '/tmp/client path', '--package', 'sdk', '--', '--runInBand', 'Get.resource']);
  assert.equal(options.client, '/tmp/client path');
  assert.equal(options.package, 'sdk');
  assert.deepEqual(options.jestArgs, ['--runInBand', 'Get.resource']);
  assert.equal(parseArgs([]).package, 'all');
  assert.equal(parseArgs(['--help']).help, true);
  for (const args of [['--unknown'], ['--package'], ['--client', '--package'], ['--package', 'invalid']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('client runner reports help and missing checkout without starting a listener', () => {
  const script = resolve(__dirname, '../scripts/test-client-system.js');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--package sdk\|cli\|all/);
  const missing = spawnSync(process.execPath, [script, '--client', '/nonexistent-cmci-test-checkout'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Cannot find installed CICS client workspace/);
});

function fakeClient(t, exitStatus = 0, wait = false) {
  const directory = mkdtempSync(join(tmpdir(), 'cmci client '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['sdk', 'cli']) {
    const packageDir = join(directory, 'packages', name);
    mkdirSync(join(packageDir, 'lib'), { recursive: true });
    writeFileSync(join(packageDir, 'system.jest_config.ts'), '');
    writeFileSync(join(packageDir, 'lib/imperative.js'), '');
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, scripts: { 'test:system': 'node check.js' } }));
    writeFileSync(join(packageDir, 'check.js'), `
      const fs = require('node:fs');
      const path = require('node:path');
      const assert = require('node:assert/strict');
      async function check() {
        const file = path.join(process.env.propdirectory, process.env.propfile);
        const { cics, cmci } = JSON.parse(fs.readFileSync(file));
        const url = 'http://' + cics.host + ':' + cics.port;
        const auth = 'Basic ' + Buffer.from(cics.user + ':' + cics.password).toString('base64');
        const resource = url + '/CICSSystemManagement/CICSDefinitionProgram/' + cmci.regionName;
        if (${JSON.stringify(name)} === 'sdk') {
          const created = await fetch(resource, { method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/xml' },
            body: '<request><create><attributes name="RUNNER" csdgroup="' + cmci.csdGroup + '"/></create></request>' });
          assert.match(await created.text(), /api_response1="1024"/);
        } else {
          const read = await fetch(resource + '?CRITERIA=(NAME=RUNNER)', { headers: { Authorization: auth } });
          assert.match(await read.text(), /name="RUNNER"/);
        }
        console.log('PROPERTIES ' + file);
        console.log('READY');
        if (${wait}) setInterval(() => {}, 1000);
        else process.exitCode = ${exitStatus};
      }
      check().catch(error => { console.error(error); process.exitCode = 1; });
    `);
  }
  return directory;
}

test('client runner serves real requests, shares state between packages and removes temporary properties', t => {
  const directory = fakeClient(t);
  const result = spawnSync(process.execPath, [resolve(__dirname, '../scripts/test-client-system.js'), '--client', directory],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Running existing SDK/);
  assert.match(result.stdout, /Running existing CLI/);
  const files = [...result.stdout.matchAll(/PROPERTIES (.+)/g)].map(match => match[1]);
  assert.equal(files.length, 2);
  assert.equal(files[0], files[1]);
  assert.equal(existsSync(files[0]), false);
});

test('client runner propagates a failing package status', t => {
  const directory = fakeClient(t, 3);
  const result = spawnSync(process.execPath,
    [resolve(__dirname, '../scripts/test-client-system.js'), '--client', directory, '--package', 'sdk'],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 3);
  assert.equal(existsSync(result.stdout.match(/PROPERTIES (.+)/)[1]), false);
});

test('client runner requires a built CLI', t => {
  const directory = fakeClient(t);
  rmSync(join(directory, 'packages/cli/lib/imperative.js'));
  const result = spawnSync(process.execPath,
    [resolve(__dirname, '../scripts/test-client-system.js'), '--client', directory, '--package', 'cli'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Build the CICS SDK and CLI/);
});

test('client runner stops its child command and cleans up on SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const directory = fakeClient(t, 0, true);
  const child = spawn(process.execPath,
    [resolve(__dirname, '../scripts/test-client-system.js'), '--client', directory, '--package', 'sdk'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let output = '';
  await new Promise((resolveReady, reject) => {
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('READY')) resolveReady();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Runner exited before READY: ' + output)));
  });
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [status] = await exited;
  assert.equal(status, 143);
  assert.equal(existsSync(output.match(/PROPERTIES (.+)/)[1]), false);
});
