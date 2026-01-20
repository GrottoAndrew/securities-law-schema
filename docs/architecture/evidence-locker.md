# Evidence Locker Design

This document provides detailed specifications for the evidence locker component.

## Overview

The evidence locker stores compliance evidence linked to regulatory controls with cryptographic verification and immutable audit trails.

## Database Schema

### PostgreSQL Schema

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Catalog version tracking
CREATE TABLE catalog_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version VARCHAR(50) NOT NULL UNIQUE,
    published_at TIMESTAMPTZ NOT NULL,
    manifest_sha256 VARCHAR(64) NOT NULL,
    signature TEXT NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_catalog_versions_current ON catalog_versions(is_current) WHERE is_current = TRUE;

-- Control definitions (cached from OSCAL catalog)
CREATE TABLE controls (
    id VARCHAR(100) PRIMARY KEY,
    catalog_version_id UUID REFERENCES catalog_versions(id),
    title TEXT NOT NULL,
    regulation_citation VARCHAR(100),
    regulation_ref VARCHAR(200),
    parent_control_id VARCHAR(100) REFERENCES controls(id),
    evidence_requirements JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id, catalog_version_id)
);

CREATE INDEX idx_controls_catalog ON controls(catalog_version_id);
CREATE INDEX idx_controls_citation ON controls(regulation_citation);

-- Evidence records (append-only by policy)
CREATE TABLE evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Control linkage
    control_id VARCHAR(100) NOT NULL,
    catalog_version VARCHAR(50) NOT NULL,

    -- Artifact reference
    artifact_s3_bucket VARCHAR(255) NOT NULL,
    artifact_s3_key VARCHAR(1024) NOT NULL,
    artifact_sha256 VARCHAR(64) NOT NULL,
    artifact_size_bytes BIGINT NOT NULL,
    artifact_content_type VARCHAR(255),

    -- Metadata (flexible JSON)
    metadata JSONB NOT NULL DEFAULT '{}',

    -- Context
    investor_id VARCHAR(100),  -- Optional: link to investor if applicable
    offering_id VARCHAR(100),  -- Optional: link to offering if applicable

    -- Provenance
    collected_at TIMESTAMPTZ NOT NULL,
    collected_by VARCHAR(255) NOT NULL,
    collection_method VARCHAR(100),  -- 'manual_upload', 'api_integration', 'automated_fetch'

    -- Merkle tree
    merkle_leaf_hash VARCHAR(64) NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Soft delete (for compliance, we don't hard delete)
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(255),
    deletion_reason TEXT,

    CONSTRAINT fk_control FOREIGN KEY (control_id, catalog_version)
        REFERENCES controls(id, catalog_version_id) DEFERRABLE
);

-- Indexes for common queries
CREATE INDEX idx_evidence_control ON evidence(control_id);
CREATE INDEX idx_evidence_catalog_version ON evidence(catalog_version);
CREATE INDEX idx_evidence_investor ON evidence(investor_id) WHERE investor_id IS NOT NULL;
CREATE INDEX idx_evidence_offering ON evidence(offering_id) WHERE offering_id IS NOT NULL;
CREATE INDEX idx_evidence_created ON evidence(created_at);
CREATE INDEX idx_evidence_not_deleted ON evidence(id) WHERE deleted_at IS NULL;

-- Merkle checkpoints
CREATE TABLE merkle_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checkpoint_number BIGINT NOT NULL UNIQUE,
    merkle_root VARCHAR(64) NOT NULL,
    evidence_count BIGINT NOT NULL,
    first_evidence_id UUID REFERENCES evidence(id),
    last_evidence_id UUID REFERENCES evidence(id),
    previous_checkpoint_id UUID REFERENCES merkle_checkpoints(id),
    computed_at TIMESTAMPTZ NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_merkle_checkpoints_computed ON merkle_checkpoints(computed_at);

-- Evidence-checkpoint mapping (for proof construction)
CREATE TABLE evidence_checkpoint_mapping (
    evidence_id UUID REFERENCES evidence(id),
    checkpoint_id UUID REFERENCES merkle_checkpoints(id),
    leaf_index BIGINT NOT NULL,
    PRIMARY KEY (evidence_id, checkpoint_id)
);

-- Auditor access grants
CREATE TABLE auditor_access_grants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auditor_email VARCHAR(255) NOT NULL,
    auditor_name VARCHAR(255),
    auditor_organization VARCHAR(255),
    granted_by VARCHAR(255) NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by VARCHAR(255),
    revocation_reason TEXT,
    scope JSONB NOT NULL DEFAULT '["read:controls", "read:evidence", "read:audit-trail"]',
    jwt_id VARCHAR(100) UNIQUE NOT NULL
);

CREATE INDEX idx_auditor_access_active ON auditor_access_grants(auditor_email, expires_at)
    WHERE revoked_at IS NULL;

-- Audit log (application-level, in addition to QLDB)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_number BIGSERIAL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    event_timestamp TIMESTAMPTZ DEFAULT NOW(),
    actor VARCHAR(255) NOT NULL,
    actor_type VARCHAR(50) NOT NULL,  -- 'user', 'system', 'auditor'
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    previous_hash VARCHAR(64),
    hash VARCHAR(64) NOT NULL
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(event_timestamp);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);

-- Function to compute evidence leaf hash
CREATE OR REPLACE FUNCTION compute_evidence_leaf_hash(
    p_evidence_id UUID,
    p_artifact_sha256 VARCHAR(64),
    p_metadata JSONB,
    p_created_at TIMESTAMPTZ
) RETURNS VARCHAR(64) AS $$
BEGIN
    RETURN encode(
        sha256(
            p_evidence_id::text::bytea ||
            p_artifact_sha256::bytea ||
            encode(sha256(p_metadata::text::bytea), 'hex')::bytea ||
            to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::bytea
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-compute leaf hash on insert
CREATE OR REPLACE FUNCTION set_evidence_leaf_hash()
RETURNS TRIGGER AS $$
BEGIN
    NEW.merkle_leaf_hash := compute_evidence_leaf_hash(
        NEW.id,
        NEW.artifact_sha256,
        NEW.metadata,
        NEW.created_at
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_set_leaf_hash
    BEFORE INSERT ON evidence
    FOR EACH ROW
    EXECUTE FUNCTION set_evidence_leaf_hash();

-- Function to compute audit log hash chain
CREATE OR REPLACE FUNCTION compute_audit_hash()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash VARCHAR(64);
BEGIN
    SELECT hash INTO prev_hash FROM audit_log
    ORDER BY sequence_number DESC LIMIT 1;

    NEW.previous_hash := COALESCE(prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');
    NEW.hash := encode(
        sha256(
            NEW.sequence_number::text::bytea ||
            to_char(NEW.event_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::bytea ||
            NEW.event_type::bytea ||
            COALESCE(NEW.details::text, '')::bytea ||
            NEW.previous_hash::bytea
        ),
        'hex'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_hash_chain
    BEFORE INSERT ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION compute_audit_hash();

-- Prevent updates and deletes on evidence (soft delete only)
CREATE OR REPLACE FUNCTION prevent_evidence_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Hard deletes not allowed on evidence table. Use soft delete.';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Only allow setting deleted_at, deleted_by, deletion_reason
        IF OLD.id != NEW.id OR
           OLD.control_id != NEW.control_id OR
           OLD.artifact_sha256 != NEW.artifact_sha256 OR
           OLD.metadata != NEW.metadata OR
           OLD.merkle_leaf_hash != NEW.merkle_leaf_hash THEN
            RAISE EXCEPTION 'Core evidence fields cannot be modified';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_prevent_modification
    BEFORE UPDATE OR DELETE ON evidence
    FOR EACH ROW
    EXECUTE FUNCTION prevent_evidence_modification();
```

---

## S3 Structure

### Bucket Layout

```
s3://evidence-locker-{environment}/
├── artifacts/
│   └── {year}/
│       └── {month}/
│           └── {day}/
│               └── {evidence_id}/
│                   ├── original.{ext}      # Original uploaded file
│                   └── metadata.json       # Upload metadata
├── exports/
│   └── {export_id}/
│       └── export.zip                      # Auditor export packages
└── temp/
    └── uploads/
        └── {upload_id}/                    # Temporary upload staging
```

### Object Metadata

Each artifact includes S3 object metadata:

```
x-amz-meta-evidence-id: uuid
x-amz-meta-control-id: ctrl-ai-verification
x-amz-meta-uploaded-by: user@example.com
x-amz-meta-upload-timestamp: 2026-01-19T12:00:00Z
x-amz-meta-content-hash: sha256:...
```

---

## API Endpoints

### Evidence Submission

```
POST /api/v1/evidence
Content-Type: multipart/form-data

Fields:
- file: (binary) The evidence file
- control_id: (string) Control this evidence satisfies
- metadata: (JSON) Additional metadata

Response:
{
  "id": "uuid",
  "control_id": "ctrl-ai-natural-person-income",
  "artifact_sha256": "sha256:...",
  "merkle_leaf_hash": "sha256:...",
  "created_at": "2026-01-19T12:00:00Z"
}
```

### Evidence Query

```
GET /api/v1/evidence?control_id=ctrl-ai-verification&status=active

Response:
{
  "evidence": [
    {
      "id": "uuid",
      "control_id": "ctrl-ai-verification",
      "artifact_content_type": "application/pdf",
      "metadata": {...},
      "collected_at": "2026-01-19T12:00:00Z",
      "collected_by": "user@example.com",
      "verification_status": "verified"
    }
  ],
  "pagination": {
    "total": 47,
    "page": 1,
    "per_page": 20
  }
}
```

### Evidence Verification

```
GET /api/v1/evidence/{id}/verify

Response:
{
  "evidence_id": "uuid",
  "verified": true,
  "artifact_verification": {
    "stored_hash": "sha256:...",
    "computed_hash": "sha256:...",
    "match": true
  },
  "merkle_verification": {
    "leaf_hash": "sha256:...",
    "checkpoint_id": "uuid",
    "checkpoint_root": "sha256:...",
    "proof_valid": true,
    "proof_path": [...]
  }
}
```

### Download with Signed URL

```
GET /api/v1/evidence/{id}/download

Response:
{
  "download_url": "https://s3.../...?X-Amz-Signature=...",
  "expires_at": "2026-01-19T12:15:00Z",
  "content_type": "application/pdf",
  "size_bytes": 145678
}
```

---

## Merkle Tree Implementation

### Leaf Hash Computation

```python
import hashlib
import json

def compute_leaf_hash(evidence_id: str, artifact_sha256: str,
                      metadata: dict, timestamp: str) -> str:
    """Compute deterministic leaf hash for evidence record."""
    # Canonical JSON serialization (sorted keys, no whitespace)
    metadata_canonical = json.dumps(metadata, sort_keys=True, separators=(',', ':'))
    metadata_hash = hashlib.sha256(metadata_canonical.encode()).hexdigest()

    # Concatenate components
    preimage = f"{evidence_id}{artifact_sha256}{metadata_hash}{timestamp}"

    return hashlib.sha256(preimage.encode()).hexdigest()
```

### Tree Construction

```python
import hashlib
from typing import List, Tuple

def build_merkle_tree(leaf_hashes: List[str]) -> Tuple[str, List[List[str]]]:
    """
    Build Merkle tree from leaf hashes.
    Returns (root_hash, tree_levels) where tree_levels[0] = leaves.
    """
    if not leaf_hashes:
        return ('0' * 64, [[]])

    # Ensure even number of leaves
    leaves = leaf_hashes.copy()
    if len(leaves) % 2 == 1:
        leaves.append(leaves[-1])  # Duplicate last leaf

    tree_levels = [leaves]
    current_level = leaves

    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            left = current_level[i]
            right = current_level[i + 1]
            parent = hashlib.sha256(f"{left}{right}".encode()).hexdigest()
            next_level.append(parent)

        tree_levels.append(next_level)
        current_level = next_level

    root = current_level[0] if current_level else '0' * 64
    return (root, tree_levels)


def generate_proof(leaf_index: int, tree_levels: List[List[str]]) -> List[dict]:
    """Generate Merkle proof for leaf at given index."""
    proof = []
    index = leaf_index

    for level in tree_levels[:-1]:  # Exclude root level
        if index % 2 == 0:
            # Sibling is to the right
            sibling_index = index + 1
            position = 'right'
        else:
            # Sibling is to the left
            sibling_index = index - 1
            position = 'left'

        if sibling_index < len(level):
            proof.append({
                'position': position,
                'hash': level[sibling_index]
            })

        index //= 2

    return proof


def verify_proof(leaf_hash: str, proof: List[dict], root: str) -> bool:
    """Verify Merkle proof."""
    current = leaf_hash

    for step in proof:
        if step['position'] == 'left':
            current = hashlib.sha256(f"{step['hash']}{current}".encode()).hexdigest()
        else:
            current = hashlib.sha256(f"{current}{step['hash']}".encode()).hexdigest()

    return current == root
```

---

## Checkpoint Process

### Scheduled Job (Hourly)

```python
async def create_merkle_checkpoint():
    """Create periodic Merkle checkpoint."""

    # Get last checkpoint
    last_checkpoint = await db.fetch_one(
        "SELECT * FROM merkle_checkpoints ORDER BY checkpoint_number DESC LIMIT 1"
    )

    # Get evidence since last checkpoint
    if last_checkpoint:
        evidence_records = await db.fetch_all(
            """SELECT id, merkle_leaf_hash, created_at
               FROM evidence
               WHERE created_at > $1 AND deleted_at IS NULL
               ORDER BY created_at ASC""",
            last_checkpoint['computed_at']
        )
    else:
        evidence_records = await db.fetch_all(
            """SELECT id, merkle_leaf_hash, created_at
               FROM evidence
               WHERE deleted_at IS NULL
               ORDER BY created_at ASC"""
        )

    if not evidence_records:
        return None  # No new evidence

    # Build Merkle tree
    leaf_hashes = [r['merkle_leaf_hash'] for r in evidence_records]
    root, tree_levels = build_merkle_tree(leaf_hashes)

    # Sign checkpoint
    checkpoint_data = {
        'checkpoint_number': (last_checkpoint['checkpoint_number'] + 1) if last_checkpoint else 1,
        'merkle_root': root,
        'evidence_count': len(evidence_records),
        'computed_at': datetime.utcnow().isoformat()
    }
    signature = sign_checkpoint(checkpoint_data)

    # Store checkpoint
    checkpoint_id = await db.execute(
        """INSERT INTO merkle_checkpoints
           (checkpoint_number, merkle_root, evidence_count,
            first_evidence_id, last_evidence_id,
            previous_checkpoint_id, computed_at, signature)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id""",
        checkpoint_data['checkpoint_number'],
        root,
        len(evidence_records),
        evidence_records[0]['id'],
        evidence_records[-1]['id'],
        last_checkpoint['id'] if last_checkpoint else None,
        checkpoint_data['computed_at'],
        signature
    )

    # Map evidence to checkpoint with leaf indices
    for i, record in enumerate(evidence_records):
        await db.execute(
            """INSERT INTO evidence_checkpoint_mapping
               (evidence_id, checkpoint_id, leaf_index)
               VALUES ($1, $2, $3)""",
            record['id'], checkpoint_id, i
        )

    # Write to audit trail
    await write_audit_event('MERKLE_CHECKPOINT', {
        'checkpoint_id': checkpoint_id,
        'merkle_root': root,
        'evidence_count': len(evidence_records)
    })

    return checkpoint_id
```

---

## Query Examples

### Get Compliance Status for Control

```sql
SELECT
    c.id as control_id,
    c.title,
    c.regulation_citation,
    COUNT(e.id) as evidence_count,
    MAX(e.created_at) as last_evidence_at,
    CASE
        WHEN COUNT(e.id) > 0 THEN 'SATISFIED'
        ELSE 'MISSING'
    END as status
FROM controls c
LEFT JOIN evidence e ON e.control_id = c.id
    AND e.catalog_version = c.catalog_version_id::text
    AND e.deleted_at IS NULL
WHERE c.catalog_version_id = (
    SELECT id FROM catalog_versions WHERE is_current = TRUE
)
GROUP BY c.id, c.title, c.regulation_citation;
```

### Get Evidence Gap Analysis

```sql
WITH required_controls AS (
    SELECT id, title, regulation_citation, evidence_requirements
    FROM controls
    WHERE catalog_version_id = (SELECT id FROM catalog_versions WHERE is_current = TRUE)
),
evidence_counts AS (
    SELECT control_id, COUNT(*) as count
    FROM evidence
    WHERE deleted_at IS NULL
    GROUP BY control_id
)
SELECT
    rc.id,
    rc.title,
    rc.regulation_citation,
    rc.evidence_requirements,
    COALESCE(ec.count, 0) as evidence_count,
    CASE WHEN COALESCE(ec.count, 0) = 0 THEN 'MISSING' ELSE 'HAS_EVIDENCE' END as status
FROM required_controls rc
LEFT JOIN evidence_counts ec ON ec.control_id = rc.id
WHERE COALESCE(ec.count, 0) = 0
ORDER BY rc.regulation_citation;
```

### Verify Evidence Chain for Audit

```sql
SELECT
    e.id,
    e.control_id,
    e.artifact_sha256,
    e.merkle_leaf_hash,
    e.created_at,
    mc.merkle_root as checkpoint_root,
    mc.computed_at as checkpoint_time,
    mc.signature as checkpoint_signature,
    ecm.leaf_index
FROM evidence e
JOIN evidence_checkpoint_mapping ecm ON ecm.evidence_id = e.id
JOIN merkle_checkpoints mc ON mc.id = ecm.checkpoint_id
WHERE e.control_id = 'ctrl-ai-natural-person-income'
ORDER BY e.created_at DESC;
```
