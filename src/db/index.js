/**
 * Database Module
 *
 * PostgreSQL connection and query methods for the Evidence Locker API.
 * Replaces in-memory stores with persistent storage.
 *
 * @module db
 */

import pg from 'pg';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from '../config/index.js';

const { Pool } = pg;

/** @type {import('pg').Pool | null} */
let pool = null;

/** Soft limits for in-memory fallback - warn but never delete */
const SOFT_LIMIT_EVIDENCE = config.inMemoryLimits?.evidenceSoftLimit || 10000;
const SOFT_LIMIT_AUDIT_LOG = config.inMemoryLimits?.auditLogSoftLimit || 50000;
let evidenceLimitWarned = false;
let auditLimitWarned = false;

/**
 * Fetch with exponential backoff retry
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxRetries) {
      const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

/**
 * Send email notification (fallback for webhook failures)
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 */
function sendEmailNotification(to, subject, body) {
  // Best practice: Use nodemailer with SMTP, SendGrid, AWS SES, or similar.
  // Configure via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS env vars.
  // For now, log to stderr for external log aggregation (Datadog, Splunk, etc.)
  console.error(`[EMAIL NOTIFICATION] To: ${to} Subject: ${subject} Body: ${body}`);
}

/**
 * Send notification via configured channels (email, Slack, Teams)
 * Retries webhooks 3 times with exponential backoff before falling back to email.
 * @param {string} subject - Notification subject
 * @param {string} message - Notification body
 */
async function sendNotification(subject, message) {
  if (!config.notifications?.enabled) return;

  const timestamp = new Date().toISOString();
  const failures = [];

  // Slack webhook with retry
  if (config.notifications.slackWebhook) {
    try {
      await fetchWithRetry(config.notifications.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${subject}*\n${message}\n_${timestamp}_`,
        }),
      });
    } catch (err) {
      console.error('Slack notification failed after 3 retries:', err.message);
      failures.push(`Slack: ${err.message}`);
    }
  }

  // Teams webhook with retry
  if (config.notifications.teamsWebhook) {
    try {
      await fetchWithRetry(config.notifications.teamsWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          summary: subject,
          sections: [
            {
              activityTitle: subject,
              text: message,
              facts: [{ name: 'Timestamp', value: timestamp }],
            },
          ],
        }),
      });
    } catch (err) {
      console.error('Teams notification failed after 3 retries:', err.message);
      failures.push(`Teams: ${err.message}`);
    }
  }

  // Email notification (always sent if configured, plus failure report)
  if (config.notifications.email) {
    let emailBody = message;
    if (failures.length > 0) {
      emailBody += `\n\nWebhook delivery failures:\n${failures.join('\n')}`;
    }
    sendEmailNotification(config.notifications.email, subject, emailBody);
  }
}

/**
 * @typedef {Object} Evidence
 * @property {string} id - UUID
 * @property {string} controlId - Control identifier
 * @property {string} artifactHash - SHA-256 hash of artifact
 * @property {number} artifactSize - Size in bytes
 * @property {string} contentType - MIME type
 * @property {Object} metadata - Additional metadata
 * @property {string} merkleLeafHash - Merkle tree leaf hash
 * @property {string} collectedAt - ISO timestamp
 * @property {string} collectedBy - User email
 * @property {string} status - active|archived|deleted
 * @property {string} [s3Key] - S3 object key
 * @property {string} [createdAt] - ISO timestamp
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string} id - UUID
 * @property {string} event - Event type
 * @property {string} actor - User or system identifier
 * @property {Object} details - Event details
 * @property {string} previousHash - Previous entry hash
 * @property {string} hash - Current entry hash
 * @property {string} timestamp - ISO timestamp
 */

/**
 * Initialize database connection pool
 * @param {string} [databaseUrl] - PostgreSQL connection string
 * @returns {import('pg').Pool | null}
 */
export function initDatabase(databaseUrl) {
  if (!databaseUrl) {
    console.warn('DATABASE_URL not set - using in-memory fallback');
    return null;
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', err => {
    console.error('Unexpected database error:', err);
  });

  return pool;
}

/**
 * Check if database is connected
 * @returns {boolean}
 */
export function isConnected() {
  return pool !== null;
}

/**
 * Get the pool for direct queries
 * @returns {import('pg').Pool | null}
 */
export function getPool() {
  return pool;
}

/**
 * Set tenant context for Row-Level Security (RLS)
 * Must be called at the start of each request before any queries.
 *
 * @param {import('pg').PoolClient} client - Database client from pool
 * @param {string} tenantId - UUID of the current tenant
 * @returns {Promise<void>}
 */
export async function setTenantContext(client, tenantId) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for RLS');
  }
  // Validate UUID format to prevent SQL injection (SET doesn't support $1 parameterization)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error('Invalid tenant ID format: must be a valid UUID');
  }
  await client.query(`SET app.current_tenant_id = '${tenantId}'`);
}

/**
 * Execute a query within tenant context (RLS-safe)
 *
 * @param {string} tenantId - UUID of the current tenant
 * @param {Function} queryFn - Async function that receives the client and executes queries
 * @returns {Promise<any>} - Result of queryFn
 */
export async function withTenantContext(tenantId, queryFn) {
  if (!pool) throw new Error('Database not connected');

  const client = await pool.connect();
  try {
    await setTenantContext(client, tenantId);
    return await queryFn(client);
  } finally {
    // Reset tenant context before returning to pool
    await client.query('RESET app.current_tenant_id');
    client.release();
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  if (!pool) return false;
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (err) {
    console.error('Database connection test failed:', err.message);
    return false;
  }
}

/**
 * Close database connection
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ===================
// EVIDENCE OPERATIONS
// ===================

/**
 * Create a new evidence record
 * @param {Evidence} evidence - Evidence to create
 * @returns {Promise<Evidence>}
 */
export async function createEvidence(evidence) {
  if (!pool) throw new Error('Database not connected');

  const result = await pool.query(
    `INSERT INTO evidence (id, control_id, artifact_hash, artifact_size, content_type, metadata, merkle_leaf_hash, collected_at, collected_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      evidence.id,
      evidence.controlId,
      evidence.artifactHash,
      evidence.artifactSize || 0,
      evidence.contentType || 'application/octet-stream',
      JSON.stringify(evidence.metadata || {}),
      evidence.merkleLeafHash,
      evidence.collectedAt,
      evidence.collectedBy,
      evidence.status || 'active',
    ]
  );

  return rowToEvidence(result.rows[0]);
}

/**
 * Get evidence by ID
 * @param {string} id - Evidence UUID
 * @returns {Promise<Evidence | null>}
 */
export async function getEvidence(id) {
  if (!pool) throw new Error('Database not connected');

  const result = await pool.query('SELECT * FROM evidence WHERE id = $1', [id]);

  if (result.rows.length === 0) return null;
  return rowToEvidence(result.rows[0]);
}

/**
 * List evidence records with optional filters
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.controlId] - Filter by control ID
 * @param {string} [filters.status] - Filter by status
 * @param {number} [filters.limit] - Max records to return
 * @param {number} [filters.offset] - Records to skip
 * @returns {Promise<Evidence[]>}
 */
export async function listEvidence(filters = {}) {
  if (!pool) throw new Error('Database not connected');

  let query = 'SELECT * FROM evidence WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.controlId) {
    query += ` AND control_id = $${paramIndex++}`;
    params.push(filters.controlId);
  }

  if (filters.status) {
    query += ` AND status = $${paramIndex++}`;
    params.push(filters.status);
  }

  query += ' ORDER BY collected_at DESC';

  if (filters.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(filters.limit);
  }

  if (filters.offset) {
    query += ` OFFSET $${paramIndex++}`;
    params.push(filters.offset);
  }

  const result = await pool.query(query, params);
  return result.rows.map(rowToEvidence);
}

/**
 * Count evidence records with optional filters
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.controlId] - Filter by control ID
 * @param {string} [filters.status] - Filter by status
 * @returns {Promise<number>}
 */
export async function countEvidence(filters = {}) {
  if (!pool) throw new Error('Database not connected');

  let query = 'SELECT COUNT(*) as count FROM evidence WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.controlId) {
    query += ` AND control_id = $${paramIndex++}`;
    params.push(filters.controlId);
  }

  if (filters.status) {
    query += ` AND status = $${paramIndex++}`;
    params.push(filters.status);
  }

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Get evidence counts grouped by control ID
 * @returns {Promise<Object.<string, {count: number, lastEvidence: string}>>}
 */
export async function getEvidenceByControl() {
  if (!pool) throw new Error('Database not connected');

  const result = await pool.query(`
    SELECT
      control_id,
      COUNT(*) as evidence_count,
      MAX(collected_at) as last_evidence
    FROM evidence
    WHERE status = 'active'
    GROUP BY control_id
  `);

  /** @type {Record<string, {count: number, lastEvidence: string}>} */
  const byControl = {};
  for (const row of result.rows) {
    byControl[row.control_id] = {
      count: parseInt(row.evidence_count, 10),
      lastEvidence: row.last_evidence,
    };
  }
  return byControl;
}

function rowToEvidence(row) {
  return {
    id: row.id,
    controlId: row.control_id,
    artifactHash: row.artifact_hash,
    artifactSize: parseInt(row.artifact_size, 10),
    contentType: row.content_type,
    metadata: row.metadata,
    merkleLeafHash: row.merkle_leaf_hash,
    collectedAt: row.collected_at?.toISOString(),
    collectedBy: row.collected_by,
    status: row.status,
    s3Key: row.s3_key,
    createdAt: row.created_at?.toISOString(),
  };
}

// ===================
// AUDIT LOG OPERATIONS
// ===================

/**
 * Create a new audit log entry with hash chain
 * @param {string} event - Event type
 * @param {string} actor - User or system identifier
 * @param {Object} details - Event details
 * @returns {Promise<AuditEntry>}
 */
export async function createAuditEntry(event, actor, details) {
  if (!pool) throw new Error('Database not connected');

  // Get previous hash
  const lastResult = await pool.query(
    'SELECT current_hash FROM audit_log ORDER BY timestamp DESC LIMIT 1'
  );
  const previousHash =
    lastResult.rows.length > 0 ? lastResult.rows[0].current_hash : '0'.repeat(64);

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const preimage = `${id}${timestamp}${event}${JSON.stringify(details)}${previousHash}`;
  const currentHash = createHash('sha256').update(preimage).digest('hex');

  const result = await pool.query(
    `INSERT INTO audit_log (id, event, actor, details, previous_hash, current_hash, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, event, actor, JSON.stringify(details), previousHash, currentHash, timestamp]
  );

  return rowToAuditEntry(result.rows[0]);
}

/**
 * List audit log entries with optional filters
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.eventType] - Filter by event type
 * @param {string} [filters.actor] - Filter by actor
 * @param {number} [filters.limit] - Max records to return
 * @param {number} [filters.offset] - Records to skip
 * @returns {Promise<AuditEntry[]>}
 */
export async function listAuditLog(filters = {}) {
  if (!pool) throw new Error('Database not connected');

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.eventType) {
    query += ` AND event = $${paramIndex++}`;
    params.push(filters.eventType);
  }

  if (filters.actor) {
    query += ` AND actor = $${paramIndex++}`;
    params.push(filters.actor);
  }

  query += ' ORDER BY timestamp DESC';

  if (filters.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(filters.limit);
  }

  if (filters.offset) {
    query += ` OFFSET $${paramIndex++}`;
    params.push(filters.offset);
  }

  const result = await pool.query(query, params);
  return result.rows.map(rowToAuditEntry);
}

/**
 * Count audit log entries with optional filters
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.eventType] - Filter by event type
 * @returns {Promise<number>}
 */
export async function countAuditLog(filters = {}) {
  if (!pool) throw new Error('Database not connected');

  let query = 'SELECT COUNT(*) as count FROM audit_log WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.eventType) {
    query += ` AND event = $${paramIndex++}`;
    params.push(filters.eventType);
  }

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

function rowToAuditEntry(row) {
  return {
    id: row.id,
    event: row.event,
    actor: row.actor,
    details: row.details,
    previousHash: row.previous_hash,
    hash: row.current_hash,
    timestamp: row.timestamp?.toISOString(),
  };
}

// ===================
// IN-MEMORY FALLBACK WITH FILE PERSISTENCE
// ===================

// Used when DATABASE_URL is not set (for tests/development)
// Data is persisted to data/demo-db/ so it survives process restarts.
// PRODUCTION: Use PostgreSQL via DATABASE_URL. This is demo-only.
const inMemoryEvidence = new Map();
const inMemoryAuditLog = [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMO_DB_DIR = join(__dirname, '..', '..', 'data', 'demo-db');
const DEMO_EVIDENCE_FILE = `${DEMO_DB_DIR}/evidence.json`;
const DEMO_AUDIT_FILE = `${DEMO_DB_DIR}/audit-log.json`;

/**
 * Load persisted demo data from disk on startup.
 * Silently skips if files don't exist (first run).
 */
function loadPersistedData() {
  try {
    if (!existsSync(DEMO_DB_DIR)) {
      mkdirSync(DEMO_DB_DIR, { recursive: true });
    }
    if (existsSync(DEMO_EVIDENCE_FILE)) {
      const data = JSON.parse(readFileSync(DEMO_EVIDENCE_FILE, 'utf-8'));
      for (const [key, value] of Object.entries(data)) {
        inMemoryEvidence.set(key, value);
      }
      console.log(`[demo-db] Loaded ${inMemoryEvidence.size} evidence records from disk`);
    }
    if (existsSync(DEMO_AUDIT_FILE)) {
      const data = JSON.parse(readFileSync(DEMO_AUDIT_FILE, 'utf-8'));
      inMemoryAuditLog.push(...data);
      console.log(`[demo-db] Loaded ${inMemoryAuditLog.length} audit entries from disk`);
    }
  } catch (err) {
    console.warn(`[demo-db] Could not load persisted data: ${err.message}`);
  }
}

/** Persist current in-memory state to disk (debounced, 1s). */
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      if (!existsSync(DEMO_DB_DIR)) {
        mkdirSync(DEMO_DB_DIR, { recursive: true });
      }
      const evidenceObj = Object.fromEntries(inMemoryEvidence);
      writeFileSync(DEMO_EVIDENCE_FILE, JSON.stringify(evidenceObj, null, 2));
      writeFileSync(DEMO_AUDIT_FILE, JSON.stringify(inMemoryAuditLog, null, 2));
    } catch (err) {
      console.warn(`[demo-db] Persistence write failed: ${err.message}`);
    }
  }, 1000);
}

// Load any previously persisted demo data
loadPersistedData();

// Flush pending writes on process exit to prevent data loss
function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (inMemoryEvidence.size > 0 || inMemoryAuditLog.length > 0) {
      if (!existsSync(DEMO_DB_DIR)) {
        mkdirSync(DEMO_DB_DIR, { recursive: true });
      }
      const evidenceObj = Object.fromEntries(inMemoryEvidence);
      writeFileSync(DEMO_EVIDENCE_FILE, JSON.stringify(evidenceObj, null, 2));
      writeFileSync(DEMO_AUDIT_FILE, JSON.stringify(inMemoryAuditLog, null, 2));
    }
  } catch (err) {
    console.warn(`[demo-db] Exit flush failed: ${err.message}`);
  }
}
process.on('SIGTERM', flushPersist);
process.on('SIGINT', flushPersist);
process.on('exit', flushPersist);

/**
 * In-memory fallback for development/testing when DATABASE_URL is not set.
 * Includes size limits to prevent unbounded memory growth.
 */
export const fallback = {
  evidence: inMemoryEvidence,
  auditLog: inMemoryAuditLog,

  /**
   * @param {Evidence} evidence
   * @returns {Evidence}
   */
  createEvidence(evidence) {
    // Soft limit: warn but never delete (7-year retention requirement)
    if (inMemoryEvidence.size >= SOFT_LIMIT_EVIDENCE && !evidenceLimitWarned) {
      const msg = `In-memory evidence store exceeded ${SOFT_LIMIT_EVIDENCE} records. Configure DATABASE_URL for production use.`;
      console.error(`WARNING: ${msg}`);
      sendNotification('In-Memory Evidence Limit Exceeded', msg);
      evidenceLimitWarned = true;
    }
    inMemoryEvidence.set(evidence.id, evidence);
    schedulePersist();
    return evidence;
  },

  getEvidence(id) {
    return inMemoryEvidence.get(id) || null;
  },

  listEvidence(filters = {}) {
    let results = Array.from(inMemoryEvidence.values());
    if (filters.controlId) {
      results = results.filter(e => e.controlId === filters.controlId);
    }
    if (filters.status) {
      results = results.filter(e => e.status === filters.status);
    }
    return results;
  },

  countEvidence(filters = {}) {
    return this.listEvidence(filters).length;
  },

  getEvidenceByControl() {
    const byControl = {};
    for (const e of inMemoryEvidence.values()) {
      if (e.status !== 'active') continue;
      if (!byControl[e.controlId]) {
        byControl[e.controlId] = { count: 0, lastEvidence: null };
      }
      byControl[e.controlId].count++;
      if (
        !byControl[e.controlId].lastEvidence ||
        e.collectedAt > byControl[e.controlId].lastEvidence
      ) {
        byControl[e.controlId].lastEvidence = e.collectedAt;
      }
    }
    return byControl;
  },

  /**
   * @param {string} event
   * @param {string} actor
   * @param {Object} details
   * @returns {AuditEntry}
   */
  createAuditEntry(event, actor, details) {
    // Soft limit: warn but never delete (7-year retention requirement)
    if (inMemoryAuditLog.length >= SOFT_LIMIT_AUDIT_LOG && !auditLimitWarned) {
      const msg = `In-memory audit log exceeded ${SOFT_LIMIT_AUDIT_LOG} entries. Configure DATABASE_URL for production use.`;
      console.error(`WARNING: ${msg}`);
      sendNotification('In-Memory Audit Log Limit Exceeded', msg);
      auditLimitWarned = true;
    }
    const previousHash = inMemoryAuditLog.length > 0 ? inMemoryAuditLog[inMemoryAuditLog.length - 1].hash : '0'.repeat(64);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const preimage = `${id}${timestamp}${event}${JSON.stringify(details)}${previousHash}`;
    const hash = createHash('sha256').update(preimage).digest('hex');
    /** @type {AuditEntry} */
    const entry = {
      id,
      timestamp,
      event,
      actor,
      details,
      previousHash,
      hash,
    };
    inMemoryAuditLog.push(entry);
    schedulePersist();
    return entry;
  },

  listAuditLog(filters = {}) {
    let logs = [...inMemoryAuditLog];
    if (filters.eventType) {
      logs = logs.filter(l => l.event === filters.eventType);
    }
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (filters.offset) logs = logs.slice(filters.offset);
    if (filters.limit) logs = logs.slice(0, filters.limit);
    return logs;
  },

  countAuditLog(filters = {}) {
    let logs = inMemoryAuditLog;
    if (filters.eventType) {
      logs = logs.filter(l => l.event === filters.eventType);
    }
    return logs.length;
  },

  clear() {
    inMemoryEvidence.clear();
    inMemoryAuditLog.length = 0;
    evidenceLimitWarned = false;
    auditLimitWarned = false;
  },

  /**
   * Get memory usage statistics for health endpoint
   * @returns {Object} Memory stats
   */
  getMemoryStats() {
    return {
      evidence: {
        count: inMemoryEvidence.size,
        limit: SOFT_LIMIT_EVIDENCE,
        percentUsed: Math.round((inMemoryEvidence.size / SOFT_LIMIT_EVIDENCE) * 100),
        limitWarned: evidenceLimitWarned,
      },
      auditLog: {
        count: inMemoryAuditLog.length,
        limit: SOFT_LIMIT_AUDIT_LOG,
        percentUsed: Math.round((inMemoryAuditLog.length / SOFT_LIMIT_AUDIT_LOG) * 100),
        limitWarned: auditLimitWarned,
      },
    };
  },
};
