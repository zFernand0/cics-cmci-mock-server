/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { homedir, tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config');

function parseArgs(args) {
  const options = { client: join(homedir(), 'gh/zowe/cics'), package: 'all', jestArgs: [] };
  while (args.length) {
    const argument = args.shift();
    if (argument === '--') { options.jestArgs = args; break; }
    if (argument === '--help') { options.help = true; break; }
    if (!['--client', '--package'].includes(argument) || !args.length || args[0].startsWith('--')) {
      throw new Error('Use --client PATH, --package sdk|cli|all, and -- before Jest options');
    }
    options[argument.slice(2)] = args.shift();
  }
  if (!['sdk', 'cli', 'all'].includes(options.package)) throw new Error('--package must be sdk, cli, or all');
  options.client = resolve(options.client);
  return options;
}

async function run(options) {
  const packages = options.package === 'all' ? ['sdk', 'cli'] : [options.package];
  for (const name of packages) {
    const directory = join(options.client, 'packages', name);
    if (!existsSync(join(directory, 'system.jest_config.ts')) || !existsSync(join(options.client, 'node_modules'))) {
      throw new Error(`Cannot find installed CICS client workspace at ${directory}. Run npm ci in the client repo first.`);
    }
    if (name === 'cli' && !existsSync(join(directory, 'lib/imperative.js'))) {
      throw new Error('Build the CICS SDK and CLI packages before running CLI system tests. See README.md.');
    }
  }
  const config = createConfig({ stateful: true, host: '127.0.0.1', port: 0 }, process.env);
  const temporary = mkdtempSync(join(tmpdir(), 'cmci-client-tests-'));
  const server = createApp({ config }).listen(0, config.host);
  let child;
  let interrupted = false;
  const interrupt = signal => {
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    if (child) {
      if (process.platform === 'win32') child.kill(signal);
      else {
        try { process.kill(-child.pid, signal); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    await once(server, 'listening');
    const port = server.address().port;
    const properties = {
      cics: { user: 'adminusr', password: 'adminpas', host: config.host, port, protocol: 'http', rejectUnauthorized: false },
      cmci: { regionName: config.regions.split(',')[0].trim().toUpperCase(), csdGroup: config.csdGroup },
      urimap: { certificate: ' ' }
    };
    // JSON is valid YAML; keep properties outside the client checkout.
    writeFileSync(join(temporary, 'mock_properties.yaml'), JSON.stringify(properties, null, 2));
    const env = { ...process.env, propdirectory: temporary + sep, propfile: 'mock_properties.yaml' };
    // Jest sets FORCE_COLOR for child commands; avoid Node's conflicting-color warning on stderr.
    delete env.NO_COLOR;
    console.log(`Stateful CMCI mock: http://${config.host}:${port}, region ${properties.cmci.regionName}, group ${config.csdGroup}`);
    for (const name of packages) {
      if (interrupted) break;
      console.log(`Running existing ${name.toUpperCase()} system tests in ${options.client}`);
      const status = await new Promise((resolveStatus, reject) => {
        child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',
          ['run', 'test:system', '--', ...options.jestArgs], {
            cwd: join(options.client, 'packages', name), env, stdio: 'inherit', detached: process.platform !== 'win32'
          });
        child.once('error', error => { child = undefined; reject(error); });
        child.once('exit', code => { child = undefined; resolveStatus(code ?? 1); });
      });
      if (status !== 0 && !interrupted) process.exitCode = status;
    }
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    await new Promise(resolveClosed => {
      server.close(resolveClosed);
      server.closeAllConnections();
    });
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs([...args]);
  if (options.help) {
    console.log('npm run test:client -- [--client PATH] [--package sdk|cli|all] [-- JEST_OPTIONS]');
    console.log('Starts an isolated stateful mock, supplies temporary mock properties, and runs the existing client system tests.');
    return;
  }
  await run(options);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main, parseArgs };
