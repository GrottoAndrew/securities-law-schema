# Data Flow Architecture

This document describes how data flows through the compliance management system.

## Flow 1: Catalog Publishing

When a new version of the control catalog is published:

```
┌─────────────────┐
│  Author edits   │
│  regulations    │
│  or controls    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validate       │
│  - JSON-LD      │
│  - OSCAL        │
│  - References   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Compute        │
│  manifest       │
│  (SHA-256)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Sign manifest  │
│  (JWS)          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐       ┌─────────────────┐
│  Upload to S3   │──────►│  Audit Trail    │
│  new version    │       │  CATALOG_       │
│  directory      │       │  PUBLISHED      │
└────────┬────────┘       └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Update         │
│  current.json   │
│  pointer        │
└─────────────────┘
```

### Manifest Structure

```json
{
  "version": "1.0.0",
  "published": "2026-01-19T00:00:00Z",
  "publisher": "compliance-team@example.com",
  "files": {
    "regulations/regulation-d/17cfr230.501.jsonld": {
      "sha256": "abc123...",
      "size": 45678
    },
    "controls/regulation-d-controls.json": {
      "sha256": "def456...",
      "size": 23456
    }
  },
  "previous_version": "0.9.0"
}
```

---

## Flow 2: Evidence Submission

When compliance evidence is submitted:

```
┌─────────────────┐
│  User uploads   │
│  evidence file  │
│  + metadata     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validate       │
│  - Control ID   │
│  - File type    │
│  - Metadata     │
└────────┬────────┘
         │
         ├────────────────────────────────────────────┐
         │                                            │
         ▼                                            ▼
┌─────────────────┐                        ┌─────────────────┐
│  Store artifact │                        │  Create         │
│  in S3          │                        │  metadata       │
│  (encrypted)    │                        │  record         │
└────────┬────────┘                        └────────┬────────┘
         │                                          │
         │            ┌─────────────────┐           │
         └───────────►│  Compute leaf   │◄──────────┘
                      │  hash:          │
                      │  H(id ║ sha256  │
                      │    ║ metadata)  │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │  Insert         │
                      │  evidence       │
                      │  record in DB   │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │  Audit Trail    │
                      │  EVIDENCE_      │
                      │  SUBMITTED      │
                      └─────────────────┘
```

### Evidence Record Structure

```json
{
  "id": "uuid-here",
  "control_id": "ctrl-ai-natural-person-income",
  "control_version": "1.0.0",
  "artifact_s3_uri": "s3://evidence-bucket/uuid-here/document.pdf",
  "artifact_sha256": "sha256:...",
  "metadata": {
    "investor_id": "INV-12345",
    "evidence_type": "tax_return",
    "tax_year": "2024",
    "document_date": "2025-04-15",
    "verified_by": "john.doe@example.com"
  },
  "merkle_leaf_hash": "sha256:...",
  "collected_at": "2026-01-19T12:00:00Z",
  "collected_by": "jane.smith@example.com"
}
```

---

## Flow 3: Merkle Tree Computation

Periodic job (e.g., hourly) to compute Merkle root:

```
┌─────────────────┐
│  Query all      │
│  evidence       │
│  since last     │
│  checkpoint     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Sort by        │
│  created_at     │
│  (deterministic │
│  order)         │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    BUILD MERKLE TREE                    │
│                                                         │
│                      ┌──────────┐                       │
│                      │   Root   │                       │
│                      │  Hash    │                       │
│                      └────┬─────┘                       │
│                   ┌───────┴───────┐                     │
│                   ▼               ▼                     │
│              ┌────────┐     ┌────────┐                  │
│              │ H(L1║L2)│     │H(L3║L4)│                  │
│              └───┬────┘     └───┬────┘                  │
│              ┌───┴───┐      ┌───┴───┐                   │
│              ▼       ▼      ▼       ▼                   │
│           ┌────┐ ┌────┐  ┌────┐ ┌────┐                  │
│           │ L1 │ │ L2 │  │ L3 │ │ L4 │  ◄── leaf hashes │
│           └────┘ └────┘  └────┘ └────┘      from DB     │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Write          │
│  checkpoint to  │
│  audit trail    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    AUDIT TRAIL ENTRY                    │
│  {                                                      │
│    "timestamp": "2026-01-19T13:00:00Z",                 │
│    "event_type": "MERKLE_CHECKPOINT",                   │
│    "merkle_root": "sha256:abc123...",                   │
│    "previous_root": "sha256:def456...",                 │
│    "evidence_count": 1547,                              │
│    "signature": "JWS..."                                │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

---

## Flow 4: Compliance Status Query

When dashboard requests compliance status:

```
┌─────────────────┐
│  Dashboard      │
│  requests       │
│  /compliance-   │
│  status         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Load current   │
│  catalog        │
│  version        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  For each       │
│  control:       │
└────────┬────────┘
         │
         ├──────────────────────────────────────────┐
         │                                          │
         ▼                                          ▼
┌─────────────────┐                      ┌─────────────────┐
│  Query evidence │                      │  Load control   │
│  for control_id │                      │  requirements   │
│  from DB        │                      │  from OSCAL     │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         └─────────────────┬──────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Compute        │
                  │  coverage:      │
                  │  - Required     │
                  │  - Satisfied    │
                  │  - Missing      │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Return         │
                  │  status         │
                  └─────────────────┘
```

### Response Structure

```json
{
  "catalog_version": "1.0.0",
  "computed_at": "2026-01-19T14:00:00Z",
  "overall_status": "PARTIAL",
  "summary": {
    "total_controls": 15,
    "fully_satisfied": 10,
    "partially_satisfied": 3,
    "not_satisfied": 2
  },
  "controls": [
    {
      "id": "ctrl-ai-natural-person-income",
      "title": "Natural Person Income Verification",
      "regulation_citation": "17 CFR 230.501(a)(6)",
      "status": "SATISFIED",
      "evidence_count": 47,
      "last_evidence": "2026-01-18T10:30:00Z"
    },
    {
      "id": "ctrl-form-d-filing",
      "title": "Form D Filing Requirement",
      "regulation_citation": "17 CFR 230.503",
      "status": "MISSING",
      "evidence_count": 0,
      "required_evidence": ["Filed Form D confirmation from EDGAR"]
    }
  ]
}
```

---

## Flow 5: Auditor Access Grant

When granting time-limited auditor access:

```
┌─────────────────┐
│  Admin grants   │
│  auditor access │
│  for 72 hours   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate JWT   │
│  - sub: auditor │
│  - role: viewer │
│  - exp: +72h    │
│  - scope: read  │
└────────┬────────┘
         │
         ├────────────────────────────────────────────┐
         │                                            │
         ▼                                            ▼
┌─────────────────┐                        ┌─────────────────┐
│  Send token     │                        │  Audit Trail    │
│  to auditor     │                        │  AUDITOR_       │
│  (secure        │                        │  ACCESS_        │
│  channel)       │                        │  GRANTED        │
└─────────────────┘                        └─────────────────┘

         │
         │  Auditor makes request with token
         ▼
┌─────────────────┐
│  API validates  │
│  - Signature    │
│  - Expiration   │
│  - Scope        │
└────────┬────────┘
         │
         ├── Invalid ──► 401 Unauthorized
         │
         ▼ Valid
┌─────────────────┐
│  Allow read-    │
│  only access    │
│  to requested   │
│  resources      │
└─────────────────┘
```

### JWT Claims

```json
{
  "iss": "compliance-system",
  "sub": "auditor@auditfirm.com",
  "aud": "compliance-api",
  "exp": 1737568000,
  "iat": 1737309600,
  "role": "auditor",
  "scope": ["read:controls", "read:evidence", "read:audit-trail"],
  "grant_id": "uuid-of-access-grant"
}
```

---

## Flow 6: Evidence Verification

When verifying evidence integrity:

```
┌─────────────────┐
│  Request        │
│  verification   │
│  for evidence   │
│  record         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Load evidence  │
│  record from    │
│  DB             │
└────────┬────────┘
         │
         ├──────────────────────────────────────────┐
         │                                          │
         ▼                                          ▼
┌─────────────────┐                      ┌─────────────────┐
│  Fetch artifact │                      │  Recompute      │
│  from S3        │                      │  leaf hash      │
│  Compute SHA256 │                      │  from record    │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         └─────────────────┬──────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Compare:       │
                  │  - Artifact     │
                  │    hash match?  │
                  │  - Leaf hash    │
                  │    match?       │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Build Merkle   │
                  │  proof path     │
                  │  to nearest     │
                  │  checkpoint     │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Verify proof   │
                  │  against        │
                  │  checkpoint     │
                  │  root in audit  │
                  │  trail          │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Return         │
                  │  verification   │
                  │  result         │
                  └─────────────────┘
```

### Verification Response

```json
{
  "evidence_id": "uuid-here",
  "verified": true,
  "checks": {
    "artifact_hash_match": true,
    "leaf_hash_match": true,
    "merkle_proof_valid": true,
    "checkpoint_found": true
  },
  "checkpoint": {
    "timestamp": "2026-01-19T13:00:00Z",
    "merkle_root": "sha256:abc123..."
  },
  "proof_path": [
    {"position": "right", "hash": "sha256:..."},
    {"position": "left", "hash": "sha256:..."},
    {"position": "right", "hash": "sha256:..."}
  ]
}
```
