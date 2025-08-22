#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Fernando Rijo Cedeno

# LTPA Token Management Demo
# This script demonstrates LTPA token management and admin capabilities

BASE_URL="http://localhost:9080"
ADMIN_AUTH="Authorization: Basic $(echo -n 'adminusr:adminpas' | base64)"

echo "🔑 CICS CMCI Mock Server - LTPA Token Management Demo"
echo "===================================================="
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

# Step 1: Check initial state
print_step "Step 1: Check initial token and session state"

echo "Active sessions:"
INITIAL_SESSIONS=$(curl -s "$BASE_URL/admin/sessions")
echo "$INITIAL_SESSIONS" | jq '.'
echo ""

echo "Active LTPA tokens:"
INITIAL_TOKENS=$(curl -s "$BASE_URL/admin/ltpa-tokens")
echo "$INITIAL_TOKENS" | jq '.'
echo ""

# Step 2: Create sessions for both users
print_step "Step 2: Create authenticated sessions for both users"

echo "2.1 - Admin authentication:"
ADMIN_HEADERS="/tmp/admin_headers.txt"
ADMIN_RESPONSE=$(curl -s -H "$ADMIN_AUTH" -D "$ADMIN_HEADERS" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")

if [[ "$ADMIN_RESPONSE" == *"resultsummary"* ]]; then
    print_success "Admin authenticated successfully"
    
    # Extract admin LTPA token
    ADMIN_LTPA=$(grep -i 'set-cookie.*ltpatoken2' "$ADMIN_HEADERS" | sed 's/.*LtpaToken2=\([^;]*\).*/\1/')
    if [ ! -z "$ADMIN_LTPA" ]; then
        print_success "Admin LTPA token: ${ADMIN_LTPA:0:20}..."
    fi
else
    print_error "Admin authentication failed"
fi
echo ""

echo "2.2 - testuser OTP authentication:"
# Generate OTP for testuser
OTP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/generate-otp" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser"}')

OTP=$(echo "$OTP_RESPONSE" | jq -r '.otp')
if [ "$OTP" != "null" ] && [ ! -z "$OTP" ]; then
    print_success "OTP generated for testuser: $OTP"
    
    # Authenticate testuser with OTP
    TESTUSER_HEADERS="/tmp/testuser_headers.txt"
    TESTUSER_RESPONSE=$(curl -s -u "testuser:$OTP" -D "$TESTUSER_HEADERS" \
      "$BASE_URL/CICSSystemManagement/CICSCICSPlex?count=1")
    
    if [[ "$TESTUSER_RESPONSE" == *"resultsummary"* ]]; then
        print_success "testuser authenticated successfully"
        
        # Extract testuser LTPA token
        TESTUSER_LTPA=$(grep -i 'set-cookie.*ltpatoken2' "$TESTUSER_HEADERS" | sed 's/.*LtpaToken2=\([^;]*\).*/\1/')
        if [ ! -z "$TESTUSER_LTPA" ]; then
            print_success "testuser LTPA token: ${TESTUSER_LTPA:0:20}..."
        fi
    else
        print_error "testuser authentication failed"
    fi
else
    print_error "Failed to generate OTP for testuser"
fi
echo ""

# Step 3: Monitor active tokens and sessions
print_step "Step 3: Monitor active tokens and sessions after authentication"

echo "Updated sessions:"
UPDATED_SESSIONS=$(curl -s "$BASE_URL/admin/sessions")
echo "$UPDATED_SESSIONS" | jq '.'
echo ""

echo "Updated LTPA tokens:"
UPDATED_TOKENS=$(curl -s "$BASE_URL/admin/ltpa-tokens")
echo "$UPDATED_TOKENS" | jq '.'
echo ""

# Step 4: Test token usage
print_step "Step 4: Test using LTPA tokens for API requests"

if [ ! -z "$ADMIN_LTPA" ]; then
    echo "4.1 - Using admin LTPA token:"
    ADMIN_TOKEN_RESPONSE=$(curl -s -H "LtpaToken2: $ADMIN_LTPA" \
      "$BASE_URL/CICSSystemManagement/CICSDefinitionProgram?count=2")
    
    if [[ "$ADMIN_TOKEN_RESPONSE" == *"resultsummary"* ]]; then
        print_success "Admin LTPA token working"
        echo "Programs response: $(echo "$ADMIN_TOKEN_RESPONSE" | grep -o 'recordcount="[^"]*"')"
    else
        print_error "Admin LTPA token failed"
    fi
    echo ""
fi

if [ ! -z "$TESTUSER_LTPA" ]; then
    echo "4.2 - Using testuser LTPA token:"
    TESTUSER_TOKEN_RESPONSE=$(curl -s -H "LtpaToken2: $TESTUSER_LTPA" \
      "$BASE_URL/CICSSystemManagement/CICSDefinitionTransaction?count=3")
    
    if [[ "$TESTUSER_TOKEN_RESPONSE" == *"resultsummary"* ]]; then
        print_success "testuser LTPA token working"
        echo "Transactions response: $(echo "$TESTUSER_TOKEN_RESPONSE" | grep -o 'recordcount="[^"]*"')"
    else
        print_error "testuser LTPA token failed"
    fi
    echo ""
fi

# Step 5: Demonstrate token management
print_step "Step 5: Demonstrate token management capabilities"

echo "5.1 - Current token count:"
TOKEN_COUNT=$(curl -s "$BASE_URL/admin/ltpa-tokens" | jq '.tokens | length')
print_info "Active tokens: $TOKEN_COUNT"
echo ""

echo "5.2 - Test invalid token:"
INVALID_RESPONSE=$(curl -s -H "LtpaToken2: INVALID_TOKEN_12345" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion")

if [[ "$INVALID_RESPONSE" == *"error"* ]]; then
    print_success "Invalid token properly rejected"
    echo "Error: $INVALID_RESPONSE"
else
    print_error "Invalid token should have been rejected"
fi
echo ""

# Step 6: Selective token cleanup
print_step "Step 6: Demonstrate selective token management"

echo "6.1 - Clear all LTPA tokens:"
CLEAR_RESPONSE=$(curl -s -X DELETE "$BASE_URL/admin/ltpa-tokens")
echo "$CLEAR_RESPONSE" | jq '.'
echo ""

echo "6.2 - Verify tokens are cleared:"
CLEARED_TOKENS=$(curl -s "$BASE_URL/admin/ltpa-tokens")
echo "$CLEARED_TOKENS" | jq '.'

CLEARED_COUNT=$(echo "$CLEARED_TOKENS" | jq '.tokens | length')
if [ "$CLEARED_COUNT" = "0" ]; then
    print_success "All LTPA tokens cleared successfully"
else
    print_error "Token clearance failed"
fi
echo ""

echo "6.3 - Test cleared tokens (should fail):"
if [ ! -z "$ADMIN_LTPA" ]; then
    CLEARED_TOKEN_RESPONSE=$(curl -s -H "LtpaToken2: $ADMIN_LTPA" \
      "$BASE_URL/CICSSystemManagement/CICSManagedRegion")
    
    if [[ "$CLEARED_TOKEN_RESPONSE" == *"error"* ]]; then
        print_success "Cleared token properly rejected"
    else
        print_error "Cleared token should have been rejected"
    fi
fi
echo ""

# Step 7: Session management
print_step "Step 7: Demonstrate session management"

echo "7.1 - Current sessions:"
CURRENT_SESSIONS=$(curl -s "$BASE_URL/admin/sessions")
echo "$CURRENT_SESSIONS" | jq '.'
echo ""

echo "7.2 - Clear all sessions:"
SESSION_CLEAR_RESPONSE=$(curl -s -X DELETE "$BASE_URL/admin/sessions")
echo "$SESSION_CLEAR_RESPONSE" | jq '.'
echo ""

echo "7.3 - Verify sessions are cleared:"
FINAL_SESSIONS=$(curl -s "$BASE_URL/admin/sessions")
echo "$FINAL_SESSIONS" | jq '.'
echo ""

# Step 8: Re-authentication after cleanup
print_step "Step 8: Re-authentication after cleanup"

echo "8.1 - Admin re-authentication:"
REAUTH_ADMIN=$(curl -s -H "$ADMIN_AUTH" \
  "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")

if [[ "$REAUTH_ADMIN" == *"resultsummary"* ]]; then
    print_success "Admin can re-authenticate after cleanup"
else
    print_error "Admin re-authentication failed"
fi
echo ""

echo "8.2 - testuser re-authentication (new OTP required):"
NEW_OTP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/generate-otp" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser"}')

NEW_OTP=$(echo "$NEW_OTP_RESPONSE" | jq -r '.otp')
if [ "$NEW_OTP" != "null" ] && [ ! -z "$NEW_OTP" ]; then
    REAUTH_TESTUSER=$(curl -s -u "testuser:$NEW_OTP" \
      "$BASE_URL/CICSSystemManagement/CICSManagedRegion?count=1")
    
    if [[ "$REAUTH_TESTUSER" == *"resultsummary"* ]]; then
        print_success "testuser can re-authenticate with new OTP"
    else
        print_error "testuser re-authentication failed"
    fi
else
    print_error "Failed to generate new OTP"
fi
echo ""

# Cleanup temp files
rm -f /tmp/admin_headers.txt /tmp/testuser_headers.txt

print_step "🎯 Token Management Demo Summary"
echo "================================"
print_success "✅ Session and token monitoring"
print_success "✅ Multi-user LTPA token generation"
print_success "✅ Token-based API authentication"
print_success "✅ Invalid token rejection"
print_success "✅ Selective token cleanup"
print_success "✅ Session management"
print_success "✅ Re-authentication workflows"
echo ""
print_info "💡 Key insights:"
echo "   - LTPA tokens enable seamless subsequent requests"
echo "   - Tokens are automatically generated during authentication"
echo "   - Admin endpoints provide full token lifecycle management"
echo "   - Token cleanup invalidates existing tokens immediately"
echo "   - Both users can maintain separate authenticated sessions"
echo ""
print_info "🔧 Administrative capabilities:"
echo "   - Monitor active sessions and tokens in real-time"
echo "   - Selectively clear tokens or sessions"
echo "   - Validate token usage patterns"
echo "   - Troubleshoot authentication issues"
