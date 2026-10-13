#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Fernando Rijo Cedeno


# CICS CMCI Mock Server - cURL Examples
# This script demonstrates various ways to interact with the mock server

BASE_URL="${MOCK_SERVER_URL:-http://127.0.0.1:9080}"
HEADERS_FILE=$(mktemp)
trap 'rm -f "$HEADERS_FILE"' EXIT
ADMIN_AUTH="Authorization: Basic $(echo -n 'adminusr:adminpas' | base64)"

echo "🚀 CICS CMCI Mock Server - cURL Examples"
echo "========================================"
echo "This script demonstrates:"
echo "- Admin authentication (static credentials)"
echo "- testuser OTP authentication flow"
echo "- LTPA token usage for subsequent requests"
echo ""

# Health check
echo "📊 Health Check:"
curl -s "$BASE_URL/health" | jq '.'
echo ""

# ===========================================
# OTP Authentication Flow for testuser
# ===========================================
echo "🔢 OTP Authentication Flow for testuser:"
echo "========================================="

echo "Step 1: Generate OTP for testuser"
OTP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/generate-otp" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser"}')
echo "$OTP_RESPONSE" | jq '.'

# Extract OTP from response
OTP=$(echo "$OTP_RESPONSE" | jq -r '.otp')
echo "Extracted OTP: $OTP"
echo ""

echo "Step 2: Check OTP status"
curl -s "$BASE_URL/auth/otp-status/testuser" | jq '.'
echo ""

echo "Step 3: Authenticate with OTP and capture LTPA token"
TESTUSER_AUTH="Authorization: Basic $(echo -n "testuser:$OTP" | base64)"
AUTH_RESPONSE=$(curl -s -H "$TESTUSER_AUTH" -D "$HEADERS_FILE" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")

# Extract LTPA token from Set-Cookie header
LTPA_TOKEN=$(grep -i 'set-cookie.*ltpatoken2' "$HEADERS_FILE" | sed 's/.*LtpaToken2=\([^;]*\).*/\1/')
echo "LTPA Token captured: ${LTPA_TOKEN:0:20}..."
echo ""

echo "Step 4: Use LTPA token for subsequent requests (no auth needed)"
if [ ! -z "$LTPA_TOKEN" ]; then
  curl -s -H "LtpaToken2: $LTPA_TOKEN" \
    "$BASE_URL/CICSSystemManagement/CICSCICSPlex?count=1" | head -10
  echo "... (truncated)"
else
  echo "❌ Failed to capture LTPA token"
fi
echo ""

# ===========================================
# Admin Authentication (Static Credentials)
# ===========================================
echo "🔐 Admin Authentication Flow:"
echo "============================="

echo "Admin using static credentials:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1" | head -10
echo "... (truncated)"
echo ""

# ===========================================
# Standard API Examples (using admin auth)
# ===========================================
echo "🔍 Standard API Examples:"
echo "========================="

echo "Get CICS Managed Regions:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion" | head -20
echo "..."
echo ""

echo "Get Multiple CICS Plexes:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSCICSPlex?count=2" | head -20
echo "..."
echo ""

echo "NODATA Simulation:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSProgram?simulate=nodata"
echo ""

echo "💾 Caching Example:"
echo "Step 1 - Request with cache enabled:"
CACHE_RESPONSE=$(curl -s -H "$ADMIN_AUTH" \
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
  curl -s -H "$ADMIN_AUTH" \
    "$BASE_URL/CICSSystemManagement/CICSManagedRegion?cachetoken=$CACHE_TOKEN" | head -10
  echo "..."
fi
echo ""

echo "📝 POST Request (Create Resource):"
curl -s -X POST \
  -H "$ADMIN_AUTH" \
  -H "Content-Type: application/xml" \
  -d '<request><create><parameter name="CSD"><cicsdefinitionprogram program="MYPROG" language="COBOL" /></parameter></create></request>' \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram"
echo ""

echo "✏️  PUT Request (Update Resource):"
curl -s -X PUT \
  -H "$ADMIN_AUTH" \
  -H "Content-Type: application/xml" \
  -d '<request><update><parameter name="CSD"><cicsdefinitionprogram program="MYPROG" status="DISABLED" /></parameter></update></request>' \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram"
echo ""

echo "🗑️  DELETE Request:"
curl -s -X DELETE \
  -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram/MYPROG"
echo ""

# ===========================================
# Admin Endpoints
# ===========================================
echo "🔧 Admin Endpoints:"
echo "=================="

echo "Sessions:"
curl -s -u "adminusr:adminpas" "$BASE_URL/admin/sessions" | jq '.'
echo ""

echo "LTPA Tokens:"
curl -s -u "adminusr:adminpas" "$BASE_URL/admin/ltpa-tokens" | jq '.'
echo ""

echo "Active OTPs:"
curl -s -u "adminusr:adminpas" "$BASE_URL/admin/otps" | jq '.'
echo ""

echo "Cache Status:"
curl -s -u "adminusr:adminpas" "$BASE_URL/admin/cache" | jq '.'
echo ""

echo "Retained Result Sets:"
curl -s -u "adminusr:adminpas" "$BASE_URL/admin/retained-results" | jq '.'
echo ""

echo "📚 Different Resource Types:"
echo ""

echo "Programs:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram?count=1" | head -5
echo "..."
echo ""

echo "Transactions:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionTransaction?count=1" | head -5
echo "..."
echo ""

echo "URI Maps:"
curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSDefinitionURIMap?count=1" | head -5
echo "..."
echo ""

# Clean up temp files
rm -f "$HEADERS_FILE"

echo "✅ All examples completed!"
echo ""
echo "💡 Tips:"
echo "   - Add '| jq .' to format JSON responses"
echo "   - Add '| xmllint --format -' to format XML responses"
echo "   - Use '?count=N' to get multiple records"
echo "   - Use '?simulate=nodata' to test error handling"
echo "   - Use '?cache=true' to enable caching"
echo ""
echo "🔐 Authentication Methods:"
echo "   - Admin: adminusr:adminpas (static credentials)"
echo "   - testuser: Generate OTP via POST /auth/generate-otp, use as password"
echo "   - Both: Use LTPA tokens for subsequent requests"
echo ""
echo "🔧 Admin Endpoints:"
echo "   - /admin/sessions - View active sessions"
echo "   - /admin/ltpa-tokens - View/manage LTPA tokens"
echo "   - /admin/otps - View/manage OTPs"
echo "   - /auth/generate-otp - Generate OTP for testuser"
