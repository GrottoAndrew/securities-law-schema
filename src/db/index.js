/**
 * Database Module
 *
 * PostgreSQL connection and query methods for the Evidence Locker API.
 * Replaces in-memory stores with persistent storage.
 *
 * @module db
 */

import pg from 'pg';
import { createHash } from 'crypto';
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
 * Send notification via configured channels (email, Slack, Teams)
 * @param {string} subject - Notification subject
 * @param {string} message - Notification body
 */
async function sendNotification(subject, message) {
  if (!config.notifications?.enabled) return;

  const timestamp = new Date().toISOString();

  // Slack webhook
  if (config.notifications.slackWebhook) {
    try {
      await fetch(config.notifications.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${subject}*\n${message}\n_${timestamp}_`
        })
      });
    } catch (err) {
      console.error('Slack notification failed:', err.message);
    }
  }

  // Teams webhook
  if (config.notifications.teamsWebhook) {
    try {
      await fetch(config.notifications.teamsWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          summary: subject,
          sections: [{
            activityTitle: subject,
            text: message,
            facts: [{ name: 'Timestamp', value: timestamp }]
          }]
        })
      });
    } catch (err) {
      console.error('Teams notification failed:', err.message);
    }
  }

  // Email (placeholder - requires SMTP integration)
  if (config.notifications.email) {
    // Log intent - actual SMTP implementation requires nodemailer or similar
    console.error(`[EMAIL NOTIFICATION] To: ${config.notifications.email} Subject: ${subject} Body: ${message}`);
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

  pool.on('error', (err) => {
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
      evidence.status || 'active'
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

  const result = await pool.query(
    'SELECT * FROM evidence WHERE id = $1',
    [id]
  );

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

  const byControl = {};
  for (const row of result.rows) {
    byControl[row.control_id] = {
      count: parseInt(row.evidence_count, 10),
      lastEvidence: row.last_evidence
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
    createdAt: row.created_at?.toISOString()
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
  const previousHash = lastResult.rows.length > 0
    ? lastResult.rows[0].current_hash
    : '0'.repeat(64);

  const id = crypto.randomUUID();
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
    timestamp: row.timestamp?.toISOString()
  };
}

// ===================
// IN-MEMORY FALLBACK
// ===================

// Used when DATABASE_URL is not set (for tests/development)
const inMemoryEvidence = new Map();
const inMemoryAuditLog = [];

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
      if (!byControl[e.controlId].lastEvidence || e.collectedAt > byControl[e.controlId].lastEvidence) {
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
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event,
      actor,
      details,
      previousHash: inMemoryAuditLog.length > 0 ? inMemoryAuditLog[inMemoryAuditLog.length - 1].hash : '0'.repeat(64)
    };
    const preimage = `${entry.id}${entry.timestamp}${entry.event}${JSON.stringify(entry.details)}${entry.previousHash}`;
    entry.hash = createHash('sha256').update(preimage).digest('hex');
    inMemoryAuditLog.push(entry);
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
        limitWarned: evidenceLimitWarned
      },
      auditLog: {
        count: inMemoryAuditLog.length,
        limit: SOFT_LIMIT_AUDIT_LOG,
        percentUsed: Math.round((inMemoryAuditLog.length / SOFT_LIMIT_AUDIT_LOG) * 100),
        limitWarned: auditLimitWarned
      }
    };
  }
};
