-- =============================================================================
-- Securities Law Schema - Database Initialization
-- =============================================================================
-- SEC Rule 17a-4 Compliant Schema Design
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Evidence Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    control_id VARCHAR(255) NOT NULL,
    artifact_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash
    artifact_s3_uri TEXT NOT NULL,
    artifact_size BIGINT NOT NULL,
    content_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    metadata JSONB DEFAULT '{}',
    merkle_leaf_hash VARCHAR(64) NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    collected_by VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    jurisdiction VARCHAR(50) NOT NULL DEFAULT 'sec',
    retention_until TIMESTAMPTZ NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_status CHECK (status IN ('active', 'archived', 'deletion_requested')),
    CONSTRAINT valid_jurisdiction CHECK (jurisdiction IN ('sec', 'gdpr', 'dual'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_evidence_control_id ON evidence(control_id);
CREATE INDEX IF NOT EXISTS idx_evidence_collected_at ON evidence(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status);
CREATE INDEX IF NOT EXISTS idx_evidence_merkle_hash ON evidence(merkle_leaf_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_artifact_hash ON evidence(artifact_hash);

-- -----------------------------------------------------------------------------
-- Audit Trail Table (Append-Only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(100) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50),
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,

    -- This table is append-only - no updates or deletes allowed
    CONSTRAINT audit_immutable CHECK (true)
);

-- Index for hash chain verification
CREATE INDEX IF NOT EXISTS idx_audit_trail_timestamp ON audit_trail(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_event_type ON audit_trail(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_trail_actor ON audit_trail(actor);
CREATE INDEX IF NOT EXISTS idx_audit_trail_resource ON audit_trail(resource_type, resource_id);

-- Prevent updates and deletes on audit_trail
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit trail records cannot be modified or deleted (SEC Rule 17a-4)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_trail_no_update ON audit_trail;
CREATE TRIGGER audit_trail_no_update
    BEFORE UPDATE OR DELETE ON audit_trail
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

-- -----------------------------------------------------------------------------
-- Controls Status Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    control_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500),
    regulation_citation VARCHAR(255),
    evidence_count INTEGER DEFAULT 0,
    last_evidence_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'missing',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_control_status CHECK (status IN ('satisfied', 'partial', 'missing', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_control_status_status ON control_status(status);

-- -----------------------------------------------------------------------------
-- Deletion Requests Table (GDPR Compliance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requestor_email VARCHAR(255) NOT NULL,
    request_type VARCHAR(50) NOT NULL,
    target_data JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    regulatory_exception VARCHAR(100),  -- e.g., 'SEC-17a-4' if cannot delete
    exception_reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by VARCHAR(255),

    CONSTRAINT valid_request_status CHECK (status IN ('pending', 'approved', 'denied', 'exception_applied'))
);

-- -----------------------------------------------------------------------------
-- Merkle Tree Checkpoints
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merkle_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checkpoint_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    merkle_root VARCHAR(64) NOT NULL,
    leaf_count INTEGER NOT NULL,
    evidence_ids UUID[] NOT NULL,
    previous_checkpoint_id UUID REFERENCES merkle_checkpoints(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merkle_checkpoints_time ON merkle_checkpoints(checkpoint_time DESC);

-- -----------------------------------------------------------------------------
-- Users Table (for demo purposes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    organization VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_role CHECK (role IN ('admin', 'compliance', 'viewer', 'auditor'))
);

-- -----------------------------------------------------------------------------
-- Seed initial audit trail entry
-- -----------------------------------------------------------------------------
INSERT INTO audit_trail (
    event_type,
    actor,
    actor_role,
    details,
    previous_hash,
    current_hash
) VALUES (
    'SYSTEM_INITIALIZED',
    'system',
    'system',
    '{"version": "0.2.0", "compliance": ["SEC-17a-4", "FINRA-4511"]}',
    '0000000000000000000000000000000000000000000000000000000000000000',
    encode(sha256('SYSTEM_INITIALIZED' || NOW()::text), 'hex')
) ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Function to compute evidence retention date
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_retention_date(jurisdiction VARCHAR, collected_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ AS $$
BEGIN
    IF jurisdiction = 'sec' OR jurisdiction = 'dual' THEN
        -- SEC Rule 17a-4: 7 years minimum
        RETURN collected_at + INTERVAL '7 years';
    ELSIF jurisdiction = 'gdpr' THEN
        -- GDPR: As long as necessary (default 3 years after relationship ends)
        RETURN collected_at + INTERVAL '3 years';
    ELSE
        RETURN collected_at + INTERVAL '7 years';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-compute retention date
CREATE OR REPLACE FUNCTION set_retention_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.retention_until IS NULL THEN
        NEW.retention_until := compute_retention_date(NEW.jurisdiction, NEW.collected_at);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_set_retention ON evidence;
CREATE TRIGGER evidence_set_retention
    BEFORE INSERT ON evidence
    FOR EACH ROW
    EXECUTE FUNCTION set_retention_date();

-- -----------------------------------------------------------------------------
-- Update timestamp trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_updated_at ON evidence;
CREATE TRIGGER evidence_updated_at
    BEFORE UPDATE ON evidence
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS control_status_updated_at ON control_status;
CREATE TRIGGER control_status_updated_at
    BEFORE UPDATE ON control_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- Grant Permissions (adjust for your user)
-- -----------------------------------------------------------------------------
-- GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO compliance_app;
-- GRANT UPDATE ON evidence, control_status, users TO compliance_app;
-- GRANT DELETE ON deletion_requests TO compliance_app;
-- REVOKE UPDATE, DELETE ON audit_trail FROM compliance_app;

COMMENT ON TABLE evidence IS 'Evidence artifacts linked to compliance controls (SEC 17a-4 compliant)';
COMMENT ON TABLE audit_trail IS 'Immutable audit log with hash chain verification';
COMMENT ON TABLE control_status IS 'Current status of each compliance control';
COMMENT ON TABLE deletion_requests IS 'GDPR deletion requests with regulatory exception handling';
COMMENT ON TABLE merkle_checkpoints IS 'Periodic Merkle tree snapshots for evidence integrity';
