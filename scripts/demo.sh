#!/bin/bash
# =============================================================================
# Evidence Locker - Demo Script
# =============================================================================
# Usage: ./scripts/demo.sh [start|stop|seed|test]
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

API_URL="http://localhost:3001"

case "${1:-start}" in
  start)
    echo -e "${BLUE}Starting Evidence Locker Demo Environment...${NC}"
    docker compose up -d

    echo -e "${BLUE}Waiting for services to be healthy...${NC}"
    sleep 5

    until curl -s "$API_URL/api/v1/health" > /dev/null 2>&1; do
      echo "Waiting for API..."
      sleep 2
    done

    echo -e "${GREEN}✓ Demo environment ready!${NC}"
    echo ""
    echo "Access points:"
    echo "  API:        $API_URL"
    echo "  Dashboard:  https://reg-d-compliance-demo.bolt.host"
    echo "  LocalStack: http://localhost:4566 (S3/KMS mock)"
    echo "  Postgres:   localhost:5432 (compliance / compliance)"
    echo ""
    echo "Run './scripts/demo.sh seed' to populate with sample data"
    ;;

  stop)
    echo -e "${BLUE}Stopping demo environment...${NC}"
    docker compose down
    echo -e "${GREEN}✓ Stopped${NC}"
    ;;

  clean)
    echo -e "${RED}Removing demo environment and all data...${NC}"
    docker compose down -v
    echo -e "${GREEN}✓ Cleaned${NC}"
    ;;

  seed)
    echo -e "${BLUE}Seeding demo data...${NC}"

    # Get auth token using correct endpoint and payload
    echo "Getting authentication token..."
    TOKEN=$(curl -s -X POST "$API_URL/api/v1/auth/token" \
      -H "Content-Type: application/json" \
      -d '{"email":"demo@example.com","role":"compliance"}' | jq -r '.token')

    if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
      echo -e "${RED}Failed to get auth token${NC}"
      exit 1
    fi

    AUTH="Authorization: Bearer $TOKEN"
    echo -e "${GREEN}✓ Got auth token${NC}"

    # Get control IDs from the existing catalog
    echo ""
    echo "Fetching controls from catalog..."
    CONTROLS_RESPONSE=$(curl -s "$API_URL/api/v1/controls")
    CONTROL_ID=$(echo "$CONTROLS_RESPONSE" | jq -r '.controls[0].id // "reg-d-501"')
    echo "Using control ID: $CONTROL_ID"

    # Create sample evidence with correct payload format
    echo ""
    echo "Creating sample evidence records..."

    curl -s -X POST "$API_URL/api/v1/evidence" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d "{
        \"controlId\": \"$CONTROL_ID\",
        \"artifactHash\": \"sha256:$(echo -n 'trade-confirmation-acme-001' | sha256sum | cut -d' ' -f1)\",
        \"artifactSize\": 1024,
        \"contentType\": \"application/pdf\",
        \"metadata\": {
          \"title\": \"Client Trade Confirmation - ACME Corp\",
          \"description\": \"Trade confirmation for 10,000 shares ACME @ \$45.50\",
          \"client_id\": \"CLI-2024-001\",
          \"trade_date\": \"2024-01-15\",
          \"security\": \"ACME\",
          \"quantity\": 10000,
          \"price\": 45.50
        }
      }" | jq .

    curl -s -X POST "$API_URL/api/v1/evidence" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d "{
        \"controlId\": \"$CONTROL_ID\",
        \"artifactHash\": \"sha256:$(echo -n 'form-adv-2024' | sha256sum | cut -d' ' -f1)\",
        \"artifactSize\": 2048,
        \"contentType\": \"application/pdf\",
        \"metadata\": {
          \"title\": \"Form ADV Part 2A - Annual Update\",
          \"description\": \"Investment adviser brochure filed with SEC\",
          \"form_type\": \"ADV-2A\",
          \"filing_date\": \"2024-03-01\",
          \"crd_number\": \"123456\"
        }
      }" | jq .

    curl -s -X POST "$API_URL/api/v1/evidence" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d "{
        \"controlId\": \"$CONTROL_ID\",
        \"artifactHash\": \"sha256:$(echo -n 'communication-log-q1-2024' | sha256sum | cut -d' ' -f1)\",
        \"artifactSize\": 512,
        \"contentType\": \"text/plain\",
        \"metadata\": {
          \"title\": \"Client Communication Log Q1 2024\",
          \"description\": \"Quarterly communication records\",
          \"quarter\": \"Q1\",
          \"year\": 2024
        }
      }" | jq .

    echo ""
    echo -e "${GREEN}✓ Demo data seeded${NC}"
    echo ""
    echo "View at: https://reg-d-compliance-demo.bolt.host"
    ;;

  test)
    echo -e "${BLUE}Running API health checks...${NC}"
    echo ""

    echo "1. Health endpoint:"
    curl -s "$API_URL/api/v1/health" | jq .
    echo ""

    echo "2. Regulations endpoint:"
    curl -s "$API_URL/api/v1/regulations" | jq '{total: .total, regulations: [.regulations[:3][] | {id, citation}]}'
    echo ""

    echo "3. Controls endpoint:"
    curl -s "$API_URL/api/v1/controls" | jq '{total: .total, controls: [.controls[:3][] | {id, title}]}'
    echo ""

    echo "4. Getting auth token for protected endpoints..."
    TOKEN=$(curl -s -X POST "$API_URL/api/v1/auth/token" \
      -H "Content-Type: application/json" \
      -d '{"email":"test@example.com","role":"compliance"}' | jq -r '.token')

    if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
      echo -e "${GREEN}✓ Auth working${NC}"

      echo ""
      echo "5. Compliance status:"
      curl -s "$API_URL/api/v1/compliance-status" \
        -H "Authorization: Bearer $TOKEN" | jq '.summary'

      echo ""
      echo "6. Evidence list:"
      curl -s "$API_URL/api/v1/evidence" \
        -H "Authorization: Bearer $TOKEN" | jq '{total: .total, evidence: [.evidence[:3][] | {id, controlId}]}'
    else
      echo -e "${RED}✗ Auth failed${NC}"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|clean|seed|test}"
    exit 1
    ;;
esac
