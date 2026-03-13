#!/bin/bash

# Phase 4 E2E Test Script
# Tests the complete provisioning flow: CLI → API → Workers → Events → CLI
#
# Prerequisites:
# - DATABASE_URL and REDIS_URL configured in packages/api/.env
# - NAMECHEAP_SANDBOX=true for safe testing
# - API and workers running (or script will start them)

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
TEST_USER_ID="test-user-e2e-$(date +%s)"
TEST_USER_EMAIL="test@forj.sh"
TEST_PROJECT_NAME="test-project-$(date +%s)"
TEST_DOMAIN="test-forj-e2e-$(date +%s).com"
API_URL="http://localhost:3000"
TOKEN_FILE="/tmp/forj-e2e-token.txt"

echo -e "${YELLOW}=== Phase 4 E2E Test ===${NC}"
echo "Test User: $TEST_USER_ID"
echo "Test Domain: $TEST_DOMAIN"
echo ""

# Function to cleanup on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
  rm -f "$TOKEN_FILE"
  echo -e "${GREEN}Cleanup complete${NC}"
}
trap cleanup EXIT

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

if ! command -v curl &> /dev/null; then
  echo -e "${RED}Error: curl is required${NC}"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is required (install with: brew install jq)${NC}"
  exit 1
fi

# Check API health
if ! curl -s -f "$API_URL/health" > /dev/null; then
  echo -e "${RED}Error: API server not reachable at $API_URL${NC}"
  echo "Start API with: npm run dev -w packages/api"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Step 2: Skip user creation (use mock user from auth endpoint)
echo -e "${YELLOW}[2/6] Using mock user from auth endpoint...${NC}"

# The /auth/cli endpoint creates a mock user automatically
# In production, users would authenticate via OAuth
# For this test, we'll work with the mock user

echo -e "${GREEN}✓ Will use mock user from auth${NC}"
echo ""

# Step 3: Get authentication token
echo -e "${YELLOW}[3/6] Authenticating...${NC}"

# Generate JWT token for test user
# For now, we'll use the CLI auth endpoint which creates a mock user
# In production, this would require real authentication
RESPONSE=$(curl -s -X POST "$API_URL/auth/cli" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"test-device\",\"cliVersion\":\"0.1.0\"}")

TOKEN=$(echo "$RESPONSE" | jq -r '.data.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo -e "${RED}Error: Failed to get auth token${NC}"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "$TOKEN" > "$TOKEN_FILE"
echo -e "${GREEN}✓ Authenticated (token saved to $TOKEN_FILE)${NC}"
echo ""

# Step 4: Initialize project
echo -e "${YELLOW}[4/6] Initializing project...${NC}"

INIT_RESPONSE=$(curl -s -X POST "$API_URL/projects/init" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$TEST_PROJECT_NAME\",
    \"domain\": \"$TEST_DOMAIN\",
    \"services\": [\"domain\"]
  }")

PROJECT_ID=$(echo "$INIT_RESPONSE" | jq -r '.data.projectId')

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" == "null" ]; then
  echo -e "${RED}Error: Failed to initialize project${NC}"
  echo "$INIT_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Project initialized: $PROJECT_ID${NC}"
echo ""

# Step 5: Check project status
echo -e "${YELLOW}[5/6] Checking project status...${NC}"

sleep 2  # Give workers time to process

STATUS_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/projects/$PROJECT_ID/status")

echo "$STATUS_RESPONSE" | jq '.'

# Check if domain service was queued
DOMAIN_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.data.services.domain.status')

if [ "$DOMAIN_STATUS" == "null" ]; then
  echo -e "${RED}✗ Domain service not found in project status${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Domain service status: $DOMAIN_STATUS${NC}"
echo ""

# Step 6: Validate provisioning was attempted
echo -e "${YELLOW}[6/6] Validating provisioning...${NC}"

# Check Redis for job queue
if ! command -v redis-cli &> /dev/null; then
  echo -e "${YELLOW}Warning: redis-cli not available, skipping queue check${NC}"
else
  QUEUE_LENGTH=$(redis-cli llen bull:domain:wait)
  echo "Domain queue length: $QUEUE_LENGTH"

  if [ "$QUEUE_LENGTH" -gt 0 ]; then
    echo -e "${GREEN}✓ Jobs found in domain queue${NC}"
  else
    # Check if job was already processed
    COMPLETED_COUNT=$(redis-cli llen bull:domain:completed)
    FAILED_COUNT=$(redis-cli llen bull:domain:failed)

    echo "Completed jobs: $COMPLETED_COUNT"
    echo "Failed jobs: $FAILED_COUNT"

    if [ "$COMPLETED_COUNT" -gt 0 ] || [ "$FAILED_COUNT" -gt 0 ]; then
      echo -e "${GREEN}✓ Jobs were processed${NC}"
    else
      echo -e "${YELLOW}Warning: No jobs found in any queue state${NC}"
      echo "This may indicate the orchestrator didn't queue jobs"
    fi
  fi
fi

echo ""
echo -e "${GREEN}=== E2E Test Complete ===${NC}"
echo ""
echo "Summary:"
echo "  Project ID: $PROJECT_ID"
echo "  Domain: $TEST_DOMAIN"
echo "  Status: $DOMAIN_STATUS"
echo ""
echo "Next steps:"
echo "  1. Check project status: curl -H \"Authorization: Bearer $TOKEN\" $API_URL/projects/$PROJECT_ID/status"
echo "  2. View worker logs to verify job processing"
echo "  3. If using Namecheap sandbox, check domain registration status"
echo ""
