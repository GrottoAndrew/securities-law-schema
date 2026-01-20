# Architecture Overview

This document describes the reference architecture for a securities compliance management system built on machine-readable regulations.

## System Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTATION LAYER                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │      Internal Dashboard     │    │        Auditor Portal               │ │
│  │  - Compliance status        │    │  - Read-only access                 │ │
│  │  - Evidence gaps            │    │  - Time-limited tokens              │ │
│  │  - Control mapping          │    │  - Export capabilities              │ │
│  └─────────────────────────────┘    └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 API LAYER                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Compliance API                               │   │
│  │  GET /controls                    GET /evidence/{control_id}        │   │
│  │  GET /regulations/{citation}      GET /compliance-status            │   │
│  │  GET /audit-trail                 POST /evidence (internal only)    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
┌───────────────────┐   ┌───────────────────────┐   ┌─────────────────────────┐
│  CONTROL CATALOG  │   │    EVIDENCE LOCKER    │   │      AUDIT TRAIL        │
│                   │   │                       │   │                         │
│  S3 (versioned)   │   │  PostgreSQL +         │   │  PostgreSQL +           │
│  - OSCAL JSON     │   │  S3 artifacts         │   │  S3 Object Lock         │
│  - JSON-LD regs   │   │  - Metadata DB        │   │  - Merkle roots         │
│  - Cryptographic  │   │  - Encrypted files    │   │  - Event signatures     │
│    signatures     │   │  - Merkle tree        │   │  - Immutable history    │
└───────────────────┘   └───────────────────────┘   └─────────────────────────┘
```

## Component Details

### 1. Control Catalog (S3)

**Purpose**: Authoritative source for regulatory text and compliance controls.

**Contents**:
- `regulations/` — JSON-LD files containing verbatim CFR text
- `controls/` — OSCAL control catalogs mapping requirements to regulations
- `contexts/` — JSON-LD vocabulary definitions

**Properties**:
- Versioned (S3 versioning enabled)
- Immutable per version (new version = new files)
- Cryptographically signed (detached JWS signatures)
- Content-addressable (SHA-256 manifest)

**Storage Structure**:
```
s3://compliance-catalog/
├── v1.0.0/
│   ├── manifest.json              # SHA-256 hashes of all files
│   ├── manifest.json.sig          # JWS signature
│   ├── regulations/
│   │   └── regulation-d/
│   │       └── 17cfr230.501.jsonld
│   ├── controls/
│   │   └── regulation-d-controls.json
│   └── contexts/
│       └── securities-context.jsonld
├── v1.0.1/
│   └── ...
└── current.json                   # Pointer to active version
```

### 2. Evidence Locker

**Purpose**: Store and link compliance evidence to controls.

**Components**:

| Component | Technology | Purpose |
|-----------|------------|---------|
| Metadata Store | PostgreSQL | Queryable evidence records |
| Artifact Store | S3 (SSE-KMS) | Encrypted evidence files |
| Hash Index | PostgreSQL | Merkle tree leaf hashes |

**Schema** (see `evidence-locker.md` for details):
- Evidence records link to control IDs and catalog versions
- Each record has a Merkle leaf hash for verification
- Artifacts stored encrypted at rest with KMS

### 3. Audit Trail

**Purpose**: Immutable log of all compliance-relevant events.

**Events Logged**:
- Catalog version published
- Evidence submitted
- Evidence linked to control
- Compliance status changed
- Auditor access granted/revoked

**Properties**:
- Append-only (no updates or deletes)
- Cryptographically signed entries
- Periodic Merkle root checkpoints
- Queryable by time range, event type, control

### 4. API Layer

**Purpose**: Unified access to all compliance data.

**Endpoints**:

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/controls` | GET | List all controls | Internal/Auditor |
| `/controls/{id}` | GET | Get control details | Internal/Auditor |
| `/regulations/{citation}` | GET | Get regulation text | Internal/Auditor |
| `/evidence` | POST | Submit evidence | Internal only |
| `/evidence/{control_id}` | GET | Get evidence for control | Internal/Auditor |
| `/compliance-status` | GET | Overall compliance view | Internal/Auditor |
| `/audit-trail` | GET | Query audit events | Internal/Auditor |

### 5. Presentation Layer

**Internal Dashboard**:
- Real-time compliance status
- Control-by-control evidence status
- Gap analysis (missing evidence)
- Evidence submission workflow

**Auditor Portal**:
- Read-only view of all data
- Time-limited access tokens (e.g., 72 hours)
- Export to standard formats
- Cannot modify any data

## Data Relationships

```
┌──────────────┐      references      ┌──────────────┐
│  Regulation  │◄─────────────────────│   Control    │
│  (JSON-LD)   │                      │   (OSCAL)    │
└──────────────┘                      └──────────────┘
                                             │
                                             │ satisfied_by
                                             ▼
                                      ┌──────────────┐
                                      │   Evidence   │
                                      │  (Metadata)  │
                                      └──────────────┘
                                             │
                                             │ stored_at
                                             ▼
                                      ┌──────────────┐
                                      │   Artifact   │
                                      │    (S3)      │
                                      └──────────────┘
```

## Security Boundaries

1. **Catalog**: Public read, admin write (signed releases only)
2. **Evidence Locker**: Internal write, internal + auditor read
3. **Audit Trail**: System write only, internal + auditor read
4. **Artifacts**: Encrypted at rest, signed URLs for access

See `security.md` for detailed security architecture.
