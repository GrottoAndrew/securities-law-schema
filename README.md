# Securities Law Schema

Machine-readable U.S. securities regulations in JSON-LD format, with OSCAL control mappings for compliance automation.

## What's Included

| Component | Description |
|-----------|-------------|
| **JSON-LD Schemas** | Complete Regulation D (17 CFR 230.500-508) in structured, queryable format |
| **OSCAL Controls** | 16 compliance controls mapped to regulatory requirements |
| **REST API** | Express.js API with JWT authentication, evidence submission, compliance status |
| **PostgreSQL Integration** | Database schema with migrations, hash-chained audit trail |
| **Docker Compose** | One-command local demo with PostgreSQL, MinIO, auto-seeding |
| **Test Suite** | 51 tests (unit, integration, schema validation) via Vitest |
| **Terraform IaC** | AWS ECS Fargate deployment configuration |
| **Seed Data Generator** | 200+ realistic evidence records for demos |
| **Compliance Recipes** | 11 framework extensions (broker-dealer, fund finance, pre-IPO, etc.) |

## Quick Start

### Run Locally with Docker

```bash
docker compose -f docker-compose.demo.yml up --build
```

After ~30 seconds:
- API: http://localhost:3001/api/v1/health
- MinIO Console: http://localhost:9001 (minioadmin/minioadmin123)

### Test the API

```bash
# Get auth token
curl -X POST http://localhost:3001/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","role":"admin"}'

# List evidence (200+ seeded records)
curl http://localhost:3001/api/v1/evidence \
  -H "Authorization: Bearer <token>"

# Check compliance status
curl http://localhost:3001/api/v1/compliance-status \
  -H "Authorization: Bearer <token>"
```

### Run Tests

```bash
npm install
npm run test:unit        # 15 schema tests
npm run test:integration # 27 API tests
npm run lint && npm run typecheck
```

## Repository Structure

```
securities-law-schema/
├── schemas/regulation-d/        # JSON-LD regulatory text (17 CFR 230.500-508)
├── controls/                    # OSCAL control catalog
├── contexts/                    # JSON-LD vocabulary definitions
├── src/
│   ├── api/server.js           # Express REST API
│   └── db/index.js             # PostgreSQL integration
├── scripts/
│   ├── db/migrate.js           # Database migrations
│   ├── seed-demo-data.js       # 200+ evidence record generator
│   └── start-server.js         # Docker entrypoint with auto-migration
├── tests/
│   ├── unit/                   # Schema validation tests
│   ├── integration/            # API endpoint tests
│   └── redteam/                # Security analysis
├── terraform/                   # AWS ECS deployment
├── docs/
│   ├── COMPLIANCE-RECIPES.md   # 11 framework extensions
│   ├── IMPLEMENTATION-GUIDE.md # Guide for legal practitioners
│   └── architecture/           # System design documentation
├── docker-compose.demo.yml     # Local demo environment
└── Dockerfile                  # Production container
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/health` | GET | No | Health check with DB status |
| `/api/v1/auth/token` | POST | No | Get JWT token |
| `/api/v1/controls` | GET | No | List all compliance controls |
| `/api/v1/controls/:id` | GET | No | Get specific control |
| `/api/v1/evidence` | GET | Yes | List evidence records |
| `/api/v1/evidence` | POST | Yes | Submit new evidence |
| `/api/v1/evidence/:id/verify` | GET | Yes | Verify evidence integrity |
| `/api/v1/compliance-status` | GET | Yes | Dashboard data with control coverage |
| `/api/v1/audit-trail` | GET | Yes | Immutable audit log |

## Data Formats

### JSON-LD Regulations

```
Section - Subsection - Paragraph - Clause - Subclause
  501       (a)          (1)        (i)       (A)
```

Each element includes:
- `@id` - Unique URI (e.g., `cfr:17/230.501(a)(6)`)
- `@type` - Element type
- `citation` - Human-readable citation
- `text` - Verbatim regulatory text

### OSCAL Controls

Controls follow NIST OSCAL format with extensions:
- `regulation-citation` - Links to CFR provision
- `regulation-ref` - JSON-LD reference for machine linking
- `evidence-requirements` - What evidence satisfies the control

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | API server port |
| `DATABASE_URL` | No | - | PostgreSQL connection string. If not set, uses in-memory storage |
| `DATABASE_SSL` | No | `false` | Set to `true` to enable SSL for database connection |
| `JWT_SECRET` | Yes (prod) | dev secret | Secret for signing JWT tokens. Required in production |
| `SEED_DATA` | No | `false` | Set to `true` to seed 200+ demo records on startup (only if DB is empty) |
| `CORS_ORIGINS` | No | localhost | Comma-separated list of allowed CORS origins |
| `NODE_ENV` | No | `development` | Set to `production` for production mode |
| `IN_MEMORY_EVIDENCE_LIMIT` | No | `1000` (dev) / `10000` (prod) | Soft limit for in-memory evidence records (warns, never deletes) |
| `IN_MEMORY_AUDIT_LIMIT` | No | `5000` (dev) / `50000` (prod) | Soft limit for in-memory audit log entries (warns, never deletes) |
| `NOTIFICATIONS_ENABLED` | No | `false` | Enable notifications when limits exceeded |
| `NOTIFICATION_EMAIL` | No | - | Email address for limit warnings |
| `SLACK_WEBHOOK_URL` | No | - | Slack incoming webhook URL for notifications |
| `TEAMS_WEBHOOK_URL` | No | - | Microsoft Teams webhook URL for notifications |

## Roadmap

This repository provides a complete foundation for securities compliance automation:

- [x] JSON-LD schemas for Regulation D (230.500-508)
- [x] OSCAL control catalog with 16 controls
- [x] REST API with JWT authentication
- [x] PostgreSQL database with RLS multi-tenancy
- [x] Hash-chained immutable audit trail
- [x] Audit export for regulators (hashed evidence only)
- [x] Docker Compose local environment
- [x] 42+ automated tests

Enterprise deployment, additional regulations, and compliance certifications could be available with this build. Message author for details.

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [IMPLEMENTATION-GUIDE.md](docs/IMPLEMENTATION-GUIDE.md) | Legal/Compliance | CFR download instructions, JSON-LD explanation, 22 best practices |
| [COMPLIANCE-RECIPES.md](docs/COMPLIANCE-RECIPES.md) | Technical | 11 framework extensions with cost/ROI analysis |
| [UNDERSTANDING.md](UNDERSTANDING.md) | Lawyers | Non-technical introduction |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developers | Contribution guidelines |

## License

MIT License - see [LICENSE](LICENSE)

## Related Standards

- [OSCAL](https://pages.nist.gov/OSCAL/) - NIST Open Security Controls Assessment Language
- [JSON-LD](https://json-ld.org/) - JSON for Linked Data
- [eCFR](https://www.ecfr.gov/) - Electronic Code of Federal Regulations
