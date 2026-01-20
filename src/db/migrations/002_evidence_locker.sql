-- Migration: 002_evidence_locker
-- Description: Evidence storage with integrity verification
-- Created: 2026-01-20

BEGIN;

--------------------------------------------------------------------------------
-- EVIDENCE ITEMS TABLE
-- Stores metadata for compliance evidence artifacts
--------------------------------------------------------------------------------

CREATE TABLE evidence_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    collected_at TIMESTAMPTZ NOT NULL,

    -- Evidence classification
    evidence_type VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,

    -- Source information
    source_system VARCHAR(255),
    source_id VARCHAR(255),
    collector_id UUID NOT NULL,

    -- Content reference (actual content in S3)
    content_hash CHAR(64) NOT NULL,  -- SHA-256 of content
    content_size BIGINT NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    s3_key VARCHAR(1024) NOT NULL,
    s3_version_id VARCHAR(255),

    -- Retention
    retention_policy VARCHAR(100) NOT NULL DEFAULT 'standard',
    retention_until TIMESTAMPTZ,
    legal_hold BOOLEAN NOT NULL DEFAULT FALSE,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    verified_at TIMESTAMPTZ,
    verification_status VARCHAR(50),

    -- Metadata
    metadata JSONB NOT NULL DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',

    -- Audit reference
    audit_event_id UUID REFERENCES audit_events(id),

    -- Constraints
    CONSTRAINT valid_evidence_type CHECK (evidence_type ~ '^[a-z][a-z0-9_\.]+$'),
    CONSTRAINT valid_status CHECK (status IN ('active', 'archived', 'deleted', 'quarantined')),
    CONSTRAINT valid_retention_policy CHECK (retention_policy IN (
        'standard',        -- 7 years
        'extended',        -- 10 years
        'permanent',       -- No expiration
        'litigation_hold'  -- Until released
    ))
);

CREATE INDEX idx_evidence_items_created_at ON evidence_items(created_at);
CREATE INDEX idx_evidence_items_collected_at ON evidence_items(collected_at);
CREATE INDEX idx_evidence_items_type ON evidence_items(evidence_type);
CREATE INDEX idx_evidence_items_category ON evidence_items(category);
CREATE INDEX idx_evidence_items_content_hash ON evidence_items(content_hash);
CREATE INDEX idx_evidence_items_source ON evidence_items(source_system, source_id);
CREATE INDEX idx_evidence_items_status ON evidence_items(status) WHERE status != 'deleted';
CREATE INDEX idx_evidence_items_retention ON evidence_items(retention_until)
    WHERE retention_until IS NOT NULL;
CREATE INDEX idx_evidence_items_tags ON evidence_items USING GIN(tags);

--------------------------------------------------------------------------------
-- EVIDENCE CONTROL LINKS
-- Maps evidence to OSCAL controls
--------------------------------------------------------------------------------

CREATE TABLE evidence_control_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    evidence_id UUID NOT NULL REFERENCES evidence_items(id),
    control_id VARCHAR(255) NOT NULL, -- OSCAL control ID (e.g., 'ctrl-accredited-investor')

    -- Link metadata
    link_type VARCHAR(50) NOT NULL DEFAULT 'supports',
    relevance_score DECIMAL(3,2), -- 0.00 to 1.00
    notes TEXT,

    -- Who created the link
    created_by UUID NOT NULL,

    -- Constraints
    CONSTRAINT valid_link_type CHECK (link_type IN (
        'supports',       -- Evidence supports control
        'demonstrates',   -- Evidence demonstrates compliance
        'documents',      -- Evidence documents process
        'exception'       -- Evidence documents exception
    )),
    CONSTRAINT unique_evidence_control UNIQUE (evidence_id, control_id)
);

CREATE INDEX idx_evidence_control_links_evidence ON evidence_control_links(evidence_id);
CREATE INDEX idx_evidence_control_links_control ON evidence_control_links(control_id);

--------------------------------------------------------------------------------
-- EVIDENCE VERIFICATION LOG
-- Track verification attempts and results
--------------------------------------------------------------------------------

CREATE TABLE evidence_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    evidence_id UUID NOT NULL REFERENCES evidence_items(id),

    -- Verification details
    verification_type VARCHAR(50) NOT NULL,
    verified_by UUID, -- NULL for automated checks
    verification_method VARCHAR(100) NOT NULL,

    -- Results
    is_valid BOOLEAN NOT NULL,
    hash_verified BOOLEAN NOT NULL,
    s3_verified BOOLEAN NOT NULL,

    -- Error tracking
    error_code VARCHAR(50),
    error_message TEXT,

    -- Computed hashes during verification
    computed_hash CHAR(64),
    expected_hash CHAR(64),

    -- Constraints
    CONSTRAINT valid_verification_type CHECK (verification_type IN (
        'automated',      -- Scheduled integrity check
        'manual',         -- User-triggered verification
        'audit',          -- External auditor verification
        'retrieval'       -- Verified during retrieval
    ))
);

CREATE INDEX idx_evidence_verifications_evidence ON evidence_verifications(evidence_id);
CREATE INDEX idx_evidence_verifications_created ON evidence_verifications(created_at);
CREATE INDEX idx_evidence_verifications_failed ON evidence_verifications(is_valid)
    WHERE is_valid = FALSE;

--------------------------------------------------------------------------------
-- EVIDENCE COLLECTIONS
-- Group related evidence items
--------------------------------------------------------------------------------

CREATE TABLE evidence_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Collection purpose
    collection_type VARCHAR(50) NOT NULL,

    -- Assessment period
    period_start DATE,
    period_end DATE,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft',

    -- Owner
    created_by UUID NOT NULL,

    -- Constraints
    CONSTRAINT valid_collection_type CHECK (collection_type IN (
        'audit_period',       -- Evidence for audit period
        'control_assessment', -- Evidence for specific control
        'incident',           -- Evidence related to incident
        'investigation',      -- Evidence for investigation
        'regulatory_request'  -- Evidence for regulatory request
    )),
    CONSTRAINT valid_collection_status CHECK (status IN (
        'draft',
        'in_review',
        'approved',
        'submitted',
        'archived'
    ))
);

CREATE INDEX idx_evidence_collections_type ON evidence_collections(collection_type);
CREATE INDEX idx_evidence_collections_status ON evidence_collections(status);
CREATE INDEX idx_evidence_collections_period ON evidence_collections(period_start, period_end);

--------------------------------------------------------------------------------
-- COLLECTION ITEMS
-- Links evidence to collections
--------------------------------------------------------------------------------

CREATE TABLE evidence_collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    collection_id UUID NOT NULL REFERENCES evidence_collections(id),
    evidence_id UUID NOT NULL REFERENCES evidence_items(id),

    -- Item metadata within collection
    sequence_number INT,
    notes TEXT,
    added_by UUID NOT NULL,

    CONSTRAINT unique_collection_evidence UNIQUE (collection_id, evidence_id)
);

CREATE INDEX idx_collection_items_collection ON evidence_collection_items(collection_id);
CREATE INDEX idx_collection_items_evidence ON evidence_collection_items(evidence_id);

--------------------------------------------------------------------------------
-- IMMUTABILITY FOR EVIDENCE (soft delete only)
--------------------------------------------------------------------------------

-- Evidence items can only be soft-deleted
CREATE OR REPLACE FUNCTION evidence_soft_delete_only()
RETURNS TRIGGER AS $$
BEGIN
    -- Only allow status change to 'deleted'
    IF OLD.status != 'deleted' AND NEW.status = 'deleted' THEN
        RETURN NEW;
    END IF;

    -- Prevent actual data changes on deleted items
    IF OLD.status = 'deleted' THEN
        RAISE EXCEPTION 'Deleted evidence cannot be modified';
    END IF;

    -- Allow updates to non-content fields
    IF NEW.content_hash != OLD.content_hash OR
       NEW.s3_bucket != OLD.s3_bucket OR
       NEW.s3_key != OLD.s3_key THEN
        RAISE EXCEPTION 'Evidence content references are immutable';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_items_protect
    BEFORE UPDATE ON evidence_items
    FOR EACH ROW
    EXECUTE FUNCTION evidence_soft_delete_only();

-- Prevent hard deletes
CREATE OR REPLACE FUNCTION prevent_evidence_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Evidence items cannot be deleted. Use soft delete (status = deleted) instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_items_no_delete
    BEFORE DELETE ON evidence_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_evidence_delete();

--------------------------------------------------------------------------------
-- COMMENTS
--------------------------------------------------------------------------------

COMMENT ON TABLE evidence_items IS
    'Compliance evidence artifacts with integrity verification';

COMMENT ON TABLE evidence_control_links IS
    'Maps evidence items to OSCAL control identifiers';

COMMENT ON TABLE evidence_verifications IS
    'Log of all evidence integrity verification attempts';

COMMENT ON TABLE evidence_collections IS
    'Logical groupings of evidence for audits and assessments';

COMMIT;
