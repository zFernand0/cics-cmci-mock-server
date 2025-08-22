/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

/**
 * CICS CMCI Mock Server
 * 
 * This mock server simulates the CICS CMCI REST API for testing and development
 * purposes. It handles XML requests/responses and includes caching and authentication
 * mechanisms similar to a real CICS system.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const xml2js = require('xml2js');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 9080;

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());
app.use(express.raw({ type: 'application/xml' }));

// In-memory storage for caching and sessions
const cache = new Map(); // Basic cache storage (legacy)
const sessions = new Map();
const ltpaTokens = new Map(); // Map LtpaToken2 values to sessionIds

// Enhanced retained result sets storage
const retainedResultSets = new Map(); // Map<cacheToken, RetainedResultSet>

// Structure for retained result sets
class RetainedResultSet {
  constructor(resourceType, data, sessionId, query = {}) {
    this.resourceType = resourceType;
    this.data = data; // Array of all records
    this.sessionId = sessionId; // Only the creating session can access
    this.createdAt = new Date();
    this.lastAccessed = new Date();
    this.query = query; // Original query parameters
    this.totalRecords = data.length;
  }

  // Check if the result set has expired (15 minutes as per IBM docs)
  isExpired() {
    const fifteenMinutes = 15 * 60 * 1000;
    return (new Date() - this.lastAccessed) > fifteenMinutes;
  }

  // Update last accessed time
  touch() {
    this.lastAccessed = new Date();
  }

  // Get a subset of records with pagination
  getRecords(index = 1, count = null, orderBy = null) {
    this.touch();

    let records = [...this.data];

    // Apply ordering if specified
    if (orderBy) {
      const orderFields = orderBy.split(',').map(f => f.trim());
      records.sort((a, b) => {
        for (const field of orderFields) {
          const aVal = a.$?.[field] || '';
          const bVal = b.$?.[field] || '';
          if (aVal < bVal) return -1;
          if (aVal > bVal) return 1;
        }
        return 0;
      });
    }

    // Apply pagination (1-based indexing as per IBM docs)
    const startIndex = Math.max(0, index - 1);
    const endIndex = count ? Math.min(startIndex + count, records.length) : records.length;

    return {
      records: records.slice(startIndex, endIndex),
      displayedCount: endIndex - startIndex,
      totalCount: this.totalRecords
    };
  }
}

// Cleanup expired retained result sets every 5 minutes
setInterval(() => {
  const expiredTokens = [];
  for (const [token, resultSet] of retainedResultSets.entries()) {
    if (resultSet.isExpired()) {
      expiredTokens.push(token);
    }
  }

  for (const token of expiredTokens) {
    retainedResultSets.delete(token);
    console.log(`🗑️  Expired retained result set: ${token}`);
  }

  if (expiredTokens.length > 0) {
    console.log(`♻️  Cleaned up ${expiredTokens.length} expired result sets`);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// CICS CMCI Constants (mirroring the SDK constants)
const CMCI_CONSTANTS = {
  CICS_SYSTEM_MANAGEMENT: 'CICSSystemManagement',
  RESPONSE_CODES: {
    OK: '1024',
    NODATA: '1027',
    INVALIDPARM: '1028',
    NOTAVAILABLE: '1034',
    INVALIDDATA: '1041'
  },
  SUCCESS_RESPONSE_2: '0'
};

// Resource type mappings
const RESOURCE_TYPES = {
  'cicsmanagedregion': 'CICSManagedRegion',
  'cicscicsplex': 'CICSCICSPlex',
  'cicsregion': 'CICSRegion',
  'cicsdefinitionprogram': 'CICSDefinitionProgram',
  'cicsdefinitiontransaction': 'CICSDefinitionTransaction',
  'cicsdefinitionurimap': 'CICSDefinitionURIMap',
  'cicsdefinitionwebservice': 'CICSDefinitionWebService',
  'cicsdefinitionbundle': 'CICSDefinitionBundle',
  'cicsprogram': 'CICSProgram',
  'cicslibrary': 'CICSLibrary',
  'cicstcpipservice': 'CICSTCPIPService',
  'cicspipeline': 'CICSPipeline',
  'cicswebservice': 'CICSWebService',
  'cicsjvmserver': 'CICSJVMServer',
  'cicsurimap': 'CICSURIMap',
  'cicsregiongroup': 'CICSRegionGroup',
  'cicscsdgroup': 'CICSCSDGroup',
  'cicscsdgroupinlist': 'CICSCSDGroupInList',
  'cicsresultcache': 'CICSResultCache',
  'cicstask': 'CICSTask',
  'cicsbundle': 'CICSBundle',
  'cicsbundlepart': 'CICSBundlePart',
  'cicslocalfile': 'CICSLocalFile',
  'cicslocaltransaction': 'CICSLocalTransaction',
  'cicsremotetransaction': 'CICSRemoteTransaction'
};

// XML Builder/Parser setup
const xmlBuilder = new xml2js.Builder({
  headless: true,
  rootName: 'response',
  renderOpts: { pretty: true, indent: '  ', newline: '\n' }
});

const xmlParser = new xml2js.Parser({
  explicitArray: false,
  mergeAttrs: true,
  normalizeTags: true
});

/**
 * Generate a cache token for result caching
 */
function generateCacheToken() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * Generate a session token for authentication
 */
function generateSessionToken() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Generate a dummy LtpaToken2 for cookie-based authentication
 */
function generateLtpaToken2() {
  // Generate a realistic-looking LtpaToken2 (base64-encoded like real IBM tokens)
  const tokenData = crypto.randomBytes(64).toString('base64');
  return tokenData.replace(/[+/=]/g, function(match) {
    switch (match) {
      case '+': return '-';
      case '/': return '_';
      case '=': return '';
      default: return match;
    }
  });
}

/**
 * Create XML response wrapper with standard CMCI structure
 */
function createXMLResponse(resultSummary, records = null) {
  const response = {
    $: {
      xmlns: 'http://www.ibm.com/xmlns/prod/CICS/smw2int',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': 'http://www.ibm.com/xmlns/prod/CICS/smw2int http://localhost:9080/CICSSystemManagement/schema/CICSSystemManagement.xsd',
      version: '3.0',
      connect_version: '0620'
    },
    resultsummary: {
      $: resultSummary
    }
  };

  if (records) {
    response.records = records;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBuilder.buildObject(response)}`;
}

/**
 * Parse resource type from URI path
 */
function parseResourceFromPath(path) {
  const parts = path.split('/');
  const cmciIndex = parts.indexOf(CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT);

  if (cmciIndex !== -1 && cmciIndex + 1 < parts.length) {
    return parts[cmciIndex + 1].toLowerCase();
  }

  return null;
}

/**
 * Generate mock data for different resource types
 */
function generateMockData(resourceType, count = 1) {
  const mockData = [];

  for (let i = 0; i < count; i++) {
    let record;

    switch (resourceType) {
      case 'cicsmanagedregion':
        record = {
          $: {
            _keydata: crypto.randomBytes(8).toString('hex').toUpperCase(),
            actvtime: '',
            ainsfail: 'CONTINUE',
            applid: `REGION${i + 1}`,
            autoinst: 'NEVER',
            bastrace: '00000000',
            botrsupd: '1',
            chetrace: '00000000',
            cicsname: `REGION${i + 1}`,
            cicssamp: '0',
            cicsstate: 'ACTIVE',
            cmasname: 'MYCMAS',
            comtrace: '00000000',
            connsamp: '0',
            cpsmver: '0620',
            dattrace: '00000000',
            daylghtsv: 'NO',
            dbxsamp: '0',
            desc: `Mock region ${i + 1}`,
            filesamp: '0',
            glblsamp: '0',
            host: '',
            jrnlsamp: '0',
            knltrace: '00000000',
            mastrace: '00000000',
            mastype: 'LOCAL',
            monstatus: 'NO',
            msgtrace: '00000000',
            mxtaction: '',
            mxtsev: 'HS',
            networkid: '',
            nrmaction: '',
            nrmsev: 'N_A',
            port: '',
            pricmas: '',
            progsamp: '0',
            quetrace: '00000000',
            readrs: '200',
            retention: '0',
            rtastatus: 'SAM',
            rtatrace: '00000000',
            samaction: '',
            samsev: 'VHS',
            sdmaction: '',
            sdmsev: 'VHS',
            secbypass: 'NO',
            seccmdchk: 'NO',
            secreschk: 'NO',
            sosaction: '',
            sossev: 'HS',
            srvtrace: '00000000',
            stlaction: '',
            stlsev: 'VHS',
            tdmaction: '',
            tdmsev: 'HW',
            tdqsamp: '0',
            termsamp: '0',
            tmezone: 'Z'
          }
        };
        break;

      case 'cicscicsplex':
        record = {
          $: {
            _keydata: crypto.randomBytes(16).toString('hex').toUpperCase(),
            accesstype: 'LOCAL',
            botrsupd: '1',
            cmasname: 'REGION1',
            mpstatus: 'YES',
            plexname: `PLEX${i + 1}`,
            readrs: '200',
            rspoolid: 'DFHRSTAT',
            status: 'ACTIVE',
            sysid: 'EPCM',
            toprsupd: '5',
            transitcmas: '',
            transitcnt: '0',
            updaters: '15'
          }
        };
        break;

      case 'cicsdefinitionprogram':
        record = {
          $: {
            _keydata: crypto.randomBytes(8).toString('hex').toUpperCase(),
            program: `PROG${String(i + 1).padStart(3, '0')}`,
            language: 'COBOL',
            length: '12345',
            reload: 'NO',
            resident: 'NO',
            status: 'ENABLED',
            usage: 'NORMAL',
            uselpacopy: 'NO'
          }
        };
        break;

      default:
        record = {
          $: {
            _keydata: crypto.randomBytes(8).toString('hex').toUpperCase(),
            name: `${resourceType.toUpperCase()}${i + 1}`,
            status: 'ACTIVE'
          }
        };
    }

    mockData.push(record);
  }

  return mockData;
}

/**
 * Authentication middleware
 */
function authenticateSession(req, res, next) {
  const authHeader = req.headers.authorization;
  const ltpaToken = req.headers.ltpatoken2 || req.headers.LtpaToken2 || req.cookies.LtpaToken2;

  // Check for LtpaToken2 in headers or cookies first
  if (ltpaToken) {
    const sessionId = ltpaTokens.get(ltpaToken);
    
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      // Update last activity
      session.lastActivity = new Date();
      sessions.set(sessionId, session);
      
      req.sessionId = sessionId;
      req.username = session.username;
      req.authenticatedViaToken = true;
      
      console.log(`Authenticated user: ${session.username} with LtpaToken2 session: ${sessionId}`);
      return next();
    } else {
      console.log(`Invalid or expired LtpaToken2: ${ltpaToken}`);
      return res.status(401).json({ error: 'Invalid or expired LtpaToken2' });
    }
  }

  if (!authHeader) {
    // No auth header - require authentication for CMCI endpoints
    console.log('❌ No authorization header provided - authentication required');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Simple Basic Auth simulation
  if (authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [username, password] = credentials.split(':');

    // Validate against allowed credentials
    const validCredentials = {
      'testuser': 'testpass',
      'adminusr': 'adminpas'
    };

    if (username && password && validCredentials[username] === password) {
      // Use a deterministic session ID based on username for testing/demo purposes
      // In production, you'd want proper session management with cookies/tokens
      const sessionId = crypto.createHash('md5').update(username).digest('hex').substring(0, 16).toUpperCase();
      
      // Check if session already exists and has a valid LtpaToken2
      let existingSession = sessions.get(sessionId);
      let ltpaToken2;
      
      if (existingSession && existingSession.ltpaToken2) {
        // Reuse existing token
        ltpaToken2 = existingSession.ltpaToken2;
        console.log(`Reusing existing LtpaToken2 for user: ${username} with session: ${sessionId}`);
      } else {
        // Generate new LtpaToken2 for this session
        ltpaToken2 = generateLtpaToken2();
        
        // Clean up any old tokens for this session
        if (existingSession && existingSession.ltpaToken2) {
          ltpaTokens.delete(existingSession.ltpaToken2);
        }
        
        // Map the new LtpaToken2 to the session
        ltpaTokens.set(ltpaToken2, sessionId);
        
        console.log(`Generated new LtpaToken2 for user: ${username} with session: ${sessionId}`);
      }
      
      // Update session
      sessions.set(sessionId, {
        username,
        loginTime: existingSession?.loginTime || new Date(),
        lastActivity: new Date(),
        ltpaToken2
      });

      req.sessionId = sessionId;
      req.username = username;
      req.newLtpaToken = ltpaToken2; // Signal that we should set the cookie

      // Set the LtpaToken2 cookie in the response
      res.cookie('LtpaToken2', ltpaToken2, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        maxAge: 8 * 60 * 60 * 1000, // 8 hours (typical for LTPA tokens)
        sameSite: 'lax'
      });
      
      return next();
    } else {
      // Invalid credentials provided (either missing username/password or wrong credentials)
      console.log(`Authentication failed for user: ${username || 'unknown'}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  }

  res.status(401).json({ error: 'Authentication required' });
}

/**
 * CICSResultCache endpoint - Handle retained result set requests
 * Format: /CICSSystemManagement/CICSResultCache/{cachetoken}[/{index}[/{count}]]
 */
app.get(`/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/CICSResultCache/:cachetoken`, authenticateSession, (req, res) => {
  const { cachetoken } = req.params;
  const query = req.query;
  const pathParts = req.path.split('/');

  console.log(`GET CICSResultCache ${cachetoken} from session: ${req.sessionId}`);

  // Find the retained result set
  const resultSet = retainedResultSets.get(cachetoken);

  if (!resultSet) {
    console.log(`❌ Cache token not found: ${cachetoken}`);
    return res.status(404).set('Content-Type', 'application/xml').send(
      createXMLResponse({
        api_function: 'GET',
        api_response1: CMCI_CONSTANTS.RESPONSE_CODES.NOTAVAILABLE,
        api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
        api_response1_alt: 'NOTAVAILABLE',
        api_response2_alt: 'Cache token not found',
        recordcount: '0'
      })
    );
  }

  // Check session access (security - only creator can access)
  if (resultSet.sessionId !== req.sessionId) {
    console.log(`🚫 Access denied for cache token ${cachetoken} - wrong session`);
    return res.status(403).set('Content-Type', 'application/xml').send(
      createXMLResponse({
        api_function: 'GET',
        api_response1: CMCI_CONSTANTS.RESPONSE_CODES.NOTAVAILABLE,
        api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
        api_response1_alt: 'NOTAVAILABLE',
        api_response2_alt: 'Access denied',
        recordcount: '0'
      })
    );
  }

  // Parse index and count from URL path (after cachetoken)
  // Format: .../CICSResultCache/{token}/{index}/{count}
  const cacheIndex = pathParts.findIndex(part => part === cachetoken);
  const index = cacheIndex + 1 < pathParts.length ? parseInt(pathParts[cacheIndex + 1]) : 1;
  const count = cacheIndex + 2 < pathParts.length ? parseInt(pathParts[cacheIndex + 2]) : null;
  const orderBy = query.orderby || query.ORDERBY;

  console.log(`📄 Retrieving from cache: index=${index}, count=${count}, orderby=${orderBy}`);

  // Get the requested records
  const { records, displayedCount, totalCount } = resultSet.getRecords(index, count, orderBy);

  const resultSummary = {
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'OK',
    api_response2_alt: '',
    recordcount: totalCount.toString(),
    displayed_recordcount: displayedCount.toString()
  };

  // Keep the result set if NODISCARD is specified
  const keepCache = query.hasOwnProperty('NODISCARD') || query.hasOwnProperty('nodiscard');
  if (keepCache) {
    resultSummary.cachetoken = cachetoken;
    console.log(`💾 Retaining result set: ${cachetoken}`);
  } else {
    // Remove the result set as per IBM docs
    retainedResultSets.delete(cachetoken);
    console.log(`🗑️  Discarded result set: ${cachetoken}`);
  }

  // Build response - only include records if not SUMMONLY
  let recordsData = null;
  const summOnly = query.hasOwnProperty('SUMMONLY') || query.hasOwnProperty('summonly');

  if (!summOnly && records.length > 0) {
    recordsData = {};
    if (records.length === 1) {
      recordsData[resultSet.resourceType] = records[0];
    } else {
      recordsData[resultSet.resourceType] = records;
    }
  }

  const xmlResponse = createXMLResponse(resultSummary, recordsData);
  res.set('Content-Type', 'application/xml').send(xmlResponse);
});

/**
 * GET endpoint - retrieve resources with retained result set support
 */
app.get(`/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/*`, authenticateSession, (req, res) => {
  console.log(`GET ${req.path} from session: ${req.sessionId}`);

  const resourceType = parseResourceFromPath(req.path);
  const query = req.query;

  if (!resourceType) {
    const errorResponse = createXMLResponse({
      api_function: 'GET',
      api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDPARM,
      api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
      api_response1_alt: 'INVALIDPARM',
      api_response2_alt: '',
      recordcount: '0'
    });

    return res.status(400).set('Content-Type', 'application/xml').send(errorResponse);
  }

  // Skip CICSResultCache - handled by dedicated endpoint
  if (resourceType === 'cicsresultcache') {
    return res.status(400).set('Content-Type', 'application/xml').send(
      createXMLResponse({
        api_function: 'GET',
        api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDPARM,
        api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
        api_response1_alt: 'INVALIDPARM',
        api_response2_alt: 'Use CICSResultCache/{token} format',
        recordcount: '0'
      })
    );
  }

  // Check if this is a cache request using provided cacheToken
  if (query.cachetoken || query.cacheToken) {
    const providedToken = query.cachetoken || query.cacheToken;
    
    // First check retained result sets
    const retainedSet = retainedResultSets.get(providedToken);
    if (retainedSet) {
      // Check session access (security - only creator can access)
      if (retainedSet.sessionId !== req.sessionId) {
        console.log(`🚫 Access denied for cache token ${providedToken} - wrong session`);
        return res.status(403).set('Content-Type', 'application/xml').send(
          createXMLResponse({
            api_function: 'GET',
            api_response1: CMCI_CONSTANTS.RESPONSE_CODES.NOTAVAILABLE,
            api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
            api_response1_alt: 'NOTAVAILABLE',
            api_response2_alt: 'Access denied',
            recordcount: '0'
          })
        );
      }

      // Check if expired
      if (retainedSet.isExpired()) {
        console.log(`⏰ Cache token expired: ${providedToken}`);
        retainedResultSets.delete(providedToken);
        // Continue to generate new response below
      } else {
        console.log(`💾 Cache hit for token: ${providedToken}`);
        
        // Parse index and count from query params for cached results
        const index = parseInt(query.index || '1');
        const count = query.count ? parseInt(query.count) : null;
        const orderBy = query.orderby || query.ORDERBY;
        
        const { records, displayedCount, totalCount } = retainedSet.getRecords(index, count, orderBy);
        
        const resultSummary = {
          api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
          api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
          api_response1_alt: 'OK',
          api_response2_alt: '',
          recordcount: totalCount.toString(),
          displayed_recordcount: displayedCount.toString()
        };

        // Keep the result set if NODISCARD is specified
        const keepCache = query.hasOwnProperty('NODISCARD') || query.hasOwnProperty('nodiscard');
        if (keepCache) {
          resultSummary.cachetoken = providedToken;
          console.log(`💾 Retaining result set: ${providedToken}`);
        } else {
          // Remove the result set as per IBM docs
          retainedResultSets.delete(providedToken);
          console.log(`🗑️  Discarded result set: ${providedToken}`);
        }

        // Build response - only include records if not SUMMONLY
        let recordsData = null;
        const summOnly = query.hasOwnProperty('SUMMONLY') || query.hasOwnProperty('summonly');

        if (!summOnly && records.length > 0) {
          recordsData = {};
          if (records.length === 1) {
            recordsData[retainedSet.resourceType] = records[0];
          } else {
            recordsData[retainedSet.resourceType] = records;
          }
        }

        const xmlResponse = createXMLResponse(resultSummary, recordsData);
        return res.set('Content-Type', 'application/xml').send(xmlResponse);
      }
    }
    
    // Fall back to legacy cache for backward compatibility
    const cachedResult = cache.get(providedToken);
    if (cachedResult) {
      console.log(`💽 Legacy cache hit for token: ${providedToken}`);
      return res.set('Content-Type', 'application/xml').send(cachedResult);
    } else {
      console.log(`💽 Cache miss/expired for token: ${providedToken} - generating new response`);
    }
  }

  // Simulate no data scenario
  if (query.simulate === 'nodata') {
    const nodataResponse = createXMLResponse({
      api_source: 'CICSPlex SM',
      api_function: 'GET',
      api_response1: CMCI_CONSTANTS.RESPONSE_CODES.NODATA,
      api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
      api_response1_alt: 'NODATA',
      api_response2_alt: '',
      recordcount: '0'
    });

    return res.set('Content-Type', 'application/xml').send(nodataResponse);
  }

  // Generate mock data - use larger dataset for better caching demonstration
  const recordCount = parseInt(query.count || '10');
  const mockRecords = generateMockData(resourceType, recordCount);

  const resultSummary = {
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'OK',
    api_response2_alt: '',
    recordcount: mockRecords.length.toString(),
    displayed_recordcount: mockRecords.length.toString()
  };

  // Check for existing cache or create new cache token
  const providedToken = query.cachetoken || query.cacheToken;
  if (!providedToken) {
    // Create a unique key for this request based on resource type, session, and query params
    const requestKey = JSON.stringify({
      resourceType,
      sessionId: req.sessionId,
      count: query.count || '10',
      simulate: query.simulate,
      // Include other relevant query params that affect the result
      summonly: query.hasOwnProperty('SUMMONLY') || query.hasOwnProperty('summonly')
    });
    
    // Look for existing cache entry for this exact request
    let existingToken = null;
    for (const [token, resultSet] of retainedResultSets.entries()) {
      if (resultSet.sessionId === req.sessionId && 
          resultSet.resourceType === resourceType &&
          JSON.stringify({
            resourceType: resultSet.resourceType,
            sessionId: resultSet.sessionId,
            count: resultSet.query.count || '10',
            simulate: resultSet.query.simulate,
            summonly: resultSet.query.hasOwnProperty('SUMMONLY') || resultSet.query.hasOwnProperty('summonly')
          }) === requestKey) {
        existingToken = token;
        break;
      }
    }
    
    if (existingToken) {
      // Reuse existing cache
      resultSummary.cachetoken = existingToken;
      console.log(`♻️  Reusing existing cached result set: ${existingToken}`);
    } else {
      // Create new cache entry
      const cacheToken = generateCacheToken();
      const retainedSet = new RetainedResultSet(resourceType, mockRecords, req.sessionId, query);
      retainedResultSets.set(cacheToken, retainedSet);
      resultSummary.cachetoken = cacheToken;
      console.log(`💾 Auto-created retained result set: ${cacheToken} (${mockRecords.length} records)`);
    }
  }

  // Handle SUMMONLY - don't return records, just summary
  let recordsData = null;
  const summOnly = query.hasOwnProperty('SUMMONLY') || query.hasOwnProperty('summonly');

  if (!summOnly) {
    // Build records object
    recordsData = {};
    if (mockRecords.length === 1) {
      recordsData[resourceType] = mockRecords[0];
    } else {
      recordsData[resourceType] = mockRecords;
    }
  }

  const xmlResponse = createXMLResponse(resultSummary, recordsData);

  // Store in legacy cache if explicitly requested (for backward compatibility)
  if (query.cache === 'true' && !resultSummary.cachetoken) {
    const legacyCacheToken = generateCacheToken();
    cache.set(legacyCacheToken, xmlResponse);
    resultSummary.cachetoken = legacyCacheToken;
    console.log(`💽 Legacy cached response with token: ${legacyCacheToken}`);
  }

  res.set('Content-Type', 'application/xml').send(xmlResponse);
});

/**
 * POST endpoint - create resources
 */
app.post(`/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/*`, authenticateSession, (req, res) => {
  console.log(`POST ${req.path} from session: ${req.sessionId}`);

  const resourceType = parseResourceFromPath(req.path);

  if (!resourceType) {
    const errorResponse = createXMLResponse({
      api_function: 'POST',
      api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDPARM,
      api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
      api_response1_alt: 'INVALIDPARM',
      api_response2_alt: '',
      recordcount: '0'
    });

    return res.status(400).set('Content-Type', 'application/xml').send(errorResponse);
  }

  // Parse XML payload if provided
  let parsedBody = null;
  if (req.body) {
    try {
      // For mock purposes, just acknowledge the creation
      console.log('POST body received:', req.body);
    } catch (error) {
      console.error('Error parsing XML body:', error);
    }
  }

  const resultSummary = {
    api_function: 'POST',
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'OK',
    api_response2_alt: '',
    recordcount: '1',
    displayed_recordcount: '1'
  };

  const xmlResponse = createXMLResponse(resultSummary);
  res.set('Content-Type', 'application/xml').send(xmlResponse);
});

/**
 * PUT endpoint - update resources
 */
app.put(`/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/*`, authenticateSession, (req, res) => {
  console.log(`PUT ${req.path} from session: ${req.sessionId}`);

  const resourceType = parseResourceFromPath(req.path);

  if (!resourceType) {
    const errorResponse = createXMLResponse({
      api_function: 'PUT',
      api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDPARM,
      api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
      api_response1_alt: 'INVALIDPARM',
      api_response2_alt: '',
      recordcount: '0'
    });

    return res.status(400).set('Content-Type', 'application/xml').send(errorResponse);
  }

  const resultSummary = {
    api_function: 'PUT',
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'OK',
    api_response2_alt: '',
    recordcount: '1',
    displayed_recordcount: '1'
  };

  const xmlResponse = createXMLResponse(resultSummary);
  res.set('Content-Type', 'application/xml').send(xmlResponse);
});

/**
 * DELETE endpoint - delete resources
 */
app.delete(`/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/*`, authenticateSession, (req, res) => {
  console.log(`DELETE ${req.path} from session: ${req.sessionId}`);

  const resourceType = parseResourceFromPath(req.path);

  if (!resourceType) {
    const errorResponse = createXMLResponse({
      api_function: 'DELETE',
      api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDPARM,
      api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
      api_response1_alt: 'INVALIDPARM',
      api_response2_alt: '',
      recordcount: '0'
    });

    return res.status(400).set('Content-Type', 'application/xml').send(errorResponse);
  }

  const resultSummary = {
    api_function: 'DELETE',
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.OK,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'OK',
    api_response2_alt: '',
    recordcount: '1',
    displayed_recordcount: '1'
  };

  const xmlResponse = createXMLResponse(resultSummary);
  res.set('Content-Type', 'application/xml').send(xmlResponse);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size,
    cacheEntries: cache.size,
    ltpaTokens: ltpaTokens.size,
    retainedResultSets: retainedResultSets.size
  });
});

/**
 * Administrative endpoints for managing mock server
 */
app.get('/admin/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
    sessionId: id,
    username: data.username,
    loginTime: data.loginTime,
    lastActivity: data.lastActivity,
    ltpaToken2: data.ltpaToken2
  }));

  res.json(sessionList);
});

app.get('/admin/ltpa-tokens', (req, res) => {
  const tokenList = Array.from(ltpaTokens.entries()).map(([token, sessionId]) => {
    const session = sessions.get(sessionId);
    return {
      ltpaToken2: token,
      sessionId: sessionId,
      username: session?.username || 'unknown',
      lastActivity: session?.lastActivity
    };
  });

  res.json({
    ltpaTokens: tokenList,
    count: tokenList.length
  });
});

app.get('/admin/cache', (req, res) => {
  const legacyCacheList = Array.from(cache.keys());
  res.json({
    legacyCacheTokens: legacyCacheList,
    legacyCacheCount: legacyCacheList.length
  });
});

app.get('/admin/retained-results', (req, res) => {
  const retainedList = Array.from(retainedResultSets.entries()).map(([token, resultSet]) => ({
    cacheToken: token,
    resourceType: resultSet.resourceType,
    totalRecords: resultSet.totalRecords,
    sessionId: resultSet.sessionId,
    createdAt: resultSet.createdAt,
    lastAccessed: resultSet.lastAccessed,
    isExpired: resultSet.isExpired(),
    query: resultSet.query
  }));

  res.json({
    retainedResultSets: retainedList,
    count: retainedList.length
  });
});

app.delete('/admin/cache', (req, res) => {
  const legacyCount = cache.size;
  cache.clear();
  res.json({ message: 'Legacy cache cleared', count: legacyCount });
});

app.delete('/admin/retained-results', (req, res) => {
  const retainedCount = retainedResultSets.size;
  retainedResultSets.clear();
  res.json({ message: 'All retained result sets cleared', count: retainedCount });
});

app.delete('/admin/retained-results/:token', (req, res) => {
  const { token } = req.params;
  const existed = retainedResultSets.delete(token);

  if (existed) {
    res.json({ message: `Retained result set ${token} deleted` });
  } else {
    res.status(404).json({ error: `Retained result set ${token} not found` });
  }
});

app.delete('/admin/sessions', (req, res) => {
  const sessionCount = sessions.size;
  const ltpaTokenCount = ltpaTokens.size;
  sessions.clear();
  ltpaTokens.clear();
  // Also clear retained result sets since they're session-dependent
  const retainedCount = retainedResultSets.size;
  retainedResultSets.clear();

  res.json({
    message: 'All sessions, LtpaToken2 mappings, and retained result sets cleared',
    sessionCount: sessionCount,
    ltpaTokenCount: ltpaTokenCount,
    retainedResultSetsCount: retainedCount
  });
});

app.delete('/admin/ltpa-tokens', (req, res) => {
  const tokenCount = ltpaTokens.size;
  ltpaTokens.clear();
  
  // Remove LtpaToken2 from session objects as well
  for (const [sessionId, session] of sessions.entries()) {
    if (session.ltpaToken2) {
      delete session.ltpaToken2;
      sessions.set(sessionId, session);
    }
  }

  res.json({ 
    message: 'All LtpaToken2 mappings cleared', 
    count: tokenCount 
  });
});

/**
 * Error handling middleware
 */
app.use((error, req, res, next) => {
  console.error('Server error:', error);

  const errorResponse = createXMLResponse({
    api_function: req.method,
    api_response1: CMCI_CONSTANTS.RESPONSE_CODES.INVALIDDATA,
    api_response2: CMCI_CONSTANTS.SUCCESS_RESPONSE_2,
    api_response1_alt: 'INVALIDDATA',
    api_response2_alt: error.message || 'Internal server error',
    recordcount: '0'
  });

  res.status(500).set('Content-Type', 'application/xml').send(errorResponse);
});

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log(`🚀 CICS CMCI Mock Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Admin panel: http://localhost:${PORT}/admin/sessions`);
  console.log(`🔑 LtpaToken2 admin: http://localhost:${PORT}/admin/ltpa-tokens`);
  console.log(`📚 Example endpoint: http://localhost:${PORT}/${CMCI_CONSTANTS.CICS_SYSTEM_MANAGEMENT}/CICSManagedRegion`);
  console.log('');
  console.log('🔐 Authentication:');
  console.log('  - Initial: Use Basic Auth (testuser:testpass or adminusr:adminpas)');
  console.log('  - Subsequent: Use LtpaToken2 header or cookie (automatically set)');
  console.log('📝 Query parameters:');
  console.log('  - count=N: Return N mock records');
  console.log('  - simulate=nodata: Return NODATA response');
  console.log('  - cachetoken=TOKEN: Use existing cache token');
  console.log('  - nodiscard: Keep result set after request');
  console.log('  - summonly: Return summary only');
  console.log('  - index=N&count=M: Paginate cached results');
  console.log('  - orderby=FIELD: Sort cached results');
  console.log('📦 All responses now include automatic cache tokens!');
  console.log('🍪 LtpaToken2 cookies are automatically set for authenticated sessions');
});

module.exports = app;
