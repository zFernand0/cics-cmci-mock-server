/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, tokenFrom } = require('./helpers');
const path = '/CICSSystemManagement/CICSProgram';

test('all admin endpoints require admin authentication', async t => {
  const { request, loginTestUser } = await setup(t);
  const { token } = await loginTestUser();
  for (const endpoint of ['sessions', 'ltpa-tokens', 'cache', 'retained-results', 'otps']) {
    for (const method of ['GET', 'DELETE']) {
      assert.equal((await request(`/admin/${endpoint}`, { method, auth: null })).status, 401);
      assert.equal((await request(`/admin/${endpoint}`, { method, auth: null, headers: { LtpaToken2: token } })).status, 403);
    }
  }
  assert.equal((await request('/admin/retained-results/MISSING', { method: 'DELETE', auth: null })).status, 401);
});

test('monitoring reports live sessions, tokens, OTPs, results and legacy aliases', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=5&cache=true`);
  await request('/auth/generate-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}' });
  const sessions = (await request('/admin/sessions')).json;
  assert.equal(sessions.length, 1);
  const tokens = (await request('/admin/ltpa-tokens')).json;
  assert.equal(tokens.count, 1);
  assert.equal(tokens.ltpaTokens[0].ltpaToken2, tokenFrom(first));
  const retained = (await request('/admin/retained-results')).json;
  assert.equal(retained.count, 1);
  assert.equal(retained.retainedResultSets[0].totalRecords, 5);
  assert.equal(retained.retainedResultSets[0].isExpired, false);
  const legacy = (await request('/admin/cache')).json;
  assert.equal(legacy.legacyCacheCount, 1);
  assert.deepEqual(legacy.legacyCacheTokens, [first.summary.cachetoken]);
  const otps = (await request('/admin/otps')).json;
  assert.equal(otps.count, 1);
  assert.equal(otps.activeOTPs[0].timeRemainingSeconds, 300);
  assert.equal(otps.activeOTPs[0].otp, undefined);
  const health = (await request('/health', { auth: null })).json;
  assert.equal(health.status, 'healthy');
  assert.equal(health.cacheEntries, 1);
  assert.equal(health.cachedRecords, 5);
});

test('legacy cache clearing removes only legacy snapshots and allows fresh recreation', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=2`);
  const legacy = await request(`${path}?count=2&cache=true`);
  assert.equal(first.summary.cachetoken, legacy.summary.cachetoken);
  const retained = await request(`${path}?count=3`);
  const cleared = await request('/admin/cache', { method: 'DELETE' });
  assert.equal(cleared.json.count, 1);
  assert.equal((await request(`/CICSSystemManagement/CICSResultCache/${legacy.summary.cachetoken}`)).status, 404);
  assert.equal((await request(`/CICSSystemManagement/CICSResultCache/${retained.summary.cachetoken}?NODISCARD`)).status, 200);
  assert.notEqual((await request(`${path}?count=2`)).summary.cachetoken, legacy.summary.cachetoken);
});

test('individual and bulk result deletion maintain cache accounting', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=2`);
  await request(`${path}?count=3`);
  const deleted = await request(`/admin/retained-results/${first.summary.cachetoken}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request('/health')).json.cachedRecords, 3);
  assert.equal((await request('/admin/retained-results/MISSING', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/admin/retained-results', { method: 'DELETE' })).json.count, 1);
  assert.equal((await request('/health')).json.cachedRecords, 0);
  assert.notEqual((await request(`${path}?count=2`)).summary.cachetoken, first.summary.cachetoken);
});

test('token revocation invalidates cookies and Basic login issues a new token', async t => {
  const { request } = await setup(t);
  const first = await request(path);
  const oldToken = tokenFrom(first);
  assert.equal((await request('/admin/ltpa-tokens', { method: 'DELETE' })).json.count, 1);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: oldToken } })).status, 401);
  const second = await request(path);
  assert.notEqual(tokenFrom(second), oldToken);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: tokenFrom(second) } })).status, 200);
});

test('session reset invalidates tokens and every session-owned cache', async t => {
  const { request, loginTestUser } = await setup(t);
  const first = await request(path);
  await loginTestUser();
  const cleared = await request('/admin/sessions', { method: 'DELETE' });
  assert.equal(cleared.json.sessionCount, 2);
  assert.equal(cleared.json.ltpaTokenCount, 2);
  assert.equal(cleared.json.retainedResultSetsCount, 2);
  const health = (await request('/health', { auth: null })).json;
  assert.equal(health.activeSessions, 0);
  assert.equal(health.cachedRecords, 0);
  assert.equal((await request(path, { auth: null, headers: { LtpaToken2: tokenFrom(first) } })).status, 401);
  assert.equal((await request(`/CICSSystemManagement/CICSResultCache/${first.summary.cachetoken}`)).status, 404);
});

test('OTP clearing invalidates generated credentials', async t => {
  const { request } = await setup(t);
  await request('/auth/generate-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"testuser"}' });
  assert.equal((await request('/admin/otps', { method: 'DELETE' })).json.count, 1);
  assert.equal((await request('/auth/otp-status/testuser')).json.hasOTP, false);
});

test('app instances have independent authentication and cache state', async t => {
  const first = await setup(t);
  const second = await setup(t);
  const login = await first.request(path);
  assert.equal((await second.request(path, { auth: null, headers: { LtpaToken2: tokenFrom(login) } })).status, 401);
  assert.equal((await second.request(`/CICSSystemManagement/CICSResultCache/${login.summary.cachetoken}`)).status, 404);
});
