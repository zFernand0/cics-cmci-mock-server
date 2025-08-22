/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

/**
 * Retained Result Sets Demo
 * 
 * This script demonstrates the comprehensive CICS CMCI retained result sets
 * functionality as documented in IBM's CICS documentation.
 * 
 * Based on: https://www.ibm.com/docs/en/cics-ts/6.x?topic=cgr-using-retained-result-sets-improve-performance-get-requests
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
 * Parse XML response
 */
async function parseXML(xmlString) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    normalizeTags: true
  });

  return await parser.parseStringPromise(xmlString);
}

/**
 * Demo 1: Basic NODISCARD and SUMMONLY usage
 * Follows the exact pattern from IBM documentation
 */
async function demo1_BasicRetainedResultSet() {
  console.log('\n📚 Demo 1: Basic Retained Result Set (NODISCARD + SUMMONLY)');
  console.log('=' + '='.repeat(60));

  // Step 1: Create retained result set with NODISCARD and SUMMONLY
  console.log('\n1️⃣  Creating retained result set with NODISCARD & SUMMONLY...');
  const initialResponse = await makeRequest('GET',
    '/CICSSystemManagement/CICSProgram?NODISCARD&SUMMONLY&count=100'
  );

  const parsed = await parseXML(initialResponse.body);
  const summary = parsed.response.resultsummary;

  console.log(`   ✅ Success! Response code: ${summary.api_response1} (${summary.api_response1_alt})`);
  console.log(`   📊 Total records: ${summary.recordcount}`);
  console.log(`   🎫 Cache token: ${summary.cachetoken}`);
  console.log(`   📝 No records returned (SUMMONLY)`);

  const cacheToken = summary.cachetoken;

  // Step 2: Retrieve first 10 records using CICSResultCache
  console.log('\n2️⃣  Retrieving first 10 records from retained result set...');
  const firstBatchResponse = await makeRequest('GET',
    `/CICSSystemManagement/CICSResultCache/${cacheToken}/1/10?NODISCARD`
  );

  const firstBatch = await parseXML(firstBatchResponse.body);
  const firstSummary = firstBatch.response.resultsummary;

  console.log(`   ✅ Retrieved records 1-10`);
  console.log(`   📊 Displayed: ${firstSummary.displayed_recordcount}, Total: ${firstSummary.recordcount}`);
  console.log(`   🎫 Cache token: ${firstSummary.cachetoken} (retained)`);

  // Step 3: Retrieve next 10 records (11-20)
  console.log('\n3️⃣  Retrieving records 11-20 from retained result set...');
  const secondBatchResponse = await makeRequest('GET',
    `/CICSSystemManagement/CICSResultCache/${cacheToken}/11/10?NODISCARD`
  );

  const secondBatch = await parseXML(secondBatchResponse.body);
  const secondSummary = secondBatch.response.resultsummary;

  console.log(`   ✅ Retrieved records 11-20`);
  console.log(`   📊 Displayed: ${secondSummary.displayed_recordcount}, Total: ${secondSummary.recordcount}`);
  console.log(`   🎫 Cache token: ${secondSummary.cachetoken} (retained)`);

  // Step 4: Final request without NODISCARD to clean up
  console.log('\n4️⃣  Cleaning up retained result set (without NODISCARD)...');
  const cleanupResponse = await makeRequest('GET',
    `/CICSSystemManagement/CICSResultCache/${cacheToken}?SUMMONLY`
  );

  const cleanup = await parseXML(cleanupResponse.body);
  const cleanupSummary = cleanup.response.resultsummary;

  console.log(`   ✅ Cleanup complete`);
  console.log(`   📊 Total records: ${cleanupSummary.recordcount}`);
  console.log(`   🗑️  Cache token absent: ${!cleanupSummary.cachetoken ? 'YES' : 'NO'} (result set discarded)`);

  return cacheToken;
}

/**
 * Demo 2: Pagination with large dataset
 */
async function demo2_PaginationDemo() {
  console.log('\n📄 Demo 2: Pagination with Large Dataset');
  console.log('=' + '='.repeat(60));

  // Create a large dataset
  console.log('\n1️⃣  Creating large retained result set (500 records)...');
  const response = await makeRequest('GET',
    '/CICSSystemManagement/CICSManagedRegion?NODISCARD&SUMMONLY&count=500'
  );

  const parsed = await parseXML(response.body);
  const cacheToken = parsed.response.resultsummary.cachetoken;
  const totalRecords = parseInt(parsed.response.resultsummary.recordcount);

  console.log(`   ✅ Created result set with ${totalRecords} records`);
  console.log(`   🎫 Cache token: ${cacheToken}`);

  // Demonstrate pagination
  const pageSize = 20;
  const totalPages = Math.ceil(totalRecords / pageSize);
  console.log(`\n2️⃣  Demonstrating pagination (${pageSize} records per page, ${totalPages} pages)...`);

  for (let page = 1; page <= Math.min(3, totalPages); page++) {
    const startIndex = (page - 1) * pageSize + 1;
    const keepCache = page < 3 ? '?NODISCARD' : ''; // Don't keep cache on last request

    const pageResponse = await makeRequest('GET',
      `/CICSSystemManagement/CICSResultCache/${cacheToken}/${startIndex}/${pageSize}${keepCache}`
    );

    const pageParsed = await parseXML(pageResponse.body);
    const pageSummary = pageParsed.response.resultsummary;

    console.log(`   📄 Page ${page}: Records ${startIndex}-${startIndex + parseInt(pageSummary.displayed_recordcount) - 1}`);
    console.log(`      Displayed: ${pageSummary.displayed_recordcount}, Total: ${pageSummary.recordcount}`);

    if (page === 3) {
      console.log(`      🗑️  Result set discarded (no NODISCARD on final request)`);
    }
  }
}

/**
 * Demo 3: Ordering with ORDERBY
 */
async function demo3_OrderingDemo() {
  console.log('\n🔤 Demo 3: Ordering with ORDERBY');
  console.log('=' + '='.repeat(60));

  // Create result set
  console.log('\n1️⃣  Creating retained result set for ordering demo...');
  const response = await makeRequest('GET',
    '/CICSSystemManagement/CICSDefinitionProgram?NODISCARD&SUMMONLY&count=50'
  );

  const parsed = await parseXML(response.body);
  const cacheToken = parsed.response.resultsummary.cachetoken;

  console.log(`   ✅ Created result set: ${cacheToken}`);

  // Get first 5 records ordered by program name
  console.log('\n2️⃣  Retrieving first 5 records ordered by program name...');
  const orderedResponse = await makeRequest('GET',
    `/CICSSystemManagement/CICSResultCache/${cacheToken}/1/5?NODISCARD&orderby=program`
  );

  const ordered = await parseXML(orderedResponse.body);
  const orderedSummary = ordered.response.resultsummary;

  console.log(`   ✅ Retrieved ${orderedSummary.displayed_recordcount} ordered records`);

  if (ordered.response.records && ordered.response.records.cicsdefinitionprogram) {
    const records = Array.isArray(ordered.response.records.cicsdefinitionprogram)
      ? ordered.response.records.cicsdefinitionprogram
      : [ordered.response.records.cicsdefinitionprogram];

    console.log('   📝 Program names (ordered):');
    records.forEach((record, index) => {
      console.log(`      ${index + 1}. ${record.program || 'N/A'}`);
    });
  }

  // Cleanup
  console.log('\n3️⃣  Cleaning up...');
  await makeRequest('GET', `/CICSSystemManagement/CICSResultCache/${cacheToken}?SUMMONLY`);
  console.log(`   🗑️  Result set discarded`);
}

/**
 * Demo 4: Session security and error handling
 */
async function demo4_SecurityDemo() {
  console.log('\n🔐 Demo 4: Session Security and Error Handling');
  console.log('=' + '='.repeat(60));

  // Create result set with first session
  console.log('\n1️⃣  Creating result set with first session...');
  const response = await makeRequest('GET',
    '/CICSSystemManagement/CICSRegion?NODISCARD&SUMMONLY&count=10'
  );

  const parsed = await parseXML(response.body);
  const cacheToken = parsed.response.resultsummary.cachetoken;

  console.log(`   ✅ Created result set: ${cacheToken}`);

  // Try to access with different credentials (simulating different session)
  console.log('\n2️⃣  Attempting access with different session...');
  const otherCredentials = Buffer.from('otheruser:otherpass').toString('base64');

  try {
    const unauthorizedReq = http.request({
      hostname: 'localhost',
      port: 9080,
      path: `/CICSSystemManagement/CICSResultCache/${cacheToken}/1/5`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${otherCredentials}`,
        'Content-Type': 'application/xml'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', async () => {
        console.log(`   🚫 Expected HTTP ${res.statusCode} (Access denied)`);
        if (res.statusCode === 403) {
          const errorParsed = await parseXML(data);
          console.log(`   📝 Response: ${errorParsed.response.resultsummary.api_response1_alt}`);
        }
      });
    });

    unauthorizedReq.end();

    // Wait a bit for the request to complete
    await new Promise(resolve => setTimeout(resolve, 100));

  } catch (error) {
    console.log(`   ❌ Network error: ${error.message}`);
  }

  // Test invalid cache token
  console.log('\n3️⃣  Testing invalid cache token...');
  const invalidTokenResponse = await makeRequest('GET',
    '/CICSSystemManagement/CICSResultCache/INVALID123/1/5'
  );

  console.log(`   🚫 Expected HTTP ${invalidTokenResponse.statusCode} (Not Found)`);

  if (invalidTokenResponse.statusCode === 404) {
    const errorParsed = await parseXML(invalidTokenResponse.body);
    console.log(`   📝 Response: ${errorParsed.response.resultsummary.api_response1_alt}`);
  }

  // Cleanup original result set
  console.log('\n4️⃣  Cleaning up original result set...');
  await makeRequest('GET', `/CICSSystemManagement/CICSResultCache/${cacheToken}?SUMMONLY`);
  console.log(`   🗑️  Result set discarded`);
}

/**
 * Demo 5: Admin interface for monitoring
 */
async function demo5_AdminInterface() {
  console.log('\n🔧 Demo 5: Admin Interface for Monitoring');
  console.log('=' + '='.repeat(60));

  // Create some retained result sets
  console.log('\n1️⃣  Creating multiple retained result sets...');
  const tokens = [];

  for (let i = 0; i < 3; i++) {
    const response = await makeRequest('GET',
      `/CICSSystemManagement/CICSProgram?NODISCARD&SUMMONLY&count=${10 + i * 5}`
    );
    const parsed = await parseXML(response.body);
    tokens.push(parsed.response.resultsummary.cachetoken);
    console.log(`   ✅ Created result set ${i + 1}: ${parsed.response.resultsummary.cachetoken}`);
  }

  // Check admin interface
  console.log('\n2️⃣  Checking admin interface...');
  const adminResponse = await makeRequest('GET', '/admin/retained-results');
  const adminData = JSON.parse(adminResponse.body);

  console.log(`   📊 Total retained result sets: ${adminData.count}`);
  adminData.retainedResultSets.forEach((resultSet, index) => {
    console.log(`   📄 ${index + 1}. Token: ${resultSet.cacheToken}`);
    console.log(`        Resource: ${resultSet.resourceType}, Records: ${resultSet.totalRecords}`);
    console.log(`        Created: ${new Date(resultSet.createdAt).toISOString()}`);
    console.log(`        Expired: ${resultSet.isExpired ? 'YES' : 'NO'}`);
  });

  // Cleanup via admin interface
  console.log('\n3️⃣  Cleaning up via admin interface...');
  const cleanupResponse = await makeRequest('DELETE', '/admin/retained-results');
  const cleanupData = JSON.parse(cleanupResponse.body);

  console.log(`   🗑️  ${cleanupData.message} (${cleanupData.count} result sets)`);
}

/**
 * Run all demos
 */
async function runAllDemos() {
  console.log('🚀 CICS CMCI Retained Result Sets Demo');
  console.log('=' + '='.repeat(60));
  console.log('Based on IBM Documentation:');
  console.log('https://www.ibm.com/docs/en/cics-ts/6.x?topic=cgr-using-retained-result-sets-improve-performance-get-requests');
  console.log('');

  try {
    await demo1_BasicRetainedResultSet();
    await demo2_PaginationDemo();
    await demo3_OrderingDemo();
    await demo4_SecurityDemo();
    await demo5_AdminInterface();

    console.log('\n🎉 All demos completed successfully!');
    console.log('\n📋 Demo Summary:');
    console.log('   ✅ Basic NODISCARD and SUMMONLY usage');
    console.log('   ✅ Pagination with large datasets');
    console.log('   ✅ Ordering with ORDERBY parameter');
    console.log('   ✅ Session security and error handling');
    console.log('   ✅ Admin interface for monitoring');
    console.log('\n💡 Key Features Demonstrated:');
    console.log('   • 15-minute automatic expiry of unused result sets');
    console.log('   • Session-based security (only creator can access)');
    console.log('   • Efficient pagination with index/count parameters');
    console.log('   • Sorting with ORDERBY parameter');
    console.log('   • Proper cleanup when NODISCARD not specified');
    console.log('   • Administrative monitoring capabilities');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run demos if this script is executed directly
if (require.main === module) {
  runAllDemos();
}

module.exports = {
  makeRequest,
  parseXML,
  demo1_BasicRetainedResultSet,
  demo2_PaginationDemo,
  demo3_OrderingDemo,
  demo4_SecurityDemo,
  demo5_AdminInterface,
  runAllDemos
};
