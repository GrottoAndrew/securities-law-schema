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
    docker compose -f docker-compose.demo.yml up -d

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
    echo "  Dashboard:  http://localhost:8080"
    echo "  MinIO:      http://localhost:9001 (minioadmin / minioadmin123)"
    echo "  Postgres:   localhost:5432 (evidence_admin / demo_password_only)"
    echo ""
    echo "Run './scripts/demo.sh seed' to populate with sample data"
    ;;

  stop)
    echo -e "${BLUE}Stopping demo environment...${NC}"
    docker compose -f docker-compose.demo.yml down
    echo -e "${GREEN}✓ Stopped${NC}"
    ;;

  clean)
    echo -e "${RED}Removing demo environment and all data...${NC}"
    docker compose -f docker-compose.demo.yml down -v
    echo -e "${GREEN}✓ Cleaned${NC}"
    ;;

  seed)
    echo -e "${BLUE}Seeding demo data...${NC}"

    # Get auth token
    TOKEN=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"username":"demo","password":"demo"}' | jq -r '.token // "demo-token"')

    if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
      TOKEN="demo-token"
    fi

    AUTH="Authorization: Bearer $TOKEN"

    # Create sample controls
    echo "Creating SEC Rule 17a-4 controls..."
    curl -s -X POST "$API_URL/api/v1/controls" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d '{
        "name": "Record Retention - 7 Year Minimum",
        "description": "All communications and records must be retained for minimum 7 years per SEC Rule 17a-4",
        "regulation": "SEC Rule 17a-4(f)",
        "category": "data_retention",
        "priority": "critical"
      }' | jq .

    curl -s -X POST "$API_URL/api/v1/controls" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d '{
        "name": "WORM Storage Requirement",
        "description": "Records must be stored on non-rewriteable, non-erasable storage (Write Once Read Many)",
        "regulation": "SEC Rule 17a-4(f)(2)(ii)(A)",
        "category": "storage",
        "priority": "critical"
      }' | jq .

    curl -s -X POST "$API_URL/api/v1/controls" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d '{
        "name": "Audit Trail Integrity",
        "description": "Maintain tamper-evident audit logs with cryptographic verification",
        "regulation": "SEC Rule 17a-4(f)(3)(v)",
        "category": "audit",
        "priority": "high"
      }' | jq .

    # Create sample evidence
    echo ""
    echo "Creating sample evidence records..."
    curl -s -X POST "$API_URL/api/v1/evidence" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d '{
        "type": "communication",
        "title": "Client Trade Confirmation - ACME Corp",
        "description": "Trade confirmation for 10,000 shares ACME @ $45.50",
        "metadata": {
          "client_id": "CLI-2024-001",
          "trade_date": "2024-01-15",
          "security": "ACME",
          "quantity": 10000,
          "price": 45.50
        }
      }' | jq .

    curl -s -X POST "$API_URL/api/v1/evidence" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d '{
        "type": "document",
        "title": "Form ADV Part 2A - Annual Update",
        "description": "Investment adviser brochure filed with SEC",
        "metadata": {
          "form_type": "ADV-2A",
          "filing_date": "2024-03-01",
          "crd_number": "123456"
        }
      }' | jq .

    echo ""
    echo -e "${GREEN}✓ Demo data seeded${NC}"
    echo ""
    echo "View at: http://localhost:8080"
    ;;

  test)
    echo -e "${BLUE}Running API health checks...${NC}"
    echo ""

    echo "Health endpoint:"
    curl -s "$API_URL/api/v1/health" | jq .
    echo ""

    echo "Regulations endpoint:"
    curl -s "$API_URL/api/v1/regulations" | jq '.[] | {id, name, jurisdiction}' 2>/dev/null || echo "No regulations loaded"
    echo ""

    echo "Controls endpoint:"
    curl -s "$API_URL/api/v1/controls" | jq '.[0:3] | .[] | {id, name, category}' 2>/dev/null || echo "No controls found"
    echo ""

    echo "Compliance status:"
    curl -s "$API_URL/api/v1/compliance/status" | jq . 2>/dev/null || echo "Status unavailable"
    ;;

  *)
    echo "Usage: $0 {start|stop|clean|seed|test}"
    exit 1
    ;;
esac
