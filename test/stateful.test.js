/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, records } = require('./helpers');
const { parseCriteria, parseGroup } = require('../src/criteria');

const root = '/CICSSystemManagement';
const xml = (method, body) => ({ method, headers: { 'Content-Type': 'application/xml' }, body });
const create = (name = 'TEST', group = 'MOCKGRP') =>
  `<request><create><attributes name="${name}" csdgroup="${group}" status="DISABLED"/></create></request>`;
const action = name => `<request><action name="${name}"/></request>`;

test('criteria supports nested conjunctions, quoting, case insensitive values and literal metacharacters', () => {
  const predicate = parseCriteria("((NAME=='A.*') AND (STATUS=enabled))");
  assert.equal(predicate({ name: 'a.program', status: 'ENABLED' }), true);
  assert.equal(predicate({ name: 'another', status: 'ENABLED' }), false);
  assert.equal(predicate({ name: 'a.program', status: 'DISABLED' }), false);
  assert.equal(parseCriteria('(PROGRAM=D*)')({ program: 'DFHBRCV' }), true);
  assert.equal(parseCriteria('name="A+B"')({ name: 'A+B' }), true);
  assert.equal(parseCriteria('name=X')({}), false);
  assert.equal(parseCriteria('name=*B*D*')({ name: 'ABCDEFG' }), true);
  assert.equal(parseCriteria('name=*B*X*')({ name: 'ABCDEFG' }), false);
  assert.equal(parseCriteria('name=A*A')({ name: 'A' }), false);
  assert.equal(parseCriteria('name=A*B')({ name: 'AXC' }), false);
  assert.equal(parseCriteria('name=***')({ name: 'ANYTHING' }), true);
  assert.equal(parseCriteria(undefined)({}), true);
  assert.equal(parseGroup('csdgroup(group1)'), 'GROUP1');
  assert.equal(parseGroup(undefined), undefined);
  for (const expression of ['', 'NAME!=X', '(NAME=X', 'NAME=X OR NAME=Y', 'NAME=X garbage',
    'NAME=', 'x'.repeat(4097), '('.repeat(34) + 'NAME=X' + ')'.repeat(34)]) {
    assert.throws(() => parseCriteria(expression), /CRITERIA/);
  }
  assert.throws(() => parseGroup('other(group)'), /CSDGROUP/);
});

for (const [definition, runtime, identity] of [
  ['CICSDefinitionProgram', 'CICSProgram', 'program'],
  ['CICSDefinitionTransaction', 'CICSLocalTransaction', 'tranid'],
  ['CICSDefinitionURIMap', 'CICSURIMap', 'name'],
  ['CICSDefinitionWebService', 'CICSWebService', 'name'],
  ['CICSDefinitionBundle', 'CICSBundle', 'name']
]) {
  test(`stateful ${definition}: create, duplicate, install, update, discard and delete`, async t => {
    const { request } = await setup(t, { config: { stateful: true } });
    const path = `${root}/${definition}/REGION1`;
    const selected = `${path}?CRITERIA=(NAME=TEST)&PARAMETER=CSDGROUP(MOCKGRP)`;
    assert.equal((await request(path, xml('POST', create()))).summary.api_response1_alt, 'OK');
    const duplicate = await request(path, xml('POST', create()));
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.summary.api_response1_alt, 'TABLEERROR');
    assert.equal(duplicate.summary.api_response2, '1361');
    assert.equal(duplicate.xml.errors.feedback.$.resp_alt, 'DUPRES');
    const defined = records(await request(selected), definition.toLowerCase());
    assert.equal(defined.length, 1);
    assert.equal(defined[0].name, 'TEST');
    assert.equal(defined[0].eyu_cicsname, 'REGION1');
    assert.equal((await request(selected, xml('PUT', action('CSDINSTALL')))).summary.api_response1_alt, 'OK');
    const installed = `${root}/${runtime}/REGION1?CRITERIA=(${identity}=TEST)`;
    const initial = records(await request(installed), runtime.toLowerCase())[0];
    assert.equal(initial[identity], 'TEST');
    assert.equal(initial.enablestatus, 'DISABLED');
    assert.equal((await request(installed, xml('PUT', '<request><update><attributes ENABLESTATUS="ENABLED"/></update></request>'))).summary.api_response1_alt, 'OK');
    const updated = records(await request(installed), runtime.toLowerCase())[0];
    assert.equal(updated.enablestatus, 'ENABLED');
    assert.equal(updated._keydata, initial._keydata);
    // Reinstall updates the existing runtime resource without duplicating it.
    await request(selected, xml('PUT', action('CSDINSTALL')));
    assert.equal(records(await request(installed), runtime.toLowerCase()).length, 1);
    const reinstalled = records(await request(installed), runtime.toLowerCase())[0];
    assert.equal(reinstalled.enablestatus, 'DISABLED');
    assert.equal(reinstalled._keydata, initial._keydata);
    assert.equal((await request(installed, { method: 'DELETE' })).summary.api_response1_alt, 'OK');
    assert.equal((await request(installed)).summary.api_response1_alt, 'NODATA');
    assert.equal(records(await request(selected), definition.toLowerCase()).length, 1);
    assert.equal((await request(selected, { method: 'DELETE' })).summary.api_response1_alt, 'OK');
    assert.equal((await request(selected, { method: 'DELETE' })).summary.api_response1_alt, 'NODATA');
  });
}

test('stateful CSD memberships support add, duplicate and remove with compound criteria', async t => {
  const { request } = await setup(t, { config: { stateful: true } });
  const group = `${root}/CICSCSDGroup/REGION1?CRITERIA=(NAME=='MOCKGRP')`;
  const body = '<request><action name="CSDADD"><parameter name="TO_CSDLIST" value="LIST1"/></action></request>';
  assert.equal((await request(group, xml('PUT', body))).summary.api_response1_alt, 'OK');
  assert.equal((await request(group, xml('PUT', body))).xml.errors.feedback.$.resp_alt, 'DUPRES');
  const members = `${root}/CICSCSDGroupInList/REGION1?CRITERIA=((CSDLIST=='LIST1') AND (CSDGROUP=='MOCKGRP'))`;
  assert.equal(records(await request(members), 'cicscsdgroupinlist').length, 1);
  assert.equal((await request(members, { method: 'DELETE' })).summary.api_response1_alt, 'OK');
  assert.equal((await request(members, { method: 'DELETE' })).summary.api_response1_alt, 'NODATA');
  assert.equal((await request(group, xml('PUT', action('CSDADD')))).summary.api_response1_alt, 'INVALIDPARM');
  assert.equal((await request(group, xml('PUT', '<request><action name="CSDADD"><parameter name="BAD" value="X"/></action></request>'))).summary.api_response1_alt, 'INVALIDPARM');
});

test('stateful regions and CSD groups isolate resources; unknown regions return CMCI INVALIDPARM', async t => {
  const { request } = await setup(t, { config: { stateful: true, regions: 'REGION1,REGION2', defaultCount: 0 } });
  for (const region of ['REGION1', 'REGION2']) {
    for (const group of ['GROUP1', 'GROUP2']) {
      assert.equal((await request(`${root}/CICSDefinitionProgram/${region}`, xml('POST', create('SAME', group)))).summary.api_response1_alt, 'OK');
    }
  }
  const path = `${root}/CICSDefinitionProgram/PLEX1/REGION1?PARAMETER=CSDGROUP(GROUP1)`;
  assert.equal(records(await request(path), 'cicsdefinitionprogram').length, 1);
  await request(path, { method: 'DELETE' });
  assert.equal((await request(path)).summary.api_response1_alt, 'NODATA');
  assert.equal(records(await request(`${root}/CICSDefinitionProgram/REGION2`), 'cicsdefinitionprogram').length, 2);
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const response = await request(`${root}/CICSDefinitionProgram/FAKE`, method === 'GET'
      ? {} : method === 'DELETE' ? { method } : xml(method, method === 'POST' ? create() : action('CSDINSTALL')));
    assert.equal(response.status, 200);
    assert.equal(response.summary.api_response1_alt, 'INVALIDPARM');
  }
  assert.equal((await request(`${root}/CICSProgram/A/B/C`)).summary.api_response1_alt, 'INVALIDPARM');
  assert.equal((await request(`${root}/CICSProgram?CRITERIA=(PROGRAM=D*)`)).summary.api_response1_alt, 'NODATA');
});

test('stateful program seed supports wildcard retrieval and NEWCOPY without inventing missing resources', async t => {
  const { request } = await setup(t, { config: { stateful: true } });
  const path = `${root}/CICSProgram/REGION1?CRITERIA=(PROGRAM=D*)`;
  assert.deepEqual(records(await request(path), 'cicsprogram').map(record => record.program), ['DFHBRCV']);
  for (const name of ['NEWCOPY', 'PHASEIN']) {
    assert.equal((await request(path, xml('PUT', action(name)))).summary.api_response1_alt, 'OK');
  }
  assert.equal((await request(`${root}/CICSProgram/REGION1?CRITERIA=(PROGRAM=MISSING)`, xml('PUT', action('NEWCOPY')))).summary.api_response1_alt, 'NODATA');
});

test('stateful live queries change after writes while retained results stay immutable', async t => {
  const { request } = await setup(t, { config: { stateful: true }, fixtures: { CICSDefinitionProgram: [] } });
  const path = `${root}/CICSDefinitionProgram/REGION1`;
  await request(path, xml('POST', create('FIRST')));
  const before = await request(`${path}?NODISCARD`);
  await request(path, xml('POST', create('SECOND')));
  const after = await request(`${path}?NODISCARD&ORDERBY=name/D`);
  assert.equal(after.summary.recordcount, '2');
  assert.notEqual(after.summary.cachetoken, before.summary.cachetoken);
  assert.deepEqual(records(after, 'cicsdefinitionprogram').map(record => record.name), ['SECOND', 'FIRST']);
  const retained = await request(`${root}/CICSResultCache/${before.summary.cachetoken}?NODISCARD`);
  assert.deepEqual(records(retained, 'cicsdefinitionprogram').map(record => record.name), ['FIRST']);
  const capped = await request(`${path}?count=1`);
  assert.equal(capped.summary.recordcount, '1');
  assert.equal((await request(`${path}?SUMMONLY`)).summary.displayed_recordcount, '0');
});

test('stateful instances clone fixtures and do not share resource mutations', async t => {
  const input = { CICSDefinitionProgram: [{ name: 'CUSTOM', csdgroup: 'GROUP1' }] };
  const first = await setup(t, { config: { stateful: true }, fixtures: input });
  const second = await setup(t, { config: { stateful: true }, fixtures: input });
  const path = `${root}/CICSDefinitionProgram/REGION1`;
  await first.request(path, { method: 'DELETE' });
  assert.equal((await first.request(path)).summary.api_response1_alt, 'NODATA');
  assert.equal(records(await second.request(path), 'cicsdefinitionprogram')[0].name, 'CUSTOM');
  assert.deepEqual(input.CICSDefinitionProgram, [{ name: 'CUSTOM', csdgroup: 'GROUP1' }]);
});

test('stateful mode rejects invalid payloads, unsupported criteria/actions, and identity updates', async t => {
  const { request } = await setup(t, { config: { stateful: true } });
  for (const body of ['<request/>', '<request><create><attributes name="X"/></create></request>']) {
    assert.equal((await request(`${root}/CICSDefinitionProgram/REGION1`, xml('POST', body))).summary.api_response1_alt, 'INVALIDDATA');
  }
  assert.equal((await request(`${root}/CICSProgram/REGION1`, xml('POST', create()))).summary.api_response1_alt, 'INVALIDDATA');
  for (const body of ['<request/>', action('UNKNOWN'), '<request><update><attributes name="RENAMED"/></update></request>']) {
    assert.equal((await request(`${root}/CICSProgram/REGION1`, xml('PUT', body))).summary.api_response1_alt, 'INVALIDPARM');
  }
  assert.equal((await request(`${root}/CICSProgram/REGION1`, { method: 'PUT' })).summary.api_response1_alt, 'INVALIDPARM');
  assert.equal((await request(`${root}/CICSProgram/REGION1?CRITERIA=NAME!=X`)).summary.api_response1_alt, 'INVALIDPARM');
  assert.equal((await request(`${root}/CICSProgram/REGION1?PARAMETER=BAD`)).summary.api_response1_alt, 'INVALIDPARM');
});

test('stateful resource storage is bounded by MAX_RECORDS', async t => {
  const { request } = await setup(t, { config: { stateful: true, defaultCount: 0, maxRecords: 1 } });
  const path = `${root}/CICSDefinitionProgram/REGION1`;
  assert.equal((await request(path, xml('POST', create()))).summary.api_response1_alt, 'OK');
  assert.equal((await request(path, xml('POST', create('SECOND')))).summary.api_response1_alt, 'NOTAVAILABLE');
  assert.equal(records(await request(path), 'cicsdefinitionprogram').length, 1);
});
