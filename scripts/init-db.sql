-- =============================================================================
-- Securities Law Schema - Database Initialization
-- =============================================================================
-- SEC Rule 17a-4 Compliant Schema Design
-- Must match migrate.js schema for consistency
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Migration tracking (must exist first)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Users Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'compliance', 'viewer', 'auditor', 'system')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Evidence Table
-- Schema matches migrate.js and src/db/index.js
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_id VARCHAR(100) NOT NULL,
    artifact_hash VARCHAR(128) NOT NULL,
    artifact_size BIGINT DEFAULT 0,
    content_type VARCHAR(255) DEFAULT 'application/octet-stream',
    metadata JSONB DEFAULT '{}',
    merkle_leaf_hash VARCHAR(64) NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL,
    collected_by VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    s3_key VARCHAR(512),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_control_id ON evidence(control_id);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status);
CREATE INDEX IF NOT EXISTS idx_evidence_collected_at ON evidence(collected_at);

-- -----------------------------------------------------------------------------
-- Audit Log Table (Append-Only)
-- Table name is audit_log to match src/db/index.js
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event VARCHAR(100) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}',
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

-- Prevent updates and deletes on audit_log (SEC Rule 17a-4)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log records cannot be modified or deleted (SEC Rule 17a-4)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

-- -----------------------------------------------------------------------------
-- Controls Cache Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS controls (
    id VARCHAR(100) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    parent_id VARCHAR(100),
    regulation_citation VARCHAR(255),
    regulation_ref VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Deletion Requests Table (GDPR Compliance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_email VARCHAR(255) NOT NULL,
    request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('erasure', 'rectification', 'portability')),
    status VARCHAR(50) DEFAULT 'logged' CHECK (status IN ('logged', 'executed', 'denied', 'pending')),
    denial_reason VARCHAR(500),
    sec_exception BOOLEAN DEFAULT FALSE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_email ON deletion_requests(subject_email);

-- -----------------------------------------------------------------------------
-- Seed initial audit log entry
-- -----------------------------------------------------------------------------
INSERT INTO audit_log (
    event,
    actor,
    details,
    previous_hash,
    current_hash
) VALUES (
    'SYSTEM_INITIALIZED',
    'system',
    '{"version": "0.2.0", "compliance": ["SEC-17a-4", "FINRA-4511"]}',
    '0000000000000000000000000000000000000000000000000000000000000000',
    encode(sha256('SYSTEM_INITIALIZED' || NOW()::text), 'hex')
) ON CONFLICT DO NOTHING;

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

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS controls_updated_at ON controls;
CREATE TRIGGER controls_updated_at
    BEFORE UPDATE ON controls
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE evidence IS 'Evidence artifacts linked to compliance controls (SEC 17a-4 compliant)';
COMMENT ON TABLE audit_log IS 'Immutable audit log with hash chain verification';
COMMENT ON TABLE controls IS 'Cached control definitions from OSCAL catalog';
COMMENT ON TABLE deletion_requests IS 'GDPR deletion requests with SEC exception handling';
