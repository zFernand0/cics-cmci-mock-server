/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, records } = require('./helpers');
const path = '/CICSSystemManagement/CICSManagedRegion';
const cached = token => `/CICSSystemManagement/CICSResultCache/${token}`;

test('cache path paginates the original resource and keeps total counts', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=8&NODISCARD`);
  const token = first.summary.cachetoken;
  const page = await request(`${cached(token)}/4/2?NODISCARD`);
  assert.equal(page.status, 200);
  assert.equal(page.summary.recordcount, '8');
  assert.equal(page.summary.displayed_recordcount, '2');
  assert.equal(page.summary.cachetoken, token);
  assert.deepEqual(records(page, 'cicsmanagedregion'), records(first, 'cicsmanagedregion').slice(3, 5));
  const remaining = await request(`${cached(token)}/7?NODISCARD`);
  assert.equal(remaining.summary.displayed_recordcount, '2');
  const queried = await request(`${cached(token)}?index=3&count=1&NODISCARD`);
  assert.equal(records(queried, 'cicsmanagedregion')[0].applid, 'REGION3');
});

test('query cache pagination and mixed-case flags share the same implementation', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=5`);
  const page = await request(`${path}?cacheToken=${first.summary.cachetoken}&INDEX=2&COUNT=2&NoDiscard`);
  assert.equal(page.status, 200);
  assert.equal(page.summary.recordcount, '5');
  assert.deepEqual(records(page, 'cicsmanagedregion').map(record => record.applid), ['REGION2', 'REGION3']);
});

test('identical GETs reuse both the cache token and exact records', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=4`);
  const second = await request(`${path}?COUNT=4&NODISCARD&ORDERBY=applid`);
  assert.equal(first.summary.cachetoken, second.summary.cachetoken);
  assert.deepEqual(records(first, 'cicsmanagedregion'), records(second, 'cicsmanagedregion'));
  const summary = await request(`${path}?count=4&SUMMONLY`);
  assert.equal(summary.summary.cachetoken, first.summary.cachetoken);
  assert.equal(summary.summary.recordcount, '4');
  assert.equal(summary.summary.displayed_recordcount, '0');
  assert.equal(summary.xml.records, undefined);
  assert.equal((await request('/health')).json.retainedResultSets, 1);
});

test('SUMMONLY on a retained set reports zero displayed records and discards without NODISCARD', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=8&SUMMONLY`);
  const final = await request(`${cached(first.summary.cachetoken)}?SUMMONLY`);
  assert.equal(final.summary.recordcount, '8');
  assert.equal(final.summary.displayed_recordcount, '0');
  assert.equal(final.summary.cachetoken, undefined);
  assert.equal(final.xml.records, undefined);
  assert.equal((await request(cached(first.summary.cachetoken))).status, 404);
});

test('page beyond the end never reports a negative displayed count', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=3`);
  const page = await request(`${cached(first.summary.cachetoken)}/100/2?NODISCARD`);
  assert.equal(page.summary.recordcount, '3');
  assert.equal(page.summary.displayed_recordcount, '0');
  assert.deepEqual(records(page, 'cicsmanagedregion'), []);
});

test('cache expiry is checked at the idle deadline and successful reads refresh it', async t => {
  const { request, advance } = await setup(t, { config: { cacheTtlMs: 1000 } });
  const first = await request(`${path}?count=3`);
  const token = first.summary.cachetoken;
  advance(999);
  assert.equal((await request(`${cached(token)}?NODISCARD`)).status, 200);
  advance(999);
  assert.equal((await request(`${cached(token)}?NODISCARD`)).status, 200);
  advance(1000);
  const expired = await request(`${cached(token)}?NODISCARD`);
  assert.equal(expired.status, 404);
  assert.equal(expired.summary.api_response1_alt, 'NOTAVAILABLE');
  const health = (await request('/health')).json;
  assert.equal(health.retainedResultSets, 0);
  assert.equal(health.cachedRecords, 0);
  assert.notEqual((await request(`${path}?count=3`)).summary.cachetoken, token);
});

test('path misses are always 404; query misses regenerate with a usable new token', async t => {
  const { request } = await setup(t);
  assert.equal((await request(`${cached('MISSING')}/1/2`)).status, 404);
  const fallback = await request(`${path}?cachetoken=MISSING&count=4`);
  assert.equal(fallback.status, 200);
  assert.ok(fallback.summary.cachetoken);
  assert.equal(fallback.summary.recordcount, '4');
  assert.equal((await request(cached(fallback.summary.cachetoken))).status, 200);
});

test('strict query-cache mode rejects misses and expired entries', async t => {
  const { request, advance } = await setup(t, { config: { cacheMissFallback: false, cacheTtlMs: 10 } });
  assert.equal((await request(`${path}?cachetoken=MISSING`)).status, 404);
  const first = await request(path);
  advance(10);
  assert.equal((await request(`${path}?cachetoken=${first.summary.cachetoken}`)).status, 404);
});

test('both cache routes reject another authenticated user', async t => {
  const { request, loginTestUser } = await setup(t);
  const first = await request(`${path}?count=4&cache=true`);
  const { token } = await loginTestUser();
  const options = { auth: null, headers: { LtpaToken2: token } };
  assert.equal((await request(`${cached(first.summary.cachetoken)}/1/2?NODISCARD`, options)).status, 403);
  assert.equal((await request(`${path}?cachetoken=${first.summary.cachetoken}`, options)).status, 403);
  assert.equal((await request(`${cached(first.summary.cachetoken)}?NODISCARD`)).status, 200);
});

test('query cache cannot cross resource types or CICS contexts', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}/PLEX1?count=3`);
  const token = first.summary.cachetoken;
  assert.equal((await request(`/CICSSystemManagement/CICSProgram/PLEX1?cachetoken=${token}`)).status, 404);
  assert.equal((await request(`${path}/PLEX2?cachetoken=${token}`)).status, 404);
  const second = await request(`${path}/PLEX2?count=3`);
  assert.notEqual(second.summary.cachetoken, token);
});

test('concurrent readers retrieve disjoint pages from one retained snapshot', async t => {
  const { request } = await setup(t);
  const first = await request(`${path}?count=20`);
  const pages = await Promise.all([1, 6, 11, 16].map(index => request(`${cached(first.summary.cachetoken)}/${index}/5?NODISCARD`)));
  assert.ok(pages.every(page => page.status === 200 && page.summary.recordcount === '20'));
  assert.deepEqual(pages.flatMap(page => records(page, 'cicsmanagedregion')), records(first, 'cicsmanagedregion'));
});

test('LRU eviction removes the least recently used set and its request index', async t => {
  const { request } = await setup(t, { config: { maxResultSets: 2 } });
  const first = await request(`${path}?count=1`);
  const second = await request(`${path}?count=2`);
  await request(`${cached(first.summary.cachetoken)}?NODISCARD`);
  await request(`${path}?count=3`);
  assert.equal((await request(cached(second.summary.cachetoken))).status, 404);
  assert.equal((await request(`${cached(first.summary.cachetoken)}?NODISCARD`)).status, 200);
  assert.notEqual((await request(`${path}?count=2`)).summary.cachetoken, second.summary.cachetoken);
  assert.equal((await request('/health')).json.retainedResultSets, 2);
});

test('record budget evicts snapshots before exceeding the memory bound', async t => {
  const { request } = await setup(t, { config: { maxRecords: 6, maxCachedRecords: 6 } });
  const first = await request(`${path}?count=4`);
  const second = await request(`${path}?count=5`);
  assert.equal((await request(cached(first.summary.cachetoken))).status, 404);
  assert.equal((await request('/health')).json.cachedRecords, 5);
  await request(cached(second.summary.cachetoken), { method: 'DELETE' });
  assert.equal((await request('/health')).json.cachedRecords, 0);
});

test('strict retention mode creates a cache only when requested', async t => {
  const { request } = await setup(t, { config: { autoCache: false } });
  assert.equal((await request(path)).summary.cachetoken, undefined);
  assert.ok((await request(`${path}?NODISCARD`)).summary.cachetoken);
  assert.ok((await request(`${path}?count=2&cache=true`)).summary.cachetoken);
});

for (const suffix of ['/0/2', '/-1/2', '/abc/2', '/1/0', '/1/2.5', '/1/2junk', '/1/10001', '/1/2/extra']) {
  test(`invalid cache path does not consume a valid set: ${suffix}`, async t => {
    const { request } = await setup(t);
    const first = await request(path);
    const token = first.summary.cachetoken;
    const invalid = await request(cached(token) + suffix);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.summary.api_response1_alt, 'INVALIDPARM');
    assert.equal((await request(`${cached(token)}?NODISCARD`)).status, 200);
  });
}

test('explicit cache DELETE removes the set and POST/PUT are rejected', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/CICSSystemManagement/CICSResultCache')).status, 400);
  const first = await request(path);
  const cachePath = cached(first.summary.cachetoken);
  for (const method of ['POST', 'PUT']) assert.equal((await request(cachePath, { method })).status, 405);
  assert.equal((await request(cachePath, { method: 'DELETE' })).status, 200);
  assert.equal((await request(cachePath)).status, 404);
});
