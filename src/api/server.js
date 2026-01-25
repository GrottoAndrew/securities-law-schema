/**
 * Compliance API Server
 *
 * Provides REST endpoints for:
 * - Control catalog queries
 * - Evidence submission and verification
 * - Compliance status dashboard
 * - Auditor access management
 *
 * Security: Helmet, CORS, JWT authentication
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createHash } from 'crypto';
import * as db from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');

// Configuration with strict validation
const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
};

// Initialize database connection
db.initDatabase(config.databaseUrl);
const useDatabase = db.isConnected();

// Fail fast on missing JWT secret in production
if (!config.jwtSecret) {
  if (config.nodeEnv === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is required in production');
    process.exit(1);
  }
  config.jwtSecret = 'development-only-secret-do-not-use-in-production';
  console.warn('WARNING: Using development JWT secret. Set JWT_SECRET in production.');
}

const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  })
);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      // Check explicit origins
      if (config.corsOrigins.includes(origin)) return callback(null, true);

      // Check bolt.new wildcard patterns
      if (origin.endsWith('.bolt.new') || origin.endsWith('.lite.bolt.new')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

// Handle JSON parse errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next(err);
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// Load data helpers with proper error handling
function loadControls() {
  const controlsPath = join(projectRoot, 'controls', 'regulation-d-controls.json');
  if (!existsSync(controlsPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(controlsPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse controls file: ${err.message}`);
    return null;
  }
}

function loadSchemas() {
  const dir = join(projectRoot, 'schemas', 'regulation-d');
  if (!existsSync(dir)) {
    return [];
  }

  const results = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonld'));

  for (const f of files) {
    try {
      const content = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      results.push({ filename: f, content });
    } catch (err) {
      console.error(`Failed to parse schema ${f}: ${err.message}`);
    }
  }
  return results;
}

function loadEnforcementCases() {
  const dir = join(projectRoot, 'data', 'sample-enforcement');
  if (!existsSync(dir)) {
    return [];
  }

  const results = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const f of files) {
    try {
      const content = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      results.push({ filename: f, content });
    } catch (err) {
      console.error(`Failed to parse enforcement case ${f}: ${err.message}`);
    }
  }
  return results;
}

// Audit logging - uses database if connected, otherwise in-memory fallback
async function logAudit(event, actor, details) {
  if (useDatabase) {
    return await db.createAuditEntry(event, actor, details);
  }
  return db.fallback.createAuditEntry(event, actor, details);
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }
    return res
      .status(403)
      .json({ error: 'Token verification failed', code: 'TOKEN_VERIFICATION_FAILED' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function safeParseInt(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

// ===================
// PUBLIC ENDPOINTS
// ===================

app.get('/api/v1/health', async (_req, res) => {
  const dbConnected = useDatabase ? await db.testConnection() : false;
  const memoryStats = !useDatabase ? db.fallback.getMemoryStats() : null;
  const processMemory = process.memoryUsage();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '0.2.0',
    database: useDatabase ? (dbConnected ? 'connected' : 'error') : 'in-memory',
    process: {
      heapUsedMB: Math.round(processMemory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(processMemory.heapTotal / 1024 / 1024),
      rssMB: Math.round(processMemory.rss / 1024 / 1024),
      externalMB: Math.round(processMemory.external / 1024 / 1024),
    },
    ...(memoryStats && {
      inMemoryUsage: {
        evidence: `${memoryStats.evidence.percentUsed}% (${memoryStats.evidence.count}/${memoryStats.evidence.limit})`,
        auditLog: `${memoryStats.auditLog.percentUsed}% (${memoryStats.auditLog.count}/${memoryStats.auditLog.limit})`,
        warnings: {
          evidenceLimitReached: memoryStats.evidence.limitWarned,
          auditLogLimitReached: memoryStats.auditLog.limitWarned,
        },
      },
    }),
  });
});

// ===================
// CONTROL ENDPOINTS
// ===================

app.get('/api/v1/controls', (_req, res) => {
  try {
    const controls = loadControls();
    if (!controls) {
      return res.status(404).json({ error: 'Controls catalog not found' });
    }

    const flatControls = [];

    function extractControls(obj, parentId = null) {
      if (Array.isArray(obj)) {
        obj.forEach(item => extractControls(item, parentId));
      } else if (obj && typeof obj === 'object') {
        if (obj.id) {
          flatControls.push({
            id: obj.id,
            title: obj.title,
            parentId,
            regulationCitation: obj.props?.find(p => p.name === 'regulation-citation')?.value,
            regulationRef: obj.props?.find(p => p.name === 'regulation-ref')?.value,
            hasSubControls: !!obj.controls,
          });
        }
        if (obj.controls) {
          extractControls(obj.controls, obj.id);
        }
      }
    }

    controls.catalog.groups.forEach(group => {
      if (group.controls) extractControls(group.controls);
    });

    res.json({
      catalog: {
        uuid: controls.catalog.uuid,
        version: controls.catalog.metadata.version,
        lastModified: controls.catalog.metadata['last-modified'],
      },
      controls: flatControls,
      total: flatControls.length,
    });
  } catch (err) {
    console.error('Error loading controls:', err);
    res.status(500).json({ error: 'Failed to load controls' });
  }
});

app.get('/api/v1/controls/:id', (req, res) => {
  try {
    const controls = loadControls();
    if (!controls) {
      return res.status(404).json({ error: 'Controls catalog not found' });
    }

    function findControl(obj, targetId) {
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = findControl(item, targetId);
          if (found) return found;
        }
      } else if (obj && typeof obj === 'object') {
        if (obj.id === targetId) return obj;
        if (obj.controls) return findControl(obj.controls, targetId);
      }
      return null;
    }

    let control = null;
    for (const group of controls.catalog.groups) {
      if (group.controls) {
        control = findControl(group.controls, req.params.id);
        if (control) break;
      }
    }

    if (!control) {
      return res.status(404).json({ error: 'Control not found' });
    }

    res.json(control);
  } catch (err) {
    console.error('Error finding control:', err);
    res.status(500).json({ error: 'Failed to find control' });
  }
});

// ===================
// REGULATION ENDPOINTS
// ===================

app.get('/api/v1/regulations', (_req, res) => {
  try {
    const schemas = loadSchemas();

    res.json({
      regulations: schemas.map(s => ({
        id: s.content['@id'],
        citation: s.content.citation,
        title: s.content.title,
        filename: s.filename,
      })),
      total: schemas.length,
    });
  } catch (err) {
    console.error('Error loading regulations:', err);
    res.status(500).json({ error: 'Failed to load regulations' });
  }
});

app.get('/api/v1/regulations/:citation', (req, res) => {
  try {
    const schemas = loadSchemas();
    const citation = req.params.citation.replace(/-/g, '.');

    const schema = schemas.find(
      s =>
        s.content.citation === citation ||
        s.content.citation === `17 CFR ${citation}` ||
        s.content['@id'] === `cfr:17/${citation}`
    );

    if (!schema) {
      return res.status(404).json({ error: 'Regulation not found' });
    }

    res.json(schema.content);
  } catch (err) {
    console.error('Error finding regulation:', err);
    res.status(500).json({ error: 'Failed to find regulation' });
  }
});

// ===================
// EVIDENCE ENDPOINTS
// ===================

app.post(
  '/api/v1/evidence',
  authenticateToken,
  requireRole('admin', 'compliance'),
  async (req, res) => {
    try {
      const { controlId, metadata, artifactHash, artifactSize, contentType } = req.body;

      if (!controlId || !artifactHash) {
        return res.status(400).json({ error: 'controlId and artifactHash are required' });
      }

      const collectedAt = new Date().toISOString();
      const id = uuidv4();
      const preimage = `${id}${artifactHash}${JSON.stringify(metadata || {})}${collectedAt}`;
      const merkleLeafHash = createHash('sha256').update(preimage).digest('hex');

      const evidence = {
        id,
        controlId,
        artifactHash,
        artifactSize: artifactSize || 0,
        contentType: contentType || 'application/octet-stream',
        metadata: metadata || {},
        collectedAt,
        collectedBy: req.user.email || req.user.sub,
        status: 'active',
        merkleLeafHash,
      };

      if (useDatabase) {
        await db.createEvidence(evidence);
      } else {
        db.fallback.createEvidence(evidence);
      }

      await logAudit('EVIDENCE_SUBMITTED', req.user.email, {
        evidenceId: evidence.id,
        controlId,
        merkleLeafHash: evidence.merkleLeafHash,
      });

      res.status(201).json({
        id: evidence.id,
        controlId: evidence.controlId,
        merkleLeafHash: evidence.merkleLeafHash,
        createdAt: evidence.collectedAt,
      });
    } catch (err) {
      console.error('Error submitting evidence:', err);
      res.status(500).json({ error: 'Failed to submit evidence' });
    }
  }
);

app.get('/api/v1/evidence', authenticateToken, async (req, res) => {
  try {
    const { controlId, status } = req.query;
    const filters = {};
    if (controlId) filters.controlId = controlId;
    if (status) filters.status = status;

    let evidence;
    if (useDatabase) {
      evidence = await db.listEvidence(filters);
    } else {
      evidence = db.fallback.listEvidence(filters);
    }

    res.json({
      evidence,
      total: evidence.length,
    });
  } catch (err) {
    console.error('Error fetching evidence:', err);
    res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

app.get('/api/v1/evidence/:id', authenticateToken, async (req, res) => {
  try {
    let evidence;
    if (useDatabase) {
      evidence = await db.getEvidence(req.params.id);
    } else {
      evidence = db.fallback.getEvidence(req.params.id);
    }

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    res.json(evidence);
  } catch (err) {
    console.error('Error fetching evidence:', err);
    res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

app.get('/api/v1/evidence/:id/verify', authenticateToken, async (req, res) => {
  try {
    let evidence;
    if (useDatabase) {
      evidence = await db.getEvidence(req.params.id);
    } else {
      evidence = db.fallback.getEvidence(req.params.id);
    }

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    const preimage = `${evidence.id}${evidence.artifactHash}${JSON.stringify(evidence.metadata)}${evidence.collectedAt}`;
    const computedHash = createHash('sha256').update(preimage).digest('hex');

    res.json({
      evidenceId: evidence.id,
      verified: computedHash === evidence.merkleLeafHash,
      storedHash: evidence.merkleLeafHash,
      computedHash,
      match: computedHash === evidence.merkleLeafHash,
    });
  } catch (err) {
    console.error('Error verifying evidence:', err);
    res.status(500).json({ error: 'Failed to verify evidence' });
  }
});

// ===================
// COMPLIANCE STATUS ENDPOINTS
// ===================

app.get('/api/v1/compliance-status', authenticateToken, async (_req, res) => {
  try {
    const controls = loadControls();
    if (!controls) {
      return res.status(404).json({ error: 'Controls catalog not found' });
    }

    // Get evidence counts by control
    let evidenceByControl;
    if (useDatabase) {
      evidenceByControl = await db.getEvidenceByControl();
    } else {
      evidenceByControl = db.fallback.getEvidenceByControl();
    }

    const controlStatus = [];

    function processControls(obj) {
      if (Array.isArray(obj)) {
        obj.forEach(processControls);
      } else if (obj && typeof obj === 'object' && obj.id) {
        const controlData = evidenceByControl[obj.id] || { count: 0, lastEvidence: null };

        controlStatus.push({
          controlId: obj.id,
          title: obj.title,
          regulationCitation: obj.props?.find(p => p.name === 'regulation-citation')?.value,
          evidenceCount: controlData.count,
          lastEvidence: controlData.lastEvidence,
          status: controlData.count > 0 ? 'SATISFIED' : 'MISSING',
        });
        if (obj.controls) processControls(obj.controls);
      }
    }

    controls.catalog.groups.forEach(group => {
      if (group.controls) processControls(group.controls);
    });

    const totalControls = controlStatus.length;
    const satisfied = controlStatus.filter(c => c.status === 'SATISFIED').length;
    const missing = controlStatus.filter(c => c.status === 'MISSING').length;
    const compliancePercentage =
      totalControls > 0 ? Math.round((satisfied / totalControls) * 100) : 0;

    res.json({
      summary: {
        totalControls,
        satisfied,
        missing,
        compliancePercentage,
      },
      controls: controlStatus,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error computing compliance status:', err);
    res.status(500).json({ error: 'Failed to compute compliance status' });
  }
});

// ===================
// ENFORCEMENT CASE ENDPOINTS
// ===================

app.get('/api/v1/enforcement-cases', (_req, res) => {
  try {
    const cases = loadEnforcementCases();

    res.json({
      cases: cases.map(c => ({
        id: c.content.case?.id,
        name: c.content.case?.name,
        type: c.content.case?.type,
        status: c.content.case?.status,
        filename: c.filename,
      })),
      total: cases.length,
    });
  } catch (err) {
    console.error('Error loading enforcement cases:', err);
    res.status(500).json({ error: 'Failed to load enforcement cases' });
  }
});

app.get('/api/v1/enforcement-cases/:id', (req, res) => {
  try {
    const cases = loadEnforcementCases();
    const caseData = cases.find(
      c => c.content.case?.id === req.params.id || c.filename.includes(req.params.id)
    );

    if (!caseData) {
      return res.status(404).json({ error: 'Enforcement case not found' });
    }

    res.json(caseData.content);
  } catch (err) {
    console.error('Error finding enforcement case:', err);
    res.status(500).json({ error: 'Failed to find enforcement case' });
  }
});

// ===================
// AUDIT TRAIL ENDPOINTS
// ===================

app.get(
  '/api/v1/audit-trail',
  authenticateToken,
  requireRole('admin', 'auditor'),
  async (req, res) => {
    try {
      const limit = safeParseInt(req.query.limit, 100);
      const offset = safeParseInt(req.query.offset, 0);
      const { eventType } = req.query;

      const filters = { limit, offset };
      if (eventType) filters.eventType = eventType;

      let logs, total;
      if (useDatabase) {
        logs = await db.listAuditLog(filters);
        total = await db.countAuditLog({ eventType });
      } else {
        logs = db.fallback.listAuditLog(filters);
        total = db.fallback.countAuditLog({ eventType });
      }

      res.json({
        auditLog: logs,
        total,
        pagination: { limit, offset },
      });
    } catch (err) {
      console.error('Error fetching audit trail:', err);
      res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  }
);

// ===================
// AUDIT EXPORT ENDPOINT
// ===================

/**
 * Export audit package for regulators/auditors.
 * Contains: control catalog, evidence mappings (hashed only), timestamps, signatures.
 * Does NOT contain: actual evidence documents, PII, unmasked data.
 * To view actual evidence, auditors must access individual evidence endpoints.
 */
app.get(
  '/api/v1/audit-export',
  authenticateToken,
  requireRole('admin', 'auditor'),
  async (req, res) => {
    try {
      const { format = 'json' } = req.query;

      // 1. Load control catalog
      const controlCatalog = loadControls();
      const flatControls = [];
      function extractControls(obj) {
        if (Array.isArray(obj)) {
          obj.forEach(item => extractControls(item));
        } else if (obj && typeof obj === 'object') {
          if (obj.id) {
            flatControls.push({
              id: obj.id,
              title: obj.title,
              regulationCitation: obj.props?.find(p => p.name === 'regulation-citation')?.value,
              regulationRef: obj.props?.find(p => p.name === 'regulation-ref')?.value,
            });
          }
          if (obj.controls) extractControls(obj.controls);
          if (obj.groups) extractControls(obj.groups);
        }
      }
      extractControls(controlCatalog);

      // 2. Get evidence summary (hashed, no actual content)
      let evidenceList, evidenceByControl;
      if (useDatabase) {
        evidenceList = await db.listEvidence({ status: 'active' });
        evidenceByControl = await db.getEvidenceByControl();
      } else {
        evidenceList = db.fallback.listEvidence({ status: 'active' });
        evidenceByControl = db.fallback.getEvidenceByControl();
      }

      // 3. Build evidence manifest (hashes only, no document content)
      const evidenceManifest = evidenceList.map(e => ({
        id: e.id,
        controlId: e.controlId,
        artifactHash: e.artifactHash,
        merkleLeafHash: e.merkleLeafHash,
        contentType: e.contentType,
        artifactSize: e.artifactSize,
        collectedAt: e.collectedAt,
        status: e.status,
        // Note: collectedBy, metadata, s3Key intentionally omitted to protect PII
      }));

      // 4. Build control-evidence mapping
      const controlMappings = flatControls.map(ctrl => ({
        controlId: ctrl.id,
        controlTitle: ctrl.title,
        regulationCitation: ctrl.regulationCitation,
        evidenceCount: evidenceByControl[ctrl.id]?.count || 0,
        lastEvidenceAt: evidenceByControl[ctrl.id]?.lastEvidence || null,
        status: evidenceByControl[ctrl.id]?.count > 0 ? 'satisfied' : 'missing',
      }));

      // 5. Compute catalog hash for integrity verification
      const catalogHash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(flatControls))
        .digest('hex');

      // 6. Compute evidence manifest hash
      const manifestHash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(evidenceManifest))
        .digest('hex');

      // 7. Build export package
      const exportPackage = {
        exportMetadata: {
          generatedAt: new Date().toISOString(),
          generatedBy: req.user.email,
          format: format,
          version: '1.0.0',
        },
        integrity: {
          catalogHash,
          manifestHash,
          combinedHash: require('crypto')
            .createHash('sha256')
            .update(catalogHash + manifestHash)
            .digest('hex'),
          // Note: For production, sign with HSM-backed key
          signatureAlgorithm: 'SHA256',
          signatureNote:
            'Production deployment should use RFC 3161 TSA for legally admissible timestamps',
        },
        summary: {
          totalControls: flatControls.length,
          satisfiedControls: controlMappings.filter(c => c.status === 'satisfied').length,
          missingControls: controlMappings.filter(c => c.status === 'missing').length,
          totalEvidence: evidenceManifest.length,
          compliancePercentage: Math.round(
            (controlMappings.filter(c => c.status === 'satisfied').length / flatControls.length) *
              100
          ),
        },
        controlCatalog: flatControls,
        controlMappings,
        evidenceManifest,
        accessInstructions: {
          note: 'This export contains hashed evidence references only. To access actual evidence documents:',
          endpoint: '/api/v1/evidence/{id}',
          authentication: 'Bearer token with admin or auditor role required',
          verification: 'Compare artifact hash against stored document SHA-256',
        },
      };

      await logAudit('AUDIT_EXPORT_GENERATED', req.user.email, {
        format,
        controlCount: flatControls.length,
        evidenceCount: evidenceManifest.length,
        catalogHash,
        manifestHash,
      });

      if (format === 'csv') {
        // CSV export of control mappings only
        const csv = [
          'Control ID,Control Title,Regulation Citation,Evidence Count,Last Evidence,Status',
          ...controlMappings.map(
            c =>
              `"${c.controlId}","${c.controlTitle}","${c.regulationCitation || ''}",${c.evidenceCount},"${c.lastEvidenceAt || ''}","${c.status}"`
          ),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="audit-export-${Date.now()}.csv"`
        );
        return res.send(csv);
      }

      res.json(exportPackage);
    } catch (err) {
      console.error('Error generating audit export:', err);
      res.status(500).json({ error: 'Failed to generate audit export' });
    }
  }
);

// ===================
// GAP DETECTION ENDPOINTS
// ===================

// Lazy load gap detection to avoid circular dependencies
let gapDetector = null;
async function getGapDetector() {
  if (!gapDetector) {
    const module = await import('../services/gap-detection.js');
    gapDetector = module.gapDetector;
  }
  return gapDetector;
}

/**
 * Get current evidence gaps.
 * Returns controls missing evidence, stale evidence, or insufficient coverage.
 */
app.get(
  '/api/v1/gaps',
  authenticateToken,
  requireRole('admin', 'compliance', 'auditor'),
  async (req, res) => {
    try {
      const detector = await getGapDetector();
      const controls = loadControls();

      // Flatten controls
      const flatControls = [];
      function extractControls(obj) {
        if (Array.isArray(obj)) {
          obj.forEach(item => extractControls(item));
        } else if (obj && typeof obj === 'object') {
          if (obj.id) {
            flatControls.push({ id: obj.id, title: obj.title });
          }
          if (obj.controls) extractControls(obj.controls);
          if (obj.groups) extractControls(obj.groups);
        }
      }
      extractControls(controls);

      // Get evidence by control
      let evidenceByControl;
      if (useDatabase) {
        evidenceByControl = await db.getEvidenceByControl();
      } else {
        evidenceByControl = db.fallback.getEvidenceByControl();
      }

      // Run gap detection
      const gaps = detector.detect(flatControls, evidenceByControl);

      await logAudit('GAP_DETECTION_RUN', req.user.email, {
        totalControls: flatControls.length,
        gapsFound: gaps.length,
      });

      res.json({
        summary: detector.getSummary(),
        config: {
          staleDays: detector.config.staleDays,
          criticalDays: detector.config.criticalDays,
          criticalControls: detector.config.criticalControls,
        },
      });
    } catch (err) {
      console.error('Error detecting gaps:', err);
      res.status(500).json({ error: 'Failed to detect evidence gaps' });
    }
  }
);

/**
 * Run gap detection and send alerts.
 * POST because it has side effects (sending notifications).
 */
app.post(
  '/api/v1/gaps/scan',
  authenticateToken,
  requireRole('admin', 'compliance'),
  async (req, res) => {
    try {
      const detector = await getGapDetector();
      const controls = loadControls();

      // Flatten controls
      const flatControls = [];
      function extractControls(obj) {
        if (Array.isArray(obj)) {
          obj.forEach(item => extractControls(item));
        } else if (obj && typeof obj === 'object') {
          if (obj.id) {
            flatControls.push({ id: obj.id, title: obj.title });
          }
          if (obj.controls) extractControls(obj.controls);
          if (obj.groups) extractControls(obj.groups);
        }
      }
      extractControls(controls);

      // Get evidence by control
      let evidenceByControl;
      if (useDatabase) {
        evidenceByControl = await db.getEvidenceByControl();
      } else {
        evidenceByControl = db.fallback.getEvidenceByControl();
      }

      // Run gap detection with alerts
      const { gaps, alertsSent } = await detector.detectAndAlert(flatControls, evidenceByControl);

      await logAudit('GAP_SCAN_WITH_ALERTS', req.user.email, {
        gapsFound: gaps.length,
        alertsSent,
      });

      res.json({
        success: true,
        gapsFound: gaps.length,
        alertsSent,
        summary: detector.getSummary(),
      });
    } catch (err) {
      console.error('Error scanning gaps:', err);
      res.status(500).json({ error: 'Failed to scan for evidence gaps' });
    }
  }
);

/**
 * Configure gap detection thresholds.
 */
app.put('/api/v1/gaps/config', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const detector = await getGapDetector();
    const { staleDays, criticalDays, criticalControls, minimumEvidence } = req.body;

    if (staleDays !== undefined) {
      detector.config.staleDays = parseInt(staleDays, 10);
    }
    if (criticalDays !== undefined) {
      detector.config.criticalDays = parseInt(criticalDays, 10);
    }
    if (criticalControls !== undefined) {
      detector.config.criticalControls = criticalControls;
    }
    if (minimumEvidence !== undefined) {
      detector.config.minimumEvidence = { ...detector.config.minimumEvidence, ...minimumEvidence };
    }

    await logAudit('GAP_CONFIG_UPDATED', req.user.email, {
      staleDays: detector.config.staleDays,
      criticalDays: detector.config.criticalDays,
      criticalControlsCount: detector.config.criticalControls.length,
    });

    res.json({
      success: true,
      config: {
        staleDays: detector.config.staleDays,
        criticalDays: detector.config.criticalDays,
        criticalControls: detector.config.criticalControls,
        minimumEvidence: detector.config.minimumEvidence,
      },
    });
  } catch (err) {
    console.error('Error updating gap config:', err);
    res.status(500).json({ error: 'Failed to update gap detection configuration' });
  }
});

// ===================
// COLLECTOR ENDPOINTS
// ===================

// Lazy load collector manager
let collectorManager = null;
async function getCollectorManager() {
  if (!collectorManager) {
    const module = await import('../services/evidence-collector.js');
    collectorManager = module.collectorManager;

    // Set up evidence submission function
    collectorManager.setSubmitFunction(async evidence => {
      if (useDatabase) {
        await db.createEvidence(evidence);
      } else {
        db.fallback.createEvidence(evidence);
      }
      await logAudit('EVIDENCE_COLLECTED', evidence.collectedBy, {
        controlId: evidence.controlId,
        artifactHash: evidence.artifactHash,
      });
    });
  }
  return collectorManager;
}

/**
 * List registered collectors.
 */
app.get('/api/v1/collectors', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const manager = await getCollectorManager();
    const collectors = manager.list().map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      schedule: c.schedule,
      controlIds: c.controlIds,
      enabled: c.enabled,
    }));

    res.json({ collectors, total: collectors.length });
  } catch (err) {
    console.error('Error listing collectors:', err);
    res.status(500).json({ error: 'Failed to list collectors' });
  }
});

/**
 * Test all collector connections.
 */
app.get('/api/v1/collectors/test', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const manager = await getCollectorManager();
    const results = await manager.testAll();

    await logAudit('COLLECTORS_TESTED', req.user.email, {
      totalTested: Object.keys(results).length,
      successful: Object.values(results).filter(r => r.success).length,
    });

    res.json({ results });
  } catch (err) {
    console.error('Error testing collectors:', err);
    res.status(500).json({ error: 'Failed to test collectors' });
  }
});

/**
 * Run all enabled collectors.
 */
app.post('/api/v1/collectors/run', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const manager = await getCollectorManager();
    const results = await manager.runAll();

    const totalCollected = Object.values(results).reduce((sum, r) => sum + r.collected, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors.length, 0);

    await logAudit('COLLECTORS_RUN', req.user.email, {
      collectorsRun: Object.keys(results).length,
      totalCollected,
      totalErrors,
    });

    res.json({
      success: totalErrors === 0,
      results,
      summary: {
        collectorsRun: Object.keys(results).length,
        totalCollected,
        totalErrors,
      },
    });
  } catch (err) {
    console.error('Error running collectors:', err);
    res.status(500).json({ error: 'Failed to run collectors' });
  }
});

/**
 * Run a specific collector.
 */
app.post(
  '/api/v1/collectors/:id/run',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const manager = await getCollectorManager();
      const result = await manager.runCollector(req.params.id);

      await logAudit('COLLECTOR_RUN', req.user.email, {
        collectorId: req.params.id,
        collected: result.collected,
        errors: result.errors.length,
      });

      res.json(result);
    } catch (err) {
      console.error('Error running collector:', err);
      res.status(500).json({ error: 'Failed to run collector' });
    }
  }
);

// ===================
// TOKEN ENDPOINTS (for demo)
// ===================

app.post('/api/v1/auth/token', async (req, res) => {
  try {
    const { email, role = 'viewer' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const validRoles = ['admin', 'compliance', 'viewer', 'auditor'];
    if (!validRoles.includes(role)) {
      return res
        .status(400)
        .json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const token = jwt.sign({ email, role, sub: email }, config.jwtSecret, {
      expiresIn: role === 'auditor' ? '72h' : '24h',
    });

    await logAudit('TOKEN_ISSUED', 'system', { email, role });

    res.json({
      token,
      expiresIn: role === 'auditor' ? '72h' : '24h',
      role,
    });
  } catch (err) {
    console.error('Error issuing token:', err);
    res.status(500).json({ error: 'Failed to issue token' });
  }
});

// Error handling
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Only start server if this file is run directly, not when imported
let server = null;

if (
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].includes('api/server'))
) {
  server = app.listen(config.port, async () => {
    console.log(`\n========================================`);
    console.log(`Compliance API Server`);
    console.log(`========================================`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Port: ${config.port}`);
    console.log(`Database: ${useDatabase ? 'PostgreSQL' : 'In-Memory'}`);
    if (useDatabase) {
      const connected = await db.testConnection();
      console.log(`DB Status: ${connected ? 'Connected' : 'Connection Failed'}`);
    }
    console.log(`CORS: ${config.corsOrigins.join(', ')}`);
    console.log(`Health: http://localhost:${config.port}/api/v1/health`);
    console.log(`========================================\n`);
  });
}

export default app;
export { server };
