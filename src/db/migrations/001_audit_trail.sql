-- Migration: 001_audit_trail
-- Description: Core audit trail tables with hash chain support
-- Created: 2026-01-20

BEGIN;

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Extension for cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

--------------------------------------------------------------------------------
-- AUDIT EVENT TABLE
-- Core append-only audit log with hash chain integrity
--------------------------------------------------------------------------------

CREATE TABLE audit_events (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Sequence for hash chain ordering (monotonically increasing)
    sequence_number BIGSERIAL NOT NULL UNIQUE,

    -- Timestamp with microsecond precision
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Event classification
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL,

    -- Actor information
    actor_id UUID,
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'system', 'api_key'
    actor_ip INET,

    -- Target resource
    resource_type VARCHAR(100),
    resource_id UUID,

    -- Event payload (JSONB for flexibility)
    payload JSONB NOT NULL DEFAULT '{}',

    -- Hash chain fields
    previous_hash CHAR(64) NOT NULL, -- SHA-256 hex
    event_hash CHAR(64) NOT NULL,    -- SHA-256 hex

    -- Merkle tree position (populated during checkpoint)
    merkle_leaf_index BIGINT,
    checkpoint_id UUID,

    -- Constraints
    CONSTRAINT valid_event_type CHECK (event_type ~ '^[a-z][a-z0-9_\.]+$'),
    CONSTRAINT valid_category CHECK (event_category IN (
        'authentication',
        'authorization',
        'evidence',
        'control_assessment',
        'configuration',
        'data_access',
        'data_modification',
        'system',
        'compliance'
    ))
);

-- Indexes for common query patterns
CREATE INDEX idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_actor_id ON audit_events(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id)
    WHERE resource_id IS NOT NULL;
CREATE INDEX idx_audit_events_checkpoint ON audit_events(checkpoint_id)
    WHERE checkpoint_id IS NOT NULL;

-- Hash chain integrity index
CREATE UNIQUE INDEX idx_audit_events_hash_chain ON audit_events(sequence_number, previous_hash);

--------------------------------------------------------------------------------
-- AUDIT CHECKPOINTS TABLE
-- Periodic signed snapshots of the audit trail
--------------------------------------------------------------------------------

CREATE TABLE audit_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Checkpoint sequence
    checkpoint_number BIGSERIAL NOT NULL UNIQUE,

    -- Time range covered
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    -- Event range
    first_sequence_number BIGINT NOT NULL,
    last_sequence_number BIGINT NOT NULL,
    event_count INT NOT NULL,

    -- Merkle tree root
    merkle_root CHAR(64) NOT NULL, -- SHA-256 hex

    -- Cryptographic signature
    signature BYTEA NOT NULL,
    signature_algorithm VARCHAR(50) NOT NULL DEFAULT 'ECDSA-P256-SHA256',
    signing_key_id VARCHAR(255) NOT NULL,

    -- S3 export reference
    s3_bucket VARCHAR(255),
    s3_key VARCHAR(1024),
    s3_version_id VARCHAR(255),

    -- Previous checkpoint for chain
    previous_checkpoint_id UUID REFERENCES audit_checkpoints(id),
    previous_merkle_root CHAR(64),

    -- Constraints
    CONSTRAINT valid_event_range CHECK (last_sequence_number >= first_sequence_number),
    CONSTRAINT valid_period CHECK (period_end >= period_start),
    CONSTRAINT valid_event_count CHECK (event_count = last_sequence_number - first_sequence_number + 1)
);

CREATE INDEX idx_audit_checkpoints_created_at ON audit_checkpoints(created_at);
CREATE INDEX idx_audit_checkpoints_period ON audit_checkpoints(period_start, period_end);

--------------------------------------------------------------------------------
-- GENESIS RECORD
-- Special first record with known hash for chain initialization
--------------------------------------------------------------------------------

-- Insert genesis record (first record in hash chain)
INSERT INTO audit_events (
    id,
    sequence_number,
    created_at,
    event_type,
    event_category,
    actor_type,
    payload,
    previous_hash,
    event_hash
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    0,
    '2026-01-20T00:00:00Z',
    'system.genesis',
    'system',
    'system',
    '{"message": "Audit trail genesis block", "version": "1.0.0"}',
    '0000000000000000000000000000000000000000000000000000000000000000',
    -- SHA-256 of genesis payload
    encode(sha256('{"genesis": true, "version": "1.0.0", "timestamp": "2026-01-20T00:00:00Z"}'::bytea), 'hex')
);

-- Reset sequence to start at 1 for user events
SELECT setval('audit_events_sequence_number_seq', 1, false);

--------------------------------------------------------------------------------
-- IMMUTABILITY ENFORCEMENT
-- Prevent updates and deletes on audit tables
--------------------------------------------------------------------------------

-- Revoke modification permissions
REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_checkpoints FROM PUBLIC;

-- Create audit application role with insert-only access
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
        CREATE ROLE audit_writer;
    END IF;
END
$$;

GRANT INSERT, SELECT ON audit_events TO audit_writer;
GRANT INSERT, SELECT ON audit_checkpoints TO audit_writer;
GRANT USAGE ON SEQUENCE audit_events_sequence_number_seq TO audit_writer;
GRANT USAGE ON SEQUENCE audit_checkpoints_checkpoint_number_seq TO audit_writer;

-- Trigger to prevent updates (defense in depth)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are immutable. Updates and deletes are prohibited.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER audit_checkpoints_immutable
    BEFORE UPDATE OR DELETE ON audit_checkpoints
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

--------------------------------------------------------------------------------
-- HASH CHAIN VALIDATION FUNCTION
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_hash_chain(
    start_seq BIGINT DEFAULT 0,
    end_seq BIGINT DEFAULT NULL
)
RETURNS TABLE (
    is_valid BOOLEAN,
    invalid_at_sequence BIGINT,
    expected_previous_hash CHAR(64),
    actual_previous_hash CHAR(64),
    error_message TEXT
) AS $$
DECLARE
    prev_hash CHAR(64);
    curr_record RECORD;
    actual_end BIGINT;
BEGIN
    -- Get actual end if not specified
    IF end_seq IS NULL THEN
        SELECT MAX(sequence_number) INTO actual_end FROM audit_events;
    ELSE
        actual_end := end_seq;
    END IF;

    -- Get starting hash
    SELECT event_hash INTO prev_hash
    FROM audit_events
    WHERE sequence_number = start_seq;

    IF prev_hash IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            start_seq,
            NULL::CHAR(64),
            NULL::CHAR(64),
            'Start sequence not found';
        RETURN;
    END IF;

    -- Iterate through chain
    FOR curr_record IN
        SELECT sequence_number, previous_hash, event_hash
        FROM audit_events
        WHERE sequence_number > start_seq AND sequence_number <= actual_end
        ORDER BY sequence_number
    LOOP
        IF curr_record.previous_hash != prev_hash THEN
            RETURN QUERY SELECT
                FALSE,
                curr_record.sequence_number,
                prev_hash,
                curr_record.previous_hash,
                'Hash chain broken';
            RETURN;
        END IF;
        prev_hash := curr_record.event_hash;
    END LOOP;

    -- Chain is valid
    RETURN QUERY SELECT
        TRUE,
        NULL::BIGINT,
        NULL::CHAR(64),
        NULL::CHAR(64),
        NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- COMMENTS
--------------------------------------------------------------------------------

COMMENT ON TABLE audit_events IS
    'Append-only audit log with cryptographic hash chain for tamper detection';

COMMENT ON TABLE audit_checkpoints IS
    'Periodic signed snapshots with Merkle tree roots for efficient verification';

COMMENT ON COLUMN audit_events.previous_hash IS
    'SHA-256 hash of the previous event, forming a hash chain';

COMMENT ON COLUMN audit_events.event_hash IS
    'SHA-256(sequence_number || timestamp || event_type || payload || previous_hash)';

COMMENT ON COLUMN audit_checkpoints.merkle_root IS
    'Root hash of Merkle tree computed over all events in checkpoint period';

COMMIT;
