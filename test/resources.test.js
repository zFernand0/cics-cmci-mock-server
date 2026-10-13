/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, records } = require('./helpers');
const { RESOURCE_TYPES } = require('../src/resources');
const path = '/CICSSystemManagement/CICSProgram';

for (const [type, name] of Object.entries(RESOURCE_TYPES).filter(([type]) => type !== 'cicsresultcache')) {
  test(`returns parseable XML and stable identities for ${name}`, async t => {
    const { request } = await setup(t);
    const response = await request(`/CICSSystemManagement/${name}?count=2`);
    assert.equal(response.status, 200);
    assert.equal(response.summary.api_function, 'GET');
    assert.equal(response.summary.api_response1, '1024');
    assert.equal(response.summary.api_response2, '0');
    assert.equal(response.summary.recordcount, '2');
    assert.equal(records(response, type).length, 2);
    assert.ok(records(response, type).every(record => /^[A-F0-9]+$/.test(record._keydata)));
  });
}

test('program resources have program attributes and a single record is valid XML', async t => {
  const { request, url } = await setup(t);
  const response = await request(`${path}?count=1`);
  assert.equal(records(response, 'cicsprogram')[0].program, 'PROG001');
  assert.equal(records(response, 'cicsprogram')[0].language, 'COBOL');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.ok(response.xml.$['xsi:schemaLocation'].includes(url));
});

test('zero count is NODATA and allocates no retained results', async t => {
  const { request } = await setup(t);
  const response = await request(`${path}?count=0`);
  assert.equal(response.summary.api_response1_alt, 'NODATA');
  assert.equal(response.summary.recordcount, '0');
  assert.equal(response.summary.displayed_recordcount, '0');
  assert.equal(response.summary.cachetoken, undefined);
  assert.equal(response.xml.records, undefined);
  assert.equal((await request('/health')).json.retainedResultSets, 0);
});

for (const query of ['count=-1', 'count=NaN', 'count=1.5', 'count=2junk', 'count=', 'count=10001',
  'index=0', 'index=-1', 'index=9007199254740992', 'count=1&count=2', 'count=1&COUNT=2',
  'count[x]=2', 'ORDERBY=', 'orderby=a,,b', 'orderby=name/X', 'orderby=' + Array(33).fill('name').join(','), 'cachetoken=']) {
  test(`invalid query returns a CMCI parameter error: ${query}`, async t => {
    const { request } = await setup(t);
    const response = await request(`${path}?${query}`);
    assert.equal(response.status, 400);
    assert.equal(response.summary.api_response1_alt, 'INVALIDPARM');
    assert.equal(response.summary.recordcount, '0');
  });
}

test('unknown resources, empty paths and invalid encodings are rejected', async t => {
  const { request } = await setup(t);
  for (const suffix of ['DoesNotExist', 'constructor', '__proto__']) {
    assert.equal((await request(`/CICSSystemManagement/${suffix}`)).status, 404);
  }
  assert.equal((await request('/CICSSystemManagement')).status, 400);
  assert.equal((await request('/CICSSystemManagement/%ZZ')).status, 400);
  assert.equal((await request('/does-not-exist')).status, 404);
});

test('unsupported methods return 405 with allowed methods', async t => {
  const { request } = await setup(t);
  const response = await request(path, { method: 'PATCH' });
  assert.equal(response.status, 405);
  assert.match(response.headers.get('allow'), /GET/);
});

for (const [name, code] of [['nodata', '1027'], ['invalidparm', '1028'], ['notavailable', '1034'], ['invaliddata', '1041']]) {
  test(`simulates CMCI ${name} without allocating data`, async t => {
    const { request } = await setup(t);
    const response = await request(`${path}?simulate=${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.summary.api_response1, code);
    assert.equal(response.summary.api_response1_alt, name.toUpperCase());
    assert.equal(response.summary.recordcount, '0');
    assert.equal(response.xml.records, undefined);
    assert.equal((await request('/health')).json.cachedRecords, 0);
  });
}

test('simulation validates names and supports OK', async t => {
  const { request } = await setup(t);
  assert.equal((await request(`${path}?simulate=unknown`)).status, 400);
  assert.equal((await request(`${path}?simulate=OK`)).summary.api_response1, '1024');
});

const payload = '<request><create><parameter name="CSD"><cicsdefinitionprogram program="MYPROG"/></parameter></create></request>';
for (const contentType of ['application/xml', 'text/xml', 'application/vnd.ibm.cmci+xml']) {
  test(`validates XML creation requests with ${contentType}`, async t => {
    const { request } = await setup(t);
    const response = await request('/CICSSystemManagement/CICSDefinitionProgram', {
      method: 'POST', headers: { 'Content-Type': contentType }, body: payload });
    assert.equal(response.status, 200);
    assert.equal(response.summary.api_function, 'POST');
    assert.equal(response.summary.recordcount, '1');
    assert.equal(response.summary.displayed_recordcount, '0');
  });
}

for (const body of ['', ' ', '<request><broken>', '<other/>', '<request/><extra/>', '<request/>trailing',
  '<request/><request/>', '<request>&undefined;</request>', '<!DOCTYPE request [<!ENTITY x "test">]><request>&x;</request>']) {
  test(`rejects malformed or unsupported XML: ${body}`, async t => {
    const { request } = await setup(t);
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });
    assert.equal(response.status, 400);
    assert.equal(response.summary.api_response1_alt, 'INVALIDDATA');
  });
}

test('non-XML mutation requests and oversized bodies fail without a 500', async t => {
  const { request } = await setup(t, { config: { bodyLimit: '32b' } });
  assert.equal((await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
  const tooLarge = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: payload });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.summary.api_response1_alt, 'INVALIDDATA');
  assert.equal((await request('/auth/generate-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
});

test('PUT validates provided XML while supporting empty PUT and DELETE acknowledgements', async t => {
  const { request } = await setup(t);
  assert.equal((await request(path, { method: 'PUT' })).status, 200);
  assert.equal((await request(path, { method: 'PUT', headers: { 'Content-Type': 'application/xml' }, body: '<request/>' })).status, 200);
  assert.equal((await request(path, { method: 'PUT', headers: { 'Content-Type': 'application/xml' }, body: '<bad>' })).status, 400);
  assert.equal((await request(path, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '<request/>' })).status, 415);
  assert.equal((await request(path, { method: 'POST' })).status, 415);
  const deleted = await request(path, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.summary.api_function, 'DELETE');
});

test('fixtures support multicolumn ascending/descending sorts without changing source order', async t => {
  const input = [
    { program: 'B', status: 'ENABLED', desc: 'A & B < "C"' },
    { program: 'C', status: 'DISABLED' },
    { program: 'A', status: 'ENABLED' }
  ];
  const { request, url } = await setup(t, { fixtures: { CICSProgram: input } });
  input[0].program = 'MUTATED';
  const first = await request(path);
  assert.deepEqual(records(first, 'cicsprogram').map(record => record.program), ['B', 'C', 'A']);
  assert.equal(records(first, 'cicsprogram')[0].desc, 'A & B < "C"');
  assert.ok(first.xml.$['xsi:schemaLocation'].includes(url));
  const sorted = await request(`${path}?ORDERBY=status,PROGRAM/D`);
  assert.deepEqual(records(sorted, 'cicsprogram').map(record => record.program), ['C', 'B', 'A']);
  const page = await request(`/CICSSystemManagement/CICSResultCache/${first.summary.cachetoken}/2/1?NODISCARD&orderby=program/A`);
  assert.equal(records(page, 'cicsprogram')[0].program, 'B');
  const original = await request(`${path}?cachetoken=${first.summary.cachetoken}&NODISCARD`);
  assert.deepEqual(records(original, 'cicsprogram').map(record => record.program), ['B', 'C', 'A']);
});

test('fixture counts cap the available data and empty fixtures report NODATA', async t => {
  const { request } = await setup(t, { fixtures: { CICSProgram: [{ program: 'ONLY', usecount: 0, resident: false }], CICSRegion: [] } });
  const response = await request(`${path}?count=10`);
  assert.equal(response.summary.recordcount, '1');
  assert.equal(records(response, 'cicsprogram')[0].usecount, '0');
  assert.equal(records(response, 'cicsprogram')[0].resident, 'false');
  assert.equal((await request('/CICSSystemManagement/CICSRegion')).summary.api_response1_alt, 'NODATA');
});

test('CORS preflight supports browser clients', async t => {
  const { request } = await setup(t);
  const response = await request(path, { method: 'OPTIONS', auth: null,
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('internal errors hide their details and use the appropriate response format', async t => {
  const errors = [];
  const { request } = await setup(t, { now: () => { throw new Error('private details'); }, logger: { error: (...args) => errors.push(args) } });
  const xml = await request(path);
  assert.equal(xml.status, 500);
  assert.equal(xml.summary.api_response2_alt, 'Internal server error');
  assert.ok(!xml.body.includes('private details'));
  const json = await request('/health');
  assert.equal(json.status, 500);
  assert.equal(json.json.error, 'Internal server error');
  assert.equal(errors.length, 2);
});
