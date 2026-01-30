#!/usr/bin/env node
/**
 * Server Startup Script
 *
 * Handles:
 * 1. Wait for PostgreSQL to be ready
 * 2. Run database migrations
 * 3. Seed data if SEED_DATA=true and database is empty
 * 4. Start the API server
 */

import pg from 'pg';
import { createHash, randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('========================================');
console.log('Securities Law Schema - Startup');
console.log('========================================');

const databaseUrl = process.env.DATABASE_URL;

async function waitForDatabase(pool, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('PostgreSQL is ready!');
      return true;
    } catch (_err) {
      console.log(`Waiting for PostgreSQL... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('PostgreSQL did not become ready in time');
}

async function runMigrations(pool) {
  console.log('Running database migrations...');

  // Migration 1: Initial schema
  const migration1 = `
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'compliance', 'viewer', 'auditor', 'system')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

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
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
  `;

  try {
    await pool.query(migration1);
    console.log('  Migrations applied successfully');
  } catch (err) {
    console.error('  Migration error:', err.message);
    throw err;
  }
}

async function getEvidenceCount(pool) {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM evidence');
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

async function seedDatabase(pool) {
  console.log('Seeding database with demo data...');

  // Load controls
  const controlsPath = join(projectRoot, 'controls', 'regulation-d-controls.json');
  if (!existsSync(controlsPath)) {
    console.log('  Controls file not found, skipping seed');
    return;
  }

  const controls = JSON.parse(readFileSync(controlsPath, 'utf-8'));

  // Extract control IDs
  const controlIds = [];
  function extractIds(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(extractIds);
    } else if (obj && typeof obj === 'object') {
      if (obj.id) controlIds.push(obj.id);
      if (obj.controls) extractIds(obj.controls);
    }
  }
  controls.catalog.groups.forEach(g => {
    if (g.controls) extractIds(g.controls);
  });

  console.log(`  Found ${controlIds.length} controls`);

  // Evidence templates
  const fileTypes = [
    { ext: 'pdf', mime: 'application/pdf' },
    {
      ext: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { ext: 'csv', mime: 'text/csv' },
    { ext: 'json', mime: 'application/json' },
    { ext: 'xml', mime: 'application/xml' },
    { ext: 'eml', mime: 'message/rfc822' },
    { ext: 'png', mime: 'image/png' },
    { ext: 'txt', mime: 'text/plain' },
  ];

  const titles = [
    'Accredited Investor Questionnaire',
    'Net Worth Certification',
    'Income Verification',
    'Private Placement Memorandum',
    'Risk Disclosure Statement',
    'Subscription Agreement',
    'Client Communication Log',
    'Email Archive Export',
    'Meeting Notes',
    'Form D Filing',
    'EDGAR Confirmation',
    'Blue Sky Filing',
    'Offering Circular',
    'Term Sheet',
    'Cap Table',
    'Investor Roster',
    'Bad Actor Questionnaire',
    'Background Check Report',
    'FINRA BrokerCheck',
    'Solicitation Policy',
    'Advertising Review Log',
    'Marketing Compliance Memo',
    'Record Retention Policy',
    'Document Destruction Log',
    'Archive Inventory',
    'Internal Audit Report',
    'Compliance Testing Results',
    'Exception Report',
    'Training Completion Report',
    'Annual Certification',
    'Quiz Results',
    'KYC Documentation',
    'AML Screening Report',
    'OFAC Check Results',
    'Penetration Test Report',
    'Vulnerability Scan',
    'Security Incident Log',
  ];

  const clients = [
    'Apex Capital',
    'Bridgewater Holdings',
    'Cascade Investments',
    'Dominion Wealth',
    'Evergreen Asset Mgmt',
    'Falcon Ridge',
    'Golden Gate Ventures',
    'Horizon Financial',
    'Ironwood Capital',
    'Jupiter Asset Mgmt',
    'Keystone Partners',
    'Lighthouse Investments',
  ];

  const employees = [
    'Sarah Johnson',
    'Michael Chen',
    'Emily Rodriguez',
    'David Kim',
    'Jennifer Walsh',
    'Robert Martinez',
    'Lisa Thompson',
    'James Wilson',
    'Maria Garcia',
    'Christopher Lee',
  ];

  // Generate 200+ evidence records
  const targetCount = 210;
  let inserted = 0;

  for (let i = 0; i < targetCount; i++) {
    const controlId = controlIds[i % controlIds.length];
    const fileType = fileTypes[Math.floor(Math.random() * fileTypes.length)];
    const title = titles[Math.floor(Math.random() * titles.length)];
    const client = clients[Math.floor(Math.random() * clients.length)];
    const employee = employees[Math.floor(Math.random() * employees.length)];

    const id = randomUUID();
    const year = 2022 + Math.floor(Math.random() * 4);
    const month = Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    const collectedAt = new Date(year, month, day).toISOString();

    const fullTitle = `${title} - ${client}`;
    const artifactContent = `${fullTitle}|${controlId}|${i}|${Date.now()}`;
    const artifactHash = 'sha256:' + createHash('sha256').update(artifactContent).digest('hex');

    const metadata = {
      title: fullTitle,
      filename: fullTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_') + '.' + fileType.ext,
      category: fileType.ext,
      collectedBy: employee,
      source: ['Manual Upload', 'Email Archive', 'System Export', 'Scan'][
        Math.floor(Math.random() * 4)
      ],
      tags: [controlId.split('-')[0], fileType.ext],
      retentionYears: 7,
    };

    const preimage = `${id}${artifactHash}${JSON.stringify(metadata)}${collectedAt}`;
    const merkleLeafHash = createHash('sha256').update(preimage).digest('hex');
    const size = 10000 + Math.floor(Math.random() * 500000);

    try {
      await pool.query(
        `INSERT INTO evidence (id, control_id, artifact_hash, artifact_size, content_type, metadata, merkle_leaf_hash, collected_at, collected_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
        [
          id,
          controlId,
          artifactHash,
          size,
          fileType.mime,
          JSON.stringify(metadata),
          merkleLeafHash,
          collectedAt,
          employee,
        ]
      );
      inserted++;
    } catch (err) {
      console.error(`  Failed to insert evidence ${i}:`, err.message);
    }
  }

  console.log(`  Inserted ${inserted} evidence records`);

  // Add audit log entry for seeding
  const auditId = randomUUID();
  const timestamp = new Date().toISOString();
  const details = JSON.stringify({ recordsInserted: inserted, source: 'docker-startup' });
  const preimage = `${auditId}${timestamp}SYSTEM_SEED${details}${'0'.repeat(64)}`;
  const hash = createHash('sha256').update(preimage).digest('hex');

  await pool.query(
    `INSERT INTO audit_log (id, event, actor, details, previous_hash, current_hash, timestamp)
     VALUES ($1, 'SYSTEM_SEED', 'system', $2, $3, $4, $5)`,
    [auditId, details, '0'.repeat(64), hash, timestamp]
  );

  console.log('  Database seeding complete');
}

async function main() {
  if (!databaseUrl) {
    console.log('No DATABASE_URL - starting with in-memory storage');
    await import('../src/api/server.js');
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Wait for database
    await waitForDatabase(pool);

    // Run migrations
    await runMigrations(pool);

    // Seed if requested and database is empty
    if (process.env.SEED_DATA === 'true') {
      const count = await getEvidenceCount(pool);
      if (count === 0) {
        await seedDatabase(pool);
      } else {
        console.log(`Database has ${count} evidence records, skipping seed`);
      }
    }

    await pool.end();

    // Start the server
    console.log('Starting API server...');
    await import('../src/api/server.js');
  } catch (err) {
    console.error('Startup failed:', err.message);
    process.exit(1);
  }
}

main();
