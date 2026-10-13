/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, basic, tokenFrom } = require('./helpers');
const path = '/CICSSystemManagement/CICSProgram';

for (const auth of [null, 'Bearer invalid', 'Basic %%%', 'Basic bm9jb2xvbg==', basic('wrong', 'password'), basic('adminusr', 'adminpas:extra'), basic('testuser', 'testpass'), basic('adminusr', '')]) {
  test(`rejects missing or invalid credentials: ${auth}`, async t => {
    const { request } = await setup(t);
    const response = await request(path, { auth });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Basic/);
    assert.equal(typeof response.json.error, 'string');
  });
}

test('admin login sets a cookie and reuses a live session', async t => {
  const { request } = await setup(t);
  const first = await request(path);
  const second = await request(path, { auth: basic().replace('Basic', 'basic') });
  assert.equal(first.status, 200);
  assert.equal(tokenFrom(first), tokenFrom(second));
  const cookie = first.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
  const sessions = (await request('/admin/sessions')).json;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].username, 'adminusr');
});

for (const via of ['header', 'cookie']) {
  test(`authenticates with LtpaToken2 ${via}`, async t => {
    const { request } = await setup(t);
    const token = tokenFrom(await request(path));
    const headers = via === 'header' ? { LtpaToken2: token } : { Cookie: `LtpaToken2=${token}` };
    const response = await request(path, { auth: null, headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
  });
}

test('invalid token rejects alone but permits valid Basic fallback', async t => {
  const { request } = await setup(t);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: 'bad' } })).status, 401);
  assert.equal((await request(path, { headers: { LtpaToken2: 'bad' } })).status, 200);
});

test('session expires at its absolute deadline, even with recent activity', async t => {
  const { request, advance } = await setup(t, { config: { sessionTtlMs: 1000 } });
  const token = tokenFrom(await request(path));
  advance(999);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: token } })).status, 200);
  advance(1);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: token } })).status, 401);
  const health = (await request('/health', { auth: null })).json;
  assert.equal(health.activeSessions, 0);
  assert.equal(health.retainedResultSets, 0);
  assert.equal(health.ltpaTokens, 0);
  const renewed = await request(path);
  assert.notEqual(tokenFrom(renewed), token);
});

test('generates a five-minute OTP, reuses it before login, and consumes it once', async t => {
  const { request, advance } = await setup(t);
  const generate = () => request('/auth/generate-otp', { method: 'POST', auth: null,
    headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}' });
  assert.equal((await request('/auth/otp-status/testuser', { auth: null })).json.hasOTP, false);
  const first = (await generate()).json;
  assert.match(first.otp, /^\d{6}$/);
  assert.equal(first.expiresInSeconds, 300);
  assert.equal(first.isReused, false);
  advance(1000);
  const second = (await generate()).json;
  assert.equal(second.otp, first.otp);
  assert.equal(second.isReused, true);
  assert.equal(second.expiresInSeconds, 299);
  const status = (await request('/auth/otp-status/testuser', { auth: null })).json;
  assert.equal(status.hasOTP, true);
  assert.equal(status.timeRemainingSeconds, 299);
  assert.equal((await request(path, { auth: basic('testuser', '000000') })).status, 401);
  const login = await request(path, { auth: basic('testuser', first.otp) });
  assert.equal(login.status, 200);
  assert.equal((await request('/auth/otp-status/testuser', { auth: null })).json.hasOTP, false);
  assert.equal((await request(path, { auth: basic('testuser', first.otp) })).status, 401);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: tokenFrom(login) } })).status, 200);
});

test('OTP expires exactly at its configured deadline', async t => {
  const { request, advance } = await setup(t, { config: { otpTtlMs: 10 } });
  const generated = await request('/auth/generate-otp', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}' });
  advance(10);
  assert.equal((await request(path, { auth: basic('testuser', generated.json.otp) })).status, 401);
  assert.equal((await request('/auth/otp-status/testuser')).json.hasOTP, false);
  assert.equal((await request('/admin/otps')).json.count, 0);
});

test('reusable OTP mode is explicitly configurable', async t => {
  const { request, loginTestUser } = await setup(t, { config: { otpSingleUse: false } });
  const { otp, login } = await loginTestUser();
  assert.equal(login.status, 200);
  assert.equal((await request(path, { auth: basic('testuser', otp) })).status, 200);
  assert.equal((await request('/auth/otp-status/testuser')).json.hasOTP, true);
});

for (const body of [undefined, '{}', '{"username":null}', '{"username":[]}', '{"username":""}']) {
  test(`OTP generation validates username: ${body}`, async t => {
    const { request } = await setup(t);
    assert.equal((await request('/auth/generate-otp', { method: 'POST', auth: null,
      headers: { 'Content-Type': 'application/json' }, body })).status, 400);
  });
}

test('OTP endpoints reject unsupported usernames', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/auth/generate-otp', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{"username":"adminusr"}' })).status, 403);
  assert.equal((await request('/auth/otp-status/adminusr')).status, 403);
});

test('concurrent logins can consume a single-use OTP only once', async t => {
  const { request } = await setup(t);
  const generated = await request('/auth/generate-otp', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}' });
  const results = await Promise.all(Array.from({ length: 4 }, () => request(path, { auth: basic('testuser', generated.json.otp) })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401, 401, 401]);
});
