/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const xml2js = require('xml2js');
const { CmciError } = require('./cmci');
const { generateMockData, keyData } = require('./resources');
const { parseCriteria, parseGroup } = require('./criteria');

const DEFINITIONS = Object.freeze({
  cicsdefinitionprogram: { runtime: 'cicsprogram', identity: 'program' },
  cicsdefinitiontransaction: { runtime: 'cicslocaltransaction', identity: 'tranid' },
  cicsdefinitionurimap: { runtime: 'cicsurimap', identity: 'name' },
  cicsdefinitionwebservice: { runtime: 'cicswebservice', identity: 'name' },
  cicsdefinitionbundle: { runtime: 'cicsbundle', identity: 'name' }
});

function createCatalog(config, fixtures) {
  const regions = config.regions.split(',').map(name => name.trim().toUpperCase());
  const tables = new Map();
  let revision = 0;

  function regionFor(parts) {
    if (parts.length > 2) throw new CmciError(200, 'INVALIDPARM', 'Expected context and optional scope');
    const region = (parts.at(-1) || regions[0]).toUpperCase();
    if (!regions.includes(region)) throw new CmciError(200, 'INVALIDPARM', 'Unknown CICS region');
    return region;
  }

  function table(type, region) {
    const key = `${region}:${type}`;
    if (!tables.has(key)) {
      const generated = type === 'cicscsdgroupinlist' ? [] : generateMockData(type, config.defaultCount);
      if (type === 'cicsprogram' && generated.length) generated[0].$.program = 'DFHBRCV';
      const records = structuredClone(fixtures[type] ?? generated);
      for (const record of records) {
        record.$.eyu_cicsname = region;
        if (DEFINITIONS[type]) {
          record.$.name ??= record.$[DEFINITIONS[type].identity];
          record.$.csdgroup ??= config.csdGroup;
        }
      }
      if (type === 'cicscsdgroup' && !fixtures[type]) {
        records.splice(0, records.length, { $: { name: config.csdGroup, eyu_cicsname: region,
          _keydata: keyData(type, config.csdGroup) } });
      }
      tables.set(key, records);
    }
    return tables.get(key);
  }

  function select(type, region, query) {
    const predicate = parseCriteria(query.criteria);
    const group = parseGroup(query.parameter);
    return table(type, region).filter(record => predicate(record.$) && (!group || record.$.csdgroup?.toUpperCase() === group));
  }

  function read(type, parts, query) {
    return structuredClone(select(type, regionFor(parts), query));
  }

  function duplicate() {
    return { code: 'TABLEERROR', total: 1, response2: '1361', message: 'DATAERROR',
      errors: { feedback: { $: { resp: '120', resp_alt: 'DUPRES', resp2: '1' } } } };
  }

  function insert(type, region, attributes) {
    const records = table(type, region);
    if (records.length >= config.maxRecords) throw new CmciError(200, 'NOTAVAILABLE', 'Resource table is full');
    records.push({ $: { ...attributes, eyu_cicsname: region,
      _keydata: keyData(type, `${region}:${attributes.csdgroup || ''}:${attributes.name || attributes.program || attributes.tranid}`) } });
    revision++;
  }

  async function mutate(method, type, parts, query, body) {
    const region = regionFor(parts);
    const selected = select(type, region, query);
    const document = body ? await xml2js.parseStringPromise(body, { explicitArray: false, normalizeTags: true }) : null;
    const request = document?.request;
    if (method === 'POST') {
      const definition = DEFINITIONS[type];
      const attributes = request?.create?.attributes?.$;
      if (!definition || !attributes?.name || !attributes.csdgroup) {
        throw new CmciError(200, 'INVALIDDATA', 'Creation requires definition name and csdgroup attributes');
      }
      const normalized = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key.toLowerCase(), value]));
      const name = normalized.name.toUpperCase();
      const group = normalized.csdgroup.toUpperCase();
      if (table(type, region).some(record => record.$.name?.toUpperCase() === name && record.$.csdgroup?.toUpperCase() === group)) {
        return duplicate();
      }
      insert(type, region, { ...normalized, name, csdgroup: group, [definition.identity]: name });
      return { total: 1 };
    }
    if (!selected.length) return { code: 'NODATA' };
    if (method === 'DELETE') {
      const records = table(type, region);
      for (const record of selected) records.splice(records.indexOf(record), 1);
      revision++;
      return { total: selected.length };
    }
    const action = request?.action?.$?.name?.toUpperCase();
    if (action === 'CSDINSTALL' && DEFINITIONS[type]) {
      const { runtime, identity } = DEFINITIONS[type];
      for (const record of selected) {
        const runtimeRecords = table(runtime, region);
        const existing = runtimeRecords.find(item => item.$[identity]?.toUpperCase() === record.$.name.toUpperCase());
        if (existing) {
          const identityKey = existing.$._keydata;
          Object.assign(existing.$, record.$, { [identity]: record.$.name, _keydata: identityKey,
            enablestatus: record.$.status || 'ENABLED' });
          revision++;
        } else insert(runtime, region, { ...record.$, [identity]: record.$.name, enablestatus: record.$.status || 'ENABLED' });
      }
    } else if (action === 'CSDADD' && type === 'cicscsdgroup') {
      const parameter = request.action.parameter?.$;
      if (parameter?.name !== 'TO_CSDLIST' || !parameter.value) {
        throw new CmciError(200, 'INVALIDPARM', 'CSDADD requires TO_CSDLIST');
      }
      const list = parameter.value.toUpperCase();
      const memberships = table('cicscsdgroupinlist', region);
      if (selected.some(record => memberships.some(item => item.$.csdgroup === record.$.name && item.$.csdlist === list))) return duplicate();
      for (const record of selected) insert('cicscsdgroupinlist', region, { name: `${list}:${record.$.name}`, csdgroup: record.$.name, csdlist: list });
    } else if (['NEWCOPY', 'PHASEIN'].includes(action) && type === 'cicsprogram') {
      // The mock has no load library; only existing installed programs can be refreshed.
    } else if (request?.update?.attributes?.$) {
      const updates = Object.fromEntries(Object.entries(request.update.attributes.$).map(([key, value]) => [key.toLowerCase(), value]));
      if (Object.keys(updates).some(key => ['name', 'program', 'tranid', 'csdgroup', '_keydata', 'eyu_cicsname'].includes(key))) {
        throw new CmciError(200, 'INVALIDPARM', 'Resource identity attributes cannot be updated');
      }
      for (const record of selected) Object.assign(record.$, updates);
      revision++;
    } else throw new CmciError(200, 'INVALIDPARM', 'Unsupported stateful action');
    return { total: selected.length };
  }

  return { read, mutate, get revision() { return revision; } };
}

module.exports = { createCatalog };
