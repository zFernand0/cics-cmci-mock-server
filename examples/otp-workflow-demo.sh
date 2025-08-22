#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Fernando Rijo Cedeno

# OTP Authentication Workflow Demo
# This script demonstrates the complete OTP authentication flow for testuser

BASE_URL="http://localhost:9080"

echo "🔢 CICS CMCI Mock Server - OTP Authentication Demo"
echo "=================================================="
echo ""

# Function to display colored output
print_step() {
    echo -e "\033[1;34m$1\033[0m"
}

print_success() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

print_info() {
    echo -e "\033[1;33m💡 $1\033[0m"
}

# Step 1: Check current OTP status
print_step "Step 1: Check current OTP status for testuser"
OTP_STATUS=$(curl -s "$BASE_URL/auth/otp-status/testuser")
echo "$OTP_STATUS" | jq '.'

HAS_OTP=$(echo "$OTP_STATUS" | jq -r '.hasOTP')
if [ "$HAS_OTP" = "true" ]; then
    print_info "testuser already has an active OTP"
    REMAINING=$(echo "$OTP_STATUS" | jq -r '.timeRemainingSeconds')
    print_info "Time remaining: ${REMAINING} seconds"
else
    print_info "No active OTP found for testuser"
fi
echo ""

# Step 2: Generate new OTP
print_step "Step 2: Generate new OTP for testuser"
OTP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/generate-otp" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser"}')

echo "$OTP_RESPONSE" | jq '.'

# Extract OTP from response
OTP=$(echo "$OTP_RESPONSE" | jq -r '.otp')
if [ "$OTP" = "null" ] || [ -z "$OTP" ]; then
    print_error "Failed to generate OTP"
    exit 1
fi

print_success "OTP generated: $OTP"
echo ""

# Step 3: Verify OTP status
print_step "Step 3: Verify OTP status after generation"
NEW_STATUS=$(curl -s "$BASE_URL/auth/otp-status/testuser")
echo "$NEW_STATUS" | jq '.'
echo ""

# Step 4: Test authentication with OTP
print_step "Step 4: Authenticate with OTP (capture response headers)"
echo "Using credentials: testuser:$OTP"

# Save headers to temp file and test authentication
TEMP_HEADERS="/tmp/otp_demo_headers.txt"
AUTH_RESPONSE=$(curl -s -u "testuser:$OTP" -D "$TEMP_HEADERS" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")

# Check if authentication was successful
if [ $? -eq 0 ] && [[ "$AUTH_RESPONSE" == *"resultsummary"* ]]; then
    print_success "Authentication successful!"
    echo "Response preview:"
    echo "$AUTH_RESPONSE" | head -10
    echo "... (truncated)"
else
    print_error "Authentication failed"
    echo "Response: $AUTH_RESPONSE"
    rm -f "$TEMP_HEADERS"
    exit 1
fi
echo ""

# Step 5: Extract and display LTPA token
print_step "Step 5: Extract LTPA token from response headers"
if [ -f "$TEMP_HEADERS" ]; then
    echo "Response headers:"
    cat "$TEMP_HEADERS"
    echo ""
    
    # Extract LTPA token
    LTPA_TOKEN=$(grep -i 'set-cookie.*ltpatoken2' "$TEMP_HEADERS" | sed 's/.*LtpaToken2=\([^;]*\).*/\1/')
    
    if [ ! -z "$LTPA_TOKEN" ]; then
        print_success "LTPA token captured!"
        echo "Token (first 30 chars): ${LTPA_TOKEN:0:30}..."
        echo "Full token length: ${#LTPA_TOKEN} characters"
    else
        print_error "Failed to extract LTPA token"
    fi
else
    print_error "Headers file not found"
fi
echo ""

# Step 6: Test LTPA token authentication
if [ ! -z "$LTPA_TOKEN" ]; then
    print_step "Step 6: Test authentication with LTPA token"
    echo "Making request with LtpaToken2 header..."
    
    TOKEN_RESPONSE=$(curl -s -H "LtpaToken2: $LTPA_TOKEN" \
      "$BASE_URL/CICSSystemManagement/CICSCICSPlex?count=2")
    
    if [ $? -eq 0 ] && [[ "$TOKEN_RESPONSE" == *"resultsummary"* ]]; then
        print_success "LTPA token authentication successful!"
        echo "Response preview:"
        echo "$TOKEN_RESPONSE" | head -10
        echo "... (truncated)"
    else
        print_error "LTPA token authentication failed"
        echo "Response: $TOKEN_RESPONSE"
    fi
    echo ""
fi

# Step 7: Verify OTP is consumed
print_step "Step 7: Verify OTP is consumed after use"
FINAL_STATUS=$(curl -s "$BASE_URL/auth/otp-status/testuser")
echo "$FINAL_STATUS" | jq '.'

FINAL_HAS_OTP=$(echo "$FINAL_STATUS" | jq -r '.hasOTP')
if [ "$FINAL_HAS_OTP" = "false" ]; then
    print_success "OTP was properly consumed (single-use)"
else
    print_error "OTP should have been consumed"
fi
echo ""

# Step 8: Demonstrate OTP expiration (optional)
print_step "Step 8: Demonstrate failed authentication with old OTP"
echo "Attempting to use the consumed OTP: $OTP"

FAILED_RESPONSE=$(curl -s -u "testuser:$OTP" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")

if [[ "$FAILED_RESPONSE" == *"error"* ]]; then
    print_success "Authentication properly rejected consumed OTP"
    echo "Error response: $FAILED_RESPONSE"
else
    print_error "Authentication should have failed with consumed OTP"
fi
echo ""

# Step 9: Admin monitoring
print_step "Step 9: Check admin endpoints for monitoring"

echo "Active sessions:"
curl -s "$BASE_URL/admin/sessions" | jq '.'
echo ""

echo "Active LTPA tokens:"
curl -s "$BASE_URL/admin/ltpa-tokens" | jq '.'
echo ""

echo "Active OTPs:"
curl -s "$BASE_URL/admin/otps" | jq '.'
echo ""

# Cleanup
rm -f "$TEMP_HEADERS"

print_step "🎯 Demo Summary"
echo "=============="
print_success "✅ OTP generation for testuser"
print_success "✅ OTP status monitoring"
print_success "✅ Authentication with OTP"
print_success "✅ LTPA token capture and usage"
print_success "✅ OTP single-use validation"
print_success "✅ Admin endpoint monitoring"
echo ""
print_info "💡 Key takeaways:"
echo "   - testuser requires OTP for each new authentication"
echo "   - OTPs are single-use and expire in 5 minutes"
echo "   - LTPA tokens allow subsequent requests without re-authentication"
echo "   - Admin endpoints provide monitoring capabilities"
echo ""
print_info "🔄 Next steps:"
echo "   - Run this demo multiple times to see the complete flow"
echo "   - Try waiting 5+ minutes to see OTP expiration"
echo "   - Use the LTPA token for multiple requests before it expires"
