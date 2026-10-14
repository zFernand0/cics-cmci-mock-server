/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const express = require('express');
const { RESOURCE_TYPES, generateMockData } = require('./resources');
const { RESPONSE_CODES, CmciError, sendResponse, normalizeQuery,
  parseInteger, parseOrderBy, paginate, validateXML } = require('./cmci');
const { createCatalog } = require('./catalog');

function createCmciRouter(state, config, auth, fixtures) {
  const catalog = config.stateful ? createCatalog(config, fixtures) : null;
  function readCached(req, res, entry, query, index, count, order) {
    const records = Object.hasOwn(query, 'summonly') ? [] : paginate(entry.data, index, count, order);
    const keep = Object.hasOwn(query, 'nodiscard');
    if (keep) state.touchResult(entry.token);
    else state.deleteResult(entry.token);
    return sendResponse(req, res, { total: entry.data.length, records,
      resourceType: entry.resourceType, token: keep ? entry.token : undefined });
  }

  async function handleCmci(req, res) {
    const parts = req.path.split('/').filter(Boolean).map(decodeURIComponent);
    const resourceType = parts[0]?.toLowerCase();
    if (!resourceType) throw new CmciError(400, 'INVALIDPARM', 'Resource type is required');
    if (!Object.hasOwn(RESOURCE_TYPES, resourceType)) throw new CmciError(404, 'NOTAVAILABLE', 'Unknown resource type');
    const query = normalizeQuery(req.query);
    const path = req.path.toLowerCase();

    if (resourceType === 'cicsresultcache') {
      if (parts.length < 2 || parts.length > 4) throw new CmciError(400, 'INVALIDPARM', 'Expected cache token and optional index/count');
      if (!['GET', 'DELETE'].includes(req.method)) {
        res.set('Allow', 'GET, DELETE');
        throw new CmciError(405, 'INVALIDPARM', 'Cache supports GET and DELETE');
      }
      const index = parseInteger(parts[2] ?? query.index, 'index', { fallback: 1 });
      const count = parseInteger(parts[3] ?? query.count, 'count', { fallback: null, max: config.maxRecords });
      const order = parseOrderBy(query.orderby);
      const entry = state.findResult(parts[1], req.session.id);
      if (!entry) throw new CmciError(404, 'NOTAVAILABLE', 'Cache token not found or expired');
      if (req.method === 'DELETE') {
        state.deleteResult(entry.token);
        return sendResponse(req, res, { total: entry.data.length });
      }
      return readCached(req, res, entry, query, index, count, order);
    }

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
      res.set('Allow', 'GET, POST, PUT, DELETE');
      throw new CmciError(405, 'INVALIDPARM', 'Unsupported method');
    }
    if (query.simulate !== undefined) {
      const code = query.simulate.toUpperCase();
      if (!Object.hasOwn(RESPONSE_CODES, code)) throw new CmciError(400, 'INVALIDPARM', 'Unknown simulation');
      if (code !== 'OK') return sendResponse(req, res, { code });
    }
    if (req.method !== 'GET') {
      const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
      if (req.method === 'POST' || (req.method === 'PUT' && hasBody)) {
        const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
        if (!['application/xml', 'text/xml'].includes(contentType) && !/^application\/[^/\s]+\+xml$/.test(contentType)) {
          throw new CmciError(415, 'INVALIDDATA', 'Use an XML Content-Type');
        }
        await validateXML(req.body);
      }
      if (catalog) return sendResponse(req, res, await catalog.mutate(req.method, resourceType, parts.slice(1), query, req.body));
      // Default operation acknowledgements remain stateless.
      return sendResponse(req, res, { total: 1 });
    }

    const index = parseInteger(query.index, 'index', { fallback: 1 });
    const count = parseInteger(query.count, 'count', { fallback: undefined, min: query.cachetoken ? 1 : 0, max: config.maxRecords });
    const order = parseOrderBy(query.orderby);
    if (query.cachetoken !== undefined) {
      if (!query.cachetoken) throw new CmciError(400, 'INVALIDPARM', 'cachetoken must not be empty');
      const entry = state.findResult(query.cachetoken, req.session.id, resourceType, path);
      if (entry) return readCached(req, res, entry, query, index, count ?? null, order);
      if (!config.cacheMissFallback) throw new CmciError(404, 'NOTAVAILABLE', 'Cache token not found or expired');
    }
    const liveData = catalog?.read(resourceType, parts.slice(1), query);
    const requestedCount = count ?? liveData?.length ?? fixtures[resourceType]?.length ?? config.defaultCount;
    const key = JSON.stringify({ sessionId: req.session.id, path, count: requestedCount, revision: catalog?.revision,
      query: Object.entries(query).filter(([name]) => !['cachetoken', 'cache', 'nodiscard', 'summonly', 'index', 'count', 'orderby'].includes(name)).sort(([a], [b]) => a.localeCompare(b)) });
    let entry = state.results.get(state.requestIndex.get(key));
    let data = entry?.data || (liveData || fixtures[resourceType])?.slice(0, requestedCount) || generateMockData(resourceType, requestedCount);
    const retain = config.autoCache || Object.hasOwn(query, 'nodiscard') || query.cache === 'true';
    if (retain && data.length) {
      entry = state.storeResult({ key, resourceType, path, data, sessionId: req.session.id,
        query: { ...query }, legacy: query.cache === 'true' });
      data = entry.data;
    }
    const records = Object.hasOwn(query, 'summonly') ? [] : paginate(data, index, null, order);
    return sendResponse(req, res, { code: data.length ? 'OK' : 'NODATA',
      total: data.length, records, resourceType, token: retain ? entry?.token : undefined });
  }

  const cmci = express.Router();
  cmci.use(auth.authenticate);
  cmci.use((req, res, next) => { handleCmci(req, res).catch(next); });
  return cmci;
}

module.exports = { createCmciRouter };
