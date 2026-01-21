#!/usr/bin/env node
/**
 * Database Migration Script
 *
 * Creates and updates the PostgreSQL schema for the Evidence Locker.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run db:migrate
 *   DATABASE_URL=postgresql://... npm run db:migrate -- --rollback
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   DATABASE_SSL - Set to 'true' for SSL connections (optional)
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');

// Migration definitions
const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Users and roles
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'compliance', 'viewer', 'auditor', 'system')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Evidence artifacts
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

      -- Audit trail (immutable)
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

      -- Controls cache (for faster queries)
      CREATE TABLE IF NOT EXISTS controls (
        id VARCHAR(100) PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        parent_id VARCHAR(100),
        regulation_citation VARCHAR(255),
        regulation_ref VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- GDPR deletion requests (logged but not executed for SEC records)
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

      -- Migration tracking
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
    down: `
      DROP TABLE IF EXISTS migrations CASCADE;
      DROP TABLE IF EXISTS deletion_requests CASCADE;
      DROP TABLE IF EXISTS controls CASCADE;
      DROP TABLE IF EXISTS audit_log CASCADE;
      DROP TABLE IF EXISTS evidence CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `,
  },
  {
    version: 2,
    name: 'add_retention_policy',
    up: `
      -- Retention policy tracking
      CREATE TABLE IF NOT EXISTS retention_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        jurisdiction VARCHAR(50) NOT NULL CHECK (jurisdiction IN ('sec', 'gdpr', 'dual')),
        retention_years INTEGER NOT NULL,
        worm_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Default SEC retention policy
      INSERT INTO retention_policies (name, jurisdiction, retention_years, worm_enabled)
      VALUES ('SEC 17a-4', 'sec', 7, TRUE)
      ON CONFLICT DO NOTHING;

      -- Add retention policy reference to evidence
      ALTER TABLE evidence ADD COLUMN IF NOT EXISTS retention_policy_id UUID REFERENCES retention_policies(id);

      -- Evidence retention tracking
      CREATE TABLE IF NOT EXISTS evidence_retention (
        evidence_id UUID PRIMARY KEY REFERENCES evidence(id),
        retention_start TIMESTAMPTZ NOT NULL,
        retention_end TIMESTAMPTZ NOT NULL,
        legal_hold BOOLEAN DEFAULT FALSE,
        legal_hold_reason VARCHAR(500)
      );
    `,
    down: `
      DROP TABLE IF EXISTS evidence_retention CASCADE;
      ALTER TABLE evidence DROP COLUMN IF EXISTS retention_policy_id;
      DROP TABLE IF EXISTS retention_policies CASCADE;
    `,
  },
  {
    version: 3,
    name: 'add_catalog_versioning',
    up: `
      -- Control catalog versions (immutable)
      CREATE TABLE IF NOT EXISTS catalog_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version VARCHAR(50) NOT NULL,
        catalog_hash VARCHAR(64) NOT NULL,
        signature VARCHAR(512),
        signed_by VARCHAR(255),
        signed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_versions_version ON catalog_versions(version);

      -- Link controls to catalog version
      ALTER TABLE controls ADD COLUMN IF NOT EXISTS catalog_version_id UUID REFERENCES catalog_versions(id);
    `,
    down: `
      ALTER TABLE controls DROP COLUMN IF EXISTS catalog_version_id;
      DROP TABLE IF EXISTS catalog_versions CASCADE;
    `,
  },
];

class Migrator {
  constructor(databaseUrl) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      console.log('Connected to database');
    } catch (err) {
      throw new Error(`Failed to connect to database: ${err.message}`);
    }
  }

  async close() {
    await this.pool.end();
  }

  computeChecksum(sql) {
    return createHash('sha256').update(sql).digest('hex').substring(0, 64);
  }

  async getAppliedMigrations() {
    try {
      const result = await this.pool.query(
        'SELECT version, name, checksum FROM migrations ORDER BY version'
      );
      return result.rows;
    } catch (err) {
      // migrations table doesn't exist yet
      return [];
    }
  }

  async applyMigration(migration) {
    const client = await this.pool.connect();
    const checksum = this.computeChecksum(migration.up);

    try {
      await client.query('BEGIN');
      await client.query(migration.up);
      await client.query(
        'INSERT INTO migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, checksum]
      );
      await client.query('COMMIT');
      console.log(`  Applied migration ${migration.version}: ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${migration.version} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  async rollbackMigration(migration) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(migration.down);
      await client.query('DELETE FROM migrations WHERE version = $1', [migration.version]);
      await client.query('COMMIT');
      console.log(`  Rolled back migration ${migration.version}: ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Rollback ${migration.version} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  async migrate() {
    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map((m) => m.version));
    const pending = migrations.filter((m) => !appliedVersions.has(m.version));

    if (pending.length === 0) {
      console.log('Database is up to date');
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);

    for (const migration of pending.sort((a, b) => a.version - b.version)) {
      await this.applyMigration(migration);
    }

    console.log('Migration complete');
  }

  async rollback(steps = 1) {
    const applied = await this.getAppliedMigrations();

    if (applied.length === 0) {
      console.log('No migrations to rollback');
      return;
    }

    const toRollback = applied.slice(-steps).reverse();
    console.log(`Rolling back ${toRollback.length} migration(s)...`);

    for (const appliedMigration of toRollback) {
      const migration = migrations.find((m) => m.version === appliedMigration.version);
      if (migration) {
        await this.rollbackMigration(migration);
      }
    }

    console.log('Rollback complete');
  }

  async status() {
    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map((m) => m.version));

    console.log('\nMigration Status:');
    console.log('=================');

    for (const migration of migrations) {
      const status = appliedVersions.has(migration.version) ? '[APPLIED]' : '[PENDING]';
      console.log(`  ${status} ${migration.version}: ${migration.name}`);
    }
    console.log();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('\nUsage:');
    console.error('  DATABASE_URL=postgresql://... npm run db:migrate');
    console.error('  DATABASE_URL=postgresql://... npm run db:migrate -- --rollback');
    console.error('  DATABASE_URL=postgresql://... npm run db:migrate -- --status');
    process.exit(1);
  }

  const migrator = new Migrator(databaseUrl);

  try {
    await migrator.connect();

    switch (command) {
      case 'up':
      case '--up':
        await migrator.migrate();
        break;
      case 'down':
      case '--rollback':
        const steps = parseInt(args[1], 10) || 1;
        await migrator.rollback(steps);
        break;
      case 'status':
      case '--status':
        await migrator.status();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

main();
