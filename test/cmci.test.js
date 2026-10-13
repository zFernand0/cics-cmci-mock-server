/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const xml2js = require('xml2js');
const { createXMLResponse, normalizeQuery, parseInteger, parseOrderBy, paginate, validateXML } = require('../src/cmci');
const { generateMockData } = require('../src/resources');

test('XML builder escapes attributes and preserves the CMCI envelope', async () => {
  const xml = createXMLResponse({ api_response1: '1024', api_response2: '0', api_response2_alt: '< & "' },
    { cicsprogram: { $: { program: 'A&B' } } });
  const response = (await xml2js.parseStringPromise(xml)).response;
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.equal(response.$.xmlns, 'http://www.ibm.com/xmlns/prod/CICS/smw2int');
  assert.equal(response.resultsummary[0].$.api_response2_alt, '< & "');
  assert.equal(response.records[0].cicsprogram[0].$.program, 'A&B');
});

test('query normalization handles prototype names safely and rejects object values', () => {
  assert.equal(normalizeQuery({ hasOwnProperty: 'value' }).hasownproperty, 'value');
  assert.throws(() => normalizeQuery({ count: { value: '1' } }));
  assert.equal(parseInteger(undefined, 'count', { fallback: 3 }), 3);
  assert.equal(parseInteger('0', 'count', { min: 0 }), 0);
});

test('sorting preserves zero values, missing fields, ties and the original order', () => {
  const data = [{ $: { name: 'B', usecount: 1 } }, { $: { name: 'A', usecount: 0 } }, { $: { name: 'C' } }];
  const order = parseOrderBy('usecount/A,name/D');
  assert.deepEqual(paginate(data, 1, 3, order).map(record => record.$.name), ['C', 'A', 'B']);
  assert.deepEqual(paginate(data, 1, 3, parseOrderBy('unknown')).map(record => record.$.name), ['B', 'A', 'C']);
  assert.deepEqual(data.map(record => record.$.name), ['B', 'A', 'C']);
  assert.equal(parseOrderBy(undefined).length, 0);
});

test('mock identities are reproducible across fresh datasets', () => {
  assert.deepEqual(generateMockData('cicsprogram', 4), generateMockData('cicsprogram', 4));
  assert.equal(generateMockData('cicsmanagedregion').length, 1);
});

test('XML validation requires a string and request root', async () => {
  await assert.rejects(validateXML(null));
  await assert.rejects(validateXML(''));
  await assert.rejects(validateXML('not XML'));
  await assert.doesNotReject(validateXML('<request/>'));
  await assert.doesNotReject(validateXML('<request><![CDATA[allowed]]>text<!-- comment --></request>'));
  await assert.rejects(validateXML('<!-- no root -->'));
  await assert.rejects(validateXML('<![CDATA[outside]]><request/>'));
  await assert.rejects(validateXML('<!ENTITY x "test"><request/>'));
});
