#!/bin/bash

# CICS CMCI Mock Server - cURL Examples
# This script demonstrates various ways to interact with the mock server

BASE_URL="http://localhost:9080"
AUTH_HEADER="Authorization: Basic $(echo -n 'testuser:testpass' | base64)"

echo "🚀 CICS CMCI Mock Server - cURL Examples"
echo "========================================"
echo ""

# Health check
echo "📊 Health Check:"
curl -s "$BASE_URL/health" | jq '.'
echo ""

# Basic resource retrieval
echo "🔍 Get CICS Managed Regions:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion" | head -20
echo "..."
echo ""

# Multiple records
echo "🔍 Get Multiple CICS Plexes:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSCICSPlex?count=2" | head -20
echo "..."
echo ""

# NODATA simulation
echo "🚫 NODATA Simulation:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSProgram?simulate=nodata"
echo ""

# Caching example
echo "💾 Caching Example:"
echo "Step 1 - Request with cache enabled:"
CACHE_RESPONSE=$(curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?cache=true")
echo "$CACHE_RESPONSE" | head -10
echo "..."

# Extract cache token from response
CACHE_TOKEN=$(echo "$CACHE_RESPONSE" | grep -o 'cachetoken="[^"]*"' | cut -d'"' -f2)
echo ""
echo "Cache token extracted: $CACHE_TOKEN"

if [ ! -z "$CACHE_TOKEN" ]; then
  echo ""
  echo "Step 2 - Retrieve using cache token:"
  curl -s -H "$AUTH_HEADER" \
    "$BASE_URL/CICSSystemManagement/CICSManagedRegion?cachetoken=$CACHE_TOKEN" | head -10
  echo "..."
fi
echo ""

# POST request
echo "📝 POST Request (Create Resource):"
curl -s -X POST \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/xml" \
  -d '<request><create><parameter name="CSD"><cicsdefinitionprogram program="MYPROG" language="COBOL" /></parameter></create></request>' \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram"
echo ""

# PUT request
echo "✏️  PUT Request (Update Resource):"
curl -s -X PUT \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/xml" \
  -d '<request><update><parameter name="CSD"><cicsdefinitionprogram program="MYPROG" status="DISABLED" /></parameter></update></request>' \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram"
echo ""

# DELETE request
echo "🗑️  DELETE Request:"
curl -s -X DELETE \
  -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram/MYPROG"
echo ""

# Admin endpoints
echo "🔧 Admin - Sessions:"
curl -s "$BASE_URL/admin/sessions" | jq '.'
echo ""

echo "🔧 Admin - Cache:"
curl -s "$BASE_URL/admin/cache" | jq '.'
echo ""

# Different resource types
echo "📚 Different Resource Types:"
echo ""

echo "Programs:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram?count=1" | head -5
echo "..."
echo ""

echo "Transactions:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionTransaction?count=1" | head -5
echo "..."
echo ""

echo "URI Maps:"
curl -s -H "$AUTH_HEADER" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionURIMap?count=1" | head -5
echo "..."
echo ""

echo "✅ All examples completed!"
echo ""
echo "💡 Tips:"
echo "   - Add '| jq .' to format JSON responses"
echo "   - Add '| xmllint --format -' to format XML responses"
echo "   - Use '?count=N' to get multiple records"
echo "   - Use '?simulate=nodata' to test error handling"
echo "   - Use '?cache=true' to enable caching"
