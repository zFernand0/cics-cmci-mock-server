/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const xml2js = require('xml2js');
const sax = require('sax');

const RESPONSE_CODES = Object.freeze({
  OK: '1024', NODATA: '1027', INVALIDPARM: '1028',
  NOTAVAILABLE: '1034', INVALIDDATA: '1041'
});
const NAMESPACE = 'http://www.ibm.com/xmlns/prod/CICS/smw2int';
const builder = new xml2js.Builder({ headless: true, rootName: 'response' });

class CmciError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createXMLResponse(summary, records = null, schemaUrl = '/CICSSystemManagement/schema/CICSSystemManagement.xsd') {
  const response = {
    $: {
      xmlns: NAMESPACE,
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': `${NAMESPACE} ${schemaUrl}`,
      version: '3.0', connect_version: '0620'
    },
    resultsummary: { $: summary }
  };
  if (records) response.records = records;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.buildObject(response)}`;
}

function sendResponse(req, res, { code = 'OK', status = 200, message = '', total = 0, records = [], resourceType, token } = {}) {
  const summary = {
    api_source: 'CICSPlex SM', api_function: req.method,
    api_response1: RESPONSE_CODES[code], api_response2: '0',
    api_response1_alt: code, api_response2_alt: message,
    recordcount: String(total), displayed_recordcount: String(records.length)
  };
  if (token) summary.cachetoken = token;
  const data = records.length ? { [resourceType]: records } : null;
  const schemaUrl = `${req.protocol}://${req.get('host')}/CICSSystemManagement/schema/CICSSystemManagement.xsd`;
  return res.status(status).type('application/xml').send(createXMLResponse(summary, data, schemaUrl));
}

function normalizeQuery(query) {
  const normalized = Object.create(null);
  for (const [key, value] of Object.entries(query)) {
    const name = key.toLowerCase();
    if (!/^[a-z][a-z\d_]*$/i.test(key) || typeof value !== 'string' || Object.hasOwn(normalized, name)) {
      throw new CmciError(400, 'INVALIDPARM', `Parameter ${key} must occur once and have a scalar value`);
    }
    normalized[name] = value;
  }
  return normalized;
}

function parseInteger(value, name, { fallback, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new CmciError(400, 'INVALIDPARM', `${name} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new CmciError(400, 'INVALIDPARM', `${name} must be between ${min} and ${max}`);
  }
  return number;
}

function parseOrderBy(value) {
  if (value === undefined) return [];
  const fields = value.split(',');
  if (!fields.length || fields.length > 32) throw new CmciError(400, 'INVALIDPARM', 'ORDERBY supports at most 32 fields');
  return fields.map(field => {
    const match = /^([a-z_][a-z\d_]*)(?:\/(A|D))?$/i.exec(field.trim());
    if (!match) throw new CmciError(400, 'INVALIDPARM', 'Invalid ORDERBY field');
    return { name: match[1].toLowerCase(), descending: match[2]?.toUpperCase() === 'D' };
  });
}

function paginate(data, index = 1, count = null, order = []) {
  const sorted = [...data];
  if (order.length) sorted.sort((a, b) => {
    for (const { name, descending } of order) {
      const left = a.$[name] ?? '';
      const right = b.$[name] ?? '';
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      if (comparison) return descending ? -comparison : comparison;
    }
    return 0;
  });
  const start = index - 1;
  return sorted.slice(start, count === null ? undefined : start + count);
}

async function validateXML(body) {
  if (typeof body !== 'string' || !body.trim()) throw new CmciError(400, 'INVALIDDATA', 'An XML request body is required');
  try {
    // Validate the entire document: xml2js resolves as soon as the first root closes.
    const parser = sax.parser(true, { strictEntities: true });
    let depth = 0;
    let roots = 0;
    parser.onerror = error => { throw error; };
    parser.onopentag = node => {
      if (depth === 0 && (++roots !== 1 || node.name !== 'request')) throw new Error('Expected one request root');
      depth++;
    };
    parser.onclosetag = () => { depth--; };
    parser.ontext = text => {
      if (depth === 0 && text.trim()) throw new Error('Text outside the root');
    };
    parser.oncdata = () => {
      if (depth === 0) throw new Error('CDATA outside the root');
    };
    parser.ondoctype = parser.onsgmldeclaration = () => { throw new Error('DTD and entity declarations are not supported'); };
    parser.write(body).close();
    if (roots !== 1) throw new Error('Missing request element');
  } catch {
    throw new CmciError(400, 'INVALIDDATA', 'Malformed XML, unsupported declaration, or missing request element');
  }
}

module.exports = { RESPONSE_CODES, CmciError, createXMLResponse, sendResponse, normalizeQuery, parseInteger, parseOrderBy, paginate, validateXML };
