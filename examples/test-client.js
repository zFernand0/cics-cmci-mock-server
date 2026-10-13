/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

/**
 * Test client for CICS CMCI Mock Server
 * 
 * This script demonstrates how to interact with the mock server
 * and validates that it works correctly with the expected XML format.
 */

const http = require('http');
const xml2js = require('xml2js');

const MOCK_SERVER_URL = new URL(process.env.MOCK_SERVER_URL || 'http://127.0.0.1:9080');
const ADMIN_CREDENTIALS = Buffer.from('adminusr:adminpas').toString('base64');

/**
 * Make an HTTP request to the mock server
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MOCK_SERVER_URL.hostname,
      port: Number(MOCK_SERVER_URL.port || 80),
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${ADMIN_CREDENTIALS}`,
        'Content-Type': path.startsWith('/auth/') ? 'application/json' : 'application/xml'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

/**
 * Parse XML response and validate structure
 */
async function parseAndValidateXML(xmlString) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    normalizeTags: true
  });

  try {
    const result = await parser.parseStringPromise(xmlString);

    // Validate basic structure
    if (!result.response) {
      throw new Error('Missing response element');
    }

    if (!result.response.resultsummary) {
      throw new Error('Missing resultsummary element');
    }

    const summary = result.response.resultsummary;
    if (!summary.api_response1 || !summary.api_response2) {
      throw new Error('Missing required response codes');
    }

    console.log('✅ XML structure validation passed');
    return result;

  } catch (error) {
    console.error('❌ XML parsing/validation failed:', error.message);
    throw error;
  }
}

/**
 * Test basic GET request
 */
async function testBasicGet() {
  console.log('\n🧪 Testing basic GET request...');

  const response = await makeRequest('GET', '/CICSSystemManagement/CICSManagedRegion');

  if (response.statusCode !== 200) {
    throw new Error(`Expected status 200, got ${response.statusCode}`);
  }

  const parsed = await parseAndValidateXML(response.body);

  if (parsed.response.resultsummary.api_response1 !== '1024') {
    throw new Error('Expected success response code 1024');
  }

  console.log('✅ Basic GET test passed');
  return parsed;
}

/**
 * Test multiple records
 */
async function testMultipleRecords() {
  console.log('\n🧪 Testing multiple records...');

  const response = await makeRequest('GET', '/CICSSystemManagement/CICSCICSPlex?count=2');
  const parsed = await parseAndValidateXML(response.body);

  if (parsed.response.resultsummary.recordcount !== '2') {
    throw new Error('Expected 2 records');
  }

  if (!Array.isArray(parsed.response.records.cicscicsplex)) {
    throw new Error('Expected array of records for multiple results');
  }

  console.log('✅ Multiple records test passed');
  return parsed;
}

/**
 * Test NODATA simulation
 */
async function testNoDataSimulation() {
  console.log('\n🧪 Testing NODATA simulation...');

  const response = await makeRequest('GET', '/CICSSystemManagement/CICSProgram?simulate=nodata');
  const parsed = await parseAndValidateXML(response.body);

  if (parsed.response.resultsummary.api_response1 !== '1027') {
    throw new Error('Expected NODATA response code 1027');
  }

  if (parsed.response.resultsummary.api_response1_alt !== 'NODATA') {
    throw new Error('Expected NODATA response text');
  }

  console.log('✅ NODATA simulation test passed');
  return parsed;
}

/**
 * Test caching functionality
 */
async function testCaching() {
  console.log('\n🧪 Testing caching functionality...');

  // Request with cache enabled
  const response1 = await makeRequest('GET', '/CICSSystemManagement/CICSManagedRegion?cache=true');
  const parsed1 = await parseAndValidateXML(response1.body);

  if (!parsed1.response.resultsummary.cachetoken) {
    throw new Error('Expected cache token in response');
  }

  const cacheToken = parsed1.response.resultsummary.cachetoken;
  console.log(`Cache token received: ${cacheToken}`);

  // Use cache token to retrieve same data
  const response2 = await makeRequest('GET', `/CICSSystemManagement/CICSManagedRegion?cachetoken=${cacheToken}`);
  const parsed2 = await parseAndValidateXML(response2.body);

  // Should get the same data back
  if (JSON.stringify(parsed1.response.records) !== JSON.stringify(parsed2.response.records)) {
    throw new Error('Cached records differ from the original snapshot');
  }
  console.log('✅ Cache returned identical records');

  console.log('✅ Caching test passed');
  return { parsed1, parsed2 };
}

/**
 * Test POST request
 */
async function testPost() {
  console.log('\n🧪 Testing POST request...');

  const xmlBody = `<request>
    <create>
      <parameter name="CSD">
        <cicsdefinitionprogram program="TESTPROG" language="COBOL" />
      </parameter>
    </create>
  </request>`;

  const response = await makeRequest('POST', '/CICSSystemManagement/CICSDefinitionProgram', xmlBody);

  if (response.statusCode !== 200) {
    throw new Error(`Expected status 200, got ${response.statusCode}`);
  }

  const parsed = await parseAndValidateXML(response.body);

  if (parsed.response.resultsummary.api_response1 !== '1024') {
    throw new Error('Expected success response code 1024');
  }

  console.log('✅ POST test passed');
  return parsed;
}

/**
 * Test health check endpoint
 */
async function testHealthCheck() {
  console.log('\n🧪 Testing health check...');

  const response = await makeRequest('GET', '/health');

  if (response.statusCode !== 200) {
    throw new Error(`Expected status 200, got ${response.statusCode}`);
  }

  const healthData = JSON.parse(response.body);

  if (healthData.status !== 'healthy') {
    throw new Error('Expected healthy status');
  }

  console.log('✅ Health check test passed');
  console.log(`   Server status: ${healthData.status}`);
  console.log(`   Active sessions: ${healthData.activeSessions}`);
  console.log(`   Cache entries: ${healthData.cacheEntries}`);

  return healthData;
}

/**
 * Test OTP authentication flow
 */
async function testOTPAuthentication() {
  console.log('\n🔢 Testing OTP authentication...');

  // Generate OTP for testuser
  console.log('   Generating OTP for testuser...');
  const otpResponse = await makeRequest('POST', '/auth/generate-otp', JSON.stringify({username: 'testuser'}));
  
  if (otpResponse.statusCode !== 200) {
    throw new Error(`OTP generation failed: ${otpResponse.statusCode}`);
  }

  const otpData = JSON.parse(otpResponse.body);
  console.log(`   OTP generated: ${otpData.otp}`);

  // Check OTP status
  const statusResponse = await makeRequest('GET', '/auth/otp-status/testuser');
  const statusData = JSON.parse(statusResponse.body);
  console.log(`   OTP status: ${statusData.hasOTP ? 'Active' : 'Inactive'}`);

  // Test authentication with OTP
  console.log('   Testing authentication with OTP...');
  const testUserCredentials = Buffer.from(`testuser:${otpData.otp}`).toString('base64');
  
  const authOptions = {
    hostname: MOCK_SERVER_URL.hostname,
    port: Number(MOCK_SERVER_URL.port || 80),
    path: '/CICSSystemManagement/CICSManagedRegion?count=1',
    method: 'GET',
    headers: {
      'Authorization': `Basic ${testUserCredentials}`,
      'Content-Type': 'application/xml'
    }
  };

  const authResult = await new Promise((resolve, reject) => {
    const req = http.request(authOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });

  if (authResult.statusCode !== 200) {
    throw new Error(`OTP authentication failed: ${authResult.statusCode}`);
  }

  // Extract LTPA token from headers
  const setCookieHeader = authResult.headers['set-cookie']?.find(cookie => cookie.includes('LtpaToken2'));
  const ltpaToken = setCookieHeader ? setCookieHeader.match(/LtpaToken2=([^;]+)/)?.[1] : null;
  
  if (ltpaToken) {
    console.log(`   LTPA token captured: ${ltpaToken.substring(0, 20)}...`);
    
    // Test subsequent request with LTPA token
    console.log('   Testing LTPA token authentication...');
    const tokenOptions = {
      hostname: MOCK_SERVER_URL.hostname,
      port: Number(MOCK_SERVER_URL.port || 80),
      path: '/CICSSystemManagement/CICSCICSPlex?count=1',
      method: 'GET',
      headers: {
        'LtpaToken2': ltpaToken,
        'Content-Type': 'application/xml'
      }
    };

    const tokenResult = await new Promise((resolve, reject) => {
      const req = http.request(tokenOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });

    if (tokenResult.statusCode !== 200) {
      throw new Error(`LTPA token authentication failed: ${tokenResult.statusCode}`);
    }
    console.log('   LTPA token authentication successful');
  }

  console.log('✅ OTP authentication test passed');
  return { otp: otpData.otp, ltpaToken };
}

/**
 * Test admin endpoints
 */
async function testAdminEndpoints() {
  console.log('\n🧪 Testing admin endpoints...');

  // Test sessions endpoint
  const sessionsResponse = await makeRequest('GET', '/admin/sessions');
  const sessions = JSON.parse(sessionsResponse.body);
  console.log(`   Active sessions: ${sessions.sessions ? sessions.sessions.length : 0}`);

  // Test LTPA tokens endpoint
  const tokensResponse = await makeRequest('GET', '/admin/ltpa-tokens');
  const tokens = JSON.parse(tokensResponse.body);
  console.log(`   Active LTPA tokens: ${tokens.tokens ? tokens.tokens.length : 0}`);

  // Test OTPs endpoint
  const otpsResponse = await makeRequest('GET', '/admin/otps');
  const otps = JSON.parse(otpsResponse.body);
  console.log(`   Active OTPs: ${otps.count || 0}`);

  // Test cache endpoint
  const cacheResponse = await makeRequest('GET', '/admin/cache');
  const cache = JSON.parse(cacheResponse.body);
  console.log(`   Cache entries: ${cache.legacyCacheCount}`);

  console.log('✅ Admin endpoints test passed');
  return { sessions, tokens, otps, cache };
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting CICS CMCI Mock Server tests...');
  console.log(`Target: ${MOCK_SERVER_URL}`);

  try {
    await testHealthCheck();
    await testBasicGet();
    await testMultipleRecords();
    await testNoDataSimulation();
    await testCaching();
    await testPost();
    await testOTPAuthentication();
    await testAdminEndpoints();

    console.log('\n🎉 All tests passed successfully!');
    console.log('\n📋 Test Summary:');
    console.log('   ✅ Health check');
    console.log('   ✅ Basic GET request (admin auth)');
    console.log('   ✅ Multiple records');
    console.log('   ✅ NODATA simulation');
    console.log('   ✅ Caching functionality');
    console.log('   ✅ POST request');
    console.log('   ✅ OTP authentication & LTPA tokens');
    console.log('   ✅ Admin endpoints');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  makeRequest,
  parseAndValidateXML,
  testBasicGet,
  testMultipleRecords,
  testNoDataSimulation,
  testCaching,
  testPost,
  testHealthCheck,
  testAdminEndpoints,
  runAllTests
};
