/**
 * Test client for CICS CMCI Mock Server
 * 
 * This script demonstrates how to interact with the mock server
 * and validates that it works correctly with the expected XML format.
 */

const http = require('http');
const xml2js = require('xml2js');

const MOCK_SERVER_URL = 'localhost:9080';
const TEST_CREDENTIALS = Buffer.from('testuser:testpass').toString('base64');

/**
 * Make an HTTP request to the mock server
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 9080,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${TEST_CREDENTIALS}`,
        'Content-Type': 'application/xml'
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
  if (response1.body !== response2.body) {
    console.log('⚠️  Cache responses differ (this might be OK if records have timestamps)');
  } else {
    console.log('✅ Cache returned identical response');
  }

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
 * Test admin endpoints
 */
async function testAdminEndpoints() {
  console.log('\n🧪 Testing admin endpoints...');

  // Test sessions endpoint
  const sessionsResponse = await makeRequest('GET', '/admin/sessions');
  const sessions = JSON.parse(sessionsResponse.body);
  console.log(`   Active sessions: ${sessions.length}`);

  // Test cache endpoint
  const cacheResponse = await makeRequest('GET', '/admin/cache');
  const cache = JSON.parse(cacheResponse.body);
  console.log(`   Cache entries: ${cache.count}`);

  console.log('✅ Admin endpoints test passed');
  return { sessions, cache };
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting CICS CMCI Mock Server tests...');
  console.log(`Target: http://${MOCK_SERVER_URL}`);

  try {
    await testHealthCheck();
    await testBasicGet();
    await testMultipleRecords();
    await testNoDataSimulation();
    await testCaching();
    await testPost();
    await testAdminEndpoints();

    console.log('\n🎉 All tests passed successfully!');
    console.log('\n📋 Test Summary:');
    console.log('   ✅ Health check');
    console.log('   ✅ Basic GET request');
    console.log('   ✅ Multiple records');
    console.log('   ✅ NODATA simulation');
    console.log('   ✅ Caching functionality');
    console.log('   ✅ POST request');
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
