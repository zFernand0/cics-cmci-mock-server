<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2025 Fernando Rijo Cedeno
-->

# CICS CMCI Mock Server

A Node.js mock server that simulates the CICS CMCI (Customer Information Control System - CICSPlex System Manager Configuration Interface) REST API for testing and development of the CICS VSCode extension.

## Features

- ✅ **XML Request/Response Handling**: Fully supports XML-based communication as expected by the CICS SDK
- ✅ **Authentication Simulation**: Basic auth with session management and LtpaToken2 cookie support
- ✅ **Automatic Caching**: All responses include cache tokens for improved performance
- ✅ **Retained Result Sets**: Complete implementation of CICS CMCI retained result sets with NODISCARD
- ✅ **Result Pagination**: Support for index/count parameters and ORDERBY sorting
- ✅ **Cache Management**: 15-minute automatic expiry and session-based security
- ✅ **Multiple Resource Types**: Supports all major CICS resource types (Programs, Transactions, Regions, etc.)
- ✅ **Error Simulation**: Can simulate various CMCI response codes (OK, NODATA, INVALIDPARM, etc.)
- ✅ **RESTful Operations**: GET, POST, PUT, DELETE operations on CICS resources
- ✅ **LtpaToken2 Support**: Cookie-based authentication with 8-hour token expiration
- ✅ **Admin Interface**: Built-in endpoints for managing sessions, tokens, and cache

## Quick Start

### Installation

```bash
cd cics-cmci-mock-server
npm install
```

### Running the Server

```bash
# Start the server
npm start

# Or for development with auto-reload
npm run dev
```

The server will start on `http://localhost:9080` by default.

## Usage Examples

### Basic Resource Retrieval

```bash
# Get CICS managed regions (with basic auth) - automatically includes cache token
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"
# Response: <resultsummary ... cachetoken="ABC123DEF456" recordcount="10" />
# Also sets LtpaToken2 cookie for subsequent requests

# Get multiple records - all responses now include cache tokens
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSCICSPlex?count=2" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Use cache token for efficient pagination
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion?cachetoken=ABC123DEF456&index=2&count=1" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Simulate NODATA response
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSProgram?simulate=nodata" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Use LtpaToken2 for subsequent requests (no Basic Auth needed)
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"
```

### Retained Result Sets (NODISCARD) Examples

The mock server implements comprehensive CICS CMCI retained result sets as documented in [IBM's CICS documentation](https://www.ibm.com/docs/en/cics-ts/6.x?topic=cgr-using-retained-result-sets-improve-performance-get-requests).

```bash
# Step 1: Create retained result set with NODISCARD and SUMMONLY
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSProgram?NODISCARD&SUMMONLY&count=1000" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Response includes cachetoken for subsequent requests:
# <resultsummary api_response1="1024" cachetoken="A1B2C3D4E5F6G7H8" recordcount="1000"/>

# Step 2: Retrieve first 10 records using CICSResultCache (now using LtpaToken2)
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/A1B2C3D4E5F6G7H8/1/10?NODISCARD" \
  -H "LtpaToken2: YOUR_TOKEN_FROM_STEP1"

# Step 3: Retrieve next 10 records (11-20)
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/A1B2C3D4E5F6G7H8/11/10?NODISCARD" \
  -H "LtpaToken2: YOUR_TOKEN_FROM_STEP1"

# Step 4: Final request without NODISCARD to discard the result set
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/A1B2C3D4E5F6G7H8?SUMMONLY" \
  -H "LtpaToken2: YOUR_TOKEN_FROM_STEP1"
```

### Pagination and Ordering Examples

```bash
# Create large result set for pagination
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion?NODISCARD&SUMMONLY&count=500" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Get records 21-40 (page 2 with 20 records per page) - using LtpaToken2
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/{TOKEN}/21/20?NODISCARD" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"

# Get first 10 records ordered by program name
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/{TOKEN}/1/10?NODISCARD&orderby=program" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"

# Get records with multiple sort fields
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSResultCache/{TOKEN}/1/10?NODISCARD&orderby=status,program" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"
```

### Legacy Caching (for backward compatibility)

```bash
# Request with legacy caching enabled
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion?cache=true" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

# Use legacy cache token to retrieve cached results
curl -X GET "http://localhost:9080/CICSSystemManagement/CICSManagedRegion?cachetoken=ABC123DEF456" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"
```

### Resource Operations

```bash
# Create a new program definition
curl -X POST "http://localhost:9080/CICSSystemManagement/CICSDefinitionProgram" \
  -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)" \
  -H "Content-Type: application/xml" \
  -d '<request><create><parameter name="CSD"><cicsdefinitionprogram program="MYPROG" /></parameter></create></request>'

# Update a resource (using LtpaToken2 from previous request)
curl -X PUT "http://localhost:9080/CICSSystemManagement/CICSDefinitionProgram" \
  -H "LtpaToken2: YOUR_TOKEN_HERE" \
  -H "Content-Type: application/xml"

# Delete a resource
curl -X DELETE "http://localhost:9080/CICSSystemManagement/CICSDefinitionProgram/MYPROG" \
  -H "LtpaToken2: YOUR_TOKEN_HERE"
```

## Supported Resource Types

The mock server supports all major CICS resource types:

- **CICSManagedRegion** - CICS managed regions
- **CICSCICSPlex** - CICS plexes
- **CICSRegion** - CICS regions
- **CICSDefinitionProgram** - Program definitions
- **CICSDefinitionTransaction** - Transaction definitions
- **CICSDefinitionURIMap** - URI map definitions
- **CICSDefinitionWebService** - Web service definitions
- **CICSDefinitionBundle** - Bundle definitions
- **CICSProgram** - Program resources
- **CICSLibrary** - Library resources
- **CICSTCPIPService** - TCP/IP service resources
- **CICSPipeline** - Pipeline resources
- **CICSWebService** - Web service resources
- **CICSJVMServer** - JVM server resources
- **CICSURIMap** - URI map resources
- **CICSRegionGroup** - Region group resources
- **CICSCSDGroup** - CSD group definitions
- **CICSResultCache** - Result cache
- **CICSTask** - Task resources
- **CICSBundle** - Bundle resources
- **CICSLocalFile** - Local file resources
- **CICSLocalTransaction** - Local transaction resources
- **CICSRemoteTransaction** - Remote transaction resources

## Query Parameters

### Standard CICS CMCI Parameters

- `NODISCARD` - Create/maintain retained result set (no value required)
- `SUMMONLY` - Return summary only without records (no value required)
- `ORDERBY=field1,field2` - Sort results by specified fields (max 32 fields)

### Mock Server Specific Parameters

- `count=N` - Return N mock records (default: 10)
- `simulate=nodata` - Simulate NODATA response (1027)
- `cachetoken=TOKEN` - Use existing cache token to retrieve cached results
- `index=N` - Start pagination from record N (1-based, used with cachetoken)
- `cache=true` - Enable legacy result caching (for backward compatibility)

### URL Path Parameters (for CICSResultCache)

- `/CICSResultCache/{token}` - Access retained result set
- `/CICSResultCache/{token}/{index}` - Start from specific record (1-based)
- `/CICSResultCache/{token}/{index}/{count}` - Get specific range of records

## Administrative Endpoints

### 📊 Monitoring
- `GET /health` - Server health check (includes LtpaToken2 count)
- `GET /admin/sessions` - List active sessions with LtpaToken2 info
- `GET /admin/ltpa-tokens` - List all active LtpaToken2 mappings
- `GET /admin/cache` - List legacy cache tokens  
- `GET /admin/retained-results` - List all retained result sets with details

### 🗑️ Cleanup
- `DELETE /admin/sessions` - Clear all sessions, LtpaToken2 mappings, and retained result sets
- `DELETE /admin/ltpa-tokens` - Clear all LtpaToken2 mappings only
- `DELETE /admin/cache` - Clear all legacy cache entries
- `DELETE /admin/retained-results` - Clear all retained result sets
- `DELETE /admin/retained-results/{token}` - Delete specific retained result set

## Response Format

All responses follow the standard CICS CMCI XML format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response xmlns="http://www.ibm.com/xmlns/prod/CICS/smw2int"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.ibm.com/xmlns/prod/CICS/smw2int http://localhost:9080/CICSSystemManagement/schema/CICSSystemManagement.xsd"
  version="3.0" connect_version="0620">
  <resultsummary api_response1="1024" api_response2="0"
    api_response1_alt="OK" api_response2_alt=""
    recordcount="1" displayed_recordcount="1" />
  <records>
    <cicsmanagedregion _keydata="..." applid="REGION1" ... />
  </records>
</response>
```

## Response Codes

- `1024` (OK) - Successful operation
- `1027` (NODATA) - No data found
- `1028` (INVALIDPARM) - Invalid parameter
- `1034` (NOTAVAILABLE) - Resource not available
- `1041` (INVALIDDATA) - Invalid data

## Authentication

The mock server supports both Basic Authentication and LtpaToken2 cookie-based authentication, simulating real CICS authentication flows.

### 🔐 Supported Credentials

Only the following username/password combinations are accepted:

- **testuser** / **testpass**
- **adminusr** / **adminpas**

### 🍪 LtpaToken2 Flow

1. **Initial Authentication**: Use Basic Auth with valid credentials
2. **Cookie Generation**: Server automatically sets `LtpaToken2` cookie (8-hour expiration)
3. **Subsequent Requests**: Use `LtpaToken2` header or cookie instead of Basic Auth

### Examples

```bash
# Step 1: Initial authentication with Basic Auth
curl -u "testuser:testpass" "http://localhost:9080/CICSSystemManagement/CICSManagedRegion"
# Server sets LtpaToken2 cookie in response

# Step 2: Extract token from Set-Cookie header (or use browser cookies)
# Set-Cookie: LtpaToken2=ABC123...; Max-Age=28800; HttpOnly; SameSite=Lax

# Step 3: Use LtpaToken2 for subsequent requests
curl -H "LtpaToken2: ABC123..." "http://localhost:9080/CICSSystemManagement/CICSManagedRegion"

# Alternative: Use Authorization header format
curl -H "Authorization: Basic $(echo -n 'testuser:testpass' | base64)" \
  "http://localhost:9080/CICSSystemManagement/CICSManagedRegion"

# Invalid credentials are rejected
curl -u "wronguser:wrongpass" "http://localhost:9080/CICSSystemManagement/CICSManagedRegion"
# Response: HTTP 401 {"error":"Invalid username or password"}
```

### 🔍 Admin Endpoints

Monitor authentication state:

- `GET /admin/sessions` - View active user sessions with LtpaToken2 info
- `GET /admin/ltpa-tokens` - View all active LtpaToken2 mappings
- `DELETE /admin/ltpa-tokens` - Clear all token mappings
- `DELETE /admin/sessions` - Clear all sessions and tokens

## Configuration

Environment variables:

- `PORT` - Server port (default: 9080)

## Integration with CICS SDK

This mock server is designed to work seamlessly with the `CicsCmciRestClient` from the CICS SDK. Simply configure your client to point to `http://localhost:9080` instead of your actual CICS system.

Example TypeScript usage:

```typescript
import { CicsCmciRestClient } from "@zowe/cics-for-zowe-sdk";
import { AbstractSession } from "@zowe/imperative";

const session = new AbstractSession({
  hostname: "localhost",
  port: 9080,
  protocol: "http",
  type: "basic",
  user: "testuser",        // Valid credentials: testuser:testpass or adminusr:adminpas
  password: "testpass",
});

// Use the mock server - automatically handles LtpaToken2 cookies
const response = await CicsCmciRestClient.getExpectParsedXml(session, "/CICSSystemManagement/CICSManagedRegion");

// Subsequent requests will automatically use LtpaToken2 cookie
const nextResponse = await CicsCmciRestClient.getExpectParsedXml(session, "/CICSSystemManagement/CICSProgram");
```

## 🚀 New: Automatic Caching

**All responses now include cache tokens automatically!** This improves performance by enabling efficient pagination and data reuse without requiring the `NODISCARD` parameter.

### How It Works

1. **Every GET request** automatically generates a cache token and stores the result set
2. **Use the cache token** in subsequent requests for pagination: `?cachetoken=TOKEN&index=2&count=5`
3. **Cache expires** after 15 minutes of inactivity (follows IBM CICS specification)
4. **Invalid/expired tokens** automatically generate fresh data (graceful fallback)

### Benefits

- 🎯 **Zero configuration** - automatic caching for all responses
- 🚀 **Better performance** - cached pagination instead of regenerating data
- 📱 **Improved UX** - efficient paging for large datasets
- 🔐 **Secure** - session-isolated cache access
- ⚡ **Backwards compatible** - existing clients continue to work

### Example Usage

```bash
# Step 1: Make any request - cache token included automatically
curl -u "testuser:testpass" "http://localhost:9080/CICSSystemManagement/CICSProgram?count=20"
# Response: <resultsummary ... cachetoken="ABC123" recordcount="20" />
# Also sets LtpaToken2 cookie

# Step 2: Use cache token for efficient pagination (using LtpaToken2)
curl -H "LtpaToken2: YOUR_TOKEN" "http://localhost:9080/CICSSystemManagement/CICSProgram?cachetoken=ABC123&index=5&count=3"
# Returns records 5-7 from cached result set

# Step 3: Invalid token automatically generates new data
curl -H "LtpaToken2: YOUR_TOKEN" "http://localhost:9080/CICSSystemManagement/CICSProgram?cachetoken=INVALID&count=5"
# Gracefully falls back to generating fresh response
```

## Retained Result Sets Features

The mock server implements the complete CICS CMCI retained result sets functionality:

### ✅ Implemented Features

- **NODISCARD Parameter**: Creates retained result sets stored on server
- **SUMMONLY Parameter**: Returns summary without records for initial queries
- **CICSResultCache Endpoint**: Access retained results with `/CICSResultCache/{token}`
- **Pagination Support**: Use `/{index}/{count}` for record ranges (1-based indexing)
- **ORDERBY Support**: Sort by multiple fields with `?orderby=field1,field2`
- **15-Minute Expiry**: Automatic cleanup of unused result sets
- **Session Security**: Only the creating session can access its result sets
- **Concurrent Access**: Multiple requests can use the same cache token simultaneously
- **Proper Cleanup**: Result sets are discarded when NODISCARD is not specified

### 🔄 Cache Lifecycle

1. **Create**: `GET /CICSSystemManagement/{resource}?NODISCARD&SUMMONLY`
2. **Access**: `GET /CICSSystemManagement/CICSResultCache/{token}/{index}/{count}?NODISCARD`
3. **Cleanup**: `GET /CICSSystemManagement/CICSResultCache/{token}` (without NODISCARD)

### 🛡️ Security Model

- Each retained result set is tied to the creating session
- HTTP 403 returned for cross-session access attempts
- HTTP 404 returned for non-existent or expired tokens
- Automatic cleanup prevents memory leaks

### 📊 Monitoring

- Admin endpoints provide visibility into active result sets
- Detailed information includes creation time, last access, expiry status
- Individual result sets can be manually deleted via admin interface

## Testing

### Run Comprehensive Demo

```bash
# Demonstrates all retained result sets features
node examples/retained-result-sets-demo.js
```

### Run Basic Tests

```bash
# Basic functionality tests
node examples/test-client.js
```

## Contributing

This mock server can be extended to support additional CICS features:

- Complex filtering and search criteria with CRITERIA parameter
- Transaction support with PUT operations
- Bundle operations with bundle-specific resources
- Custom response templates for different scenarios
- WebSocket support for real-time updates
- Advanced security models and authentication

## Development Scripts

### License Header Management

This project includes a script to add SPDX license headers to all source files:

```bash
# Check which files would get license headers (dry run)
npm run license:check

# Add license headers to all applicable files
npm run license:add
```

The script automatically adds appropriate headers for different file types:
- **JavaScript files**: `/** SPDX-License-Identifier: Apache-2.0 ... */`
- **Shell scripts**: `# SPDX-License-Identifier: Apache-2.0 ...` (preserves shebang)
- **Markdown files**: `<!-- SPDX-License-Identifier: Apache-2.0 ... -->`

Files that already have license headers are automatically skipped.

## License

Apache License 2.0 - see [LICENSE](LICENSE) file for details.
