/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const { once } = require('node:events');
const xml2js = require('xml2js');
const { createApp } = require('../src/app');

const basic = (username = 'adminusr', password = 'adminpas') => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

async function setup(t, options = {}) {
  let time = Date.parse('2026-01-01T00:00:00Z');
  const app = createApp({ now: () => time, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { auth = basic(), headers = {}, ...init } = {}) {
    const response = await fetch(`${url}${path}`, {
      ...init, headers: { ...(auth ? { Authorization: auth } : {}), ...headers },
      signal: AbortSignal.timeout(5000)
    });
    const body = await response.text();
    const result = { status: response.status, headers: response.headers, body };
    if (response.headers.get('content-type')?.includes('application/xml')) {
      result.xml = (await xml2js.parseStringPromise(body, { explicitArray: false })).response;
      result.summary = result.xml.resultsummary.$;
    } else if (response.headers.get('content-type')?.includes('application/json')) result.json = JSON.parse(body);
    return result;
  }
  async function loginTestUser() {
    const generated = await request('/auth/generate-otp', { method: 'POST',
      auth: null, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'testuser' }) });
    const login = await request('/CICSSystemManagement/CICSProgram', { auth: basic('testuser', generated.json.otp) });
    return { login, otp: generated.json.otp, token: tokenFrom(login) };
  }
  return { app, server, url, request, loginTestUser, advance: ms => { time += ms; } };
}

function tokenFrom(response) {
  return response.headers.get('set-cookie').match(/LtpaToken2=([^;]+)/)[1];
}

function records(response, type) {
  const data = response.xml.records?.[type];
  return data ? (Array.isArray(data) ? data : [data]).map(record => record.$) : [];
}

module.exports = { setup, basic, records, tokenFrom };
