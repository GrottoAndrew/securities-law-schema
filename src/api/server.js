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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');

// Configuration with strict validation
const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  nodeEnv: process.env.NODE_ENV || 'development'
};

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"]
    }
  }
}));

app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
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

// In-memory evidence store (replace with PostgreSQL in production)
const evidenceStore = new Map();
const auditLog = [];

function logAudit(event, actor, details) {
  const entry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    event,
    actor,
    details,
    previousHash: auditLog.length > 0 ? auditLog[auditLog.length - 1].hash : '0'.repeat(64)
  };

  const preimage = `${entry.id}${entry.timestamp}${entry.event}${JSON.stringify(entry.details)}${entry.previousHash}`;
  entry.hash = createHash('sha256').update(preimage).digest('hex');

  auditLog.push(entry);
  return entry;
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
    return res.status(403).json({ error: 'Token verification failed', code: 'TOKEN_VERIFICATION_FAILED' });
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

app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '0.2.0'
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
            hasSubControls: !!obj.controls
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
        lastModified: controls.catalog.metadata['last-modified']
      },
      controls: flatControls,
      total: flatControls.length
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
        filename: s.filename
      })),
      total: schemas.length
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

    const schema = schemas.find(s =>
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

app.post('/api/v1/evidence', authenticateToken, requireRole('admin', 'compliance'), (req, res) => {
  try {
    const { controlId, metadata, artifactHash, artifactSize, contentType } = req.body;

    if (!controlId || !artifactHash) {
      return res.status(400).json({ error: 'controlId and artifactHash are required' });
    }

    const evidence = {
      id: uuidv4(),
      controlId,
      artifactHash,
      artifactSize: artifactSize || 0,
      contentType: contentType || 'application/octet-stream',
      metadata: metadata || {},
      collectedAt: new Date().toISOString(),
      collectedBy: req.user.email || req.user.sub,
      status: 'active'
    };

    const preimage = `${evidence.id}${evidence.artifactHash}${JSON.stringify(evidence.metadata)}${evidence.collectedAt}`;
    evidence.merkleLeafHash = createHash('sha256').update(preimage).digest('hex');

    evidenceStore.set(evidence.id, evidence);

    logAudit('EVIDENCE_SUBMITTED', req.user.email, {
      evidenceId: evidence.id,
      controlId,
      merkleLeafHash: evidence.merkleLeafHash
    });

    res.status(201).json({
      id: evidence.id,
      controlId: evidence.controlId,
      merkleLeafHash: evidence.merkleLeafHash,
      createdAt: evidence.collectedAt
    });
  } catch (err) {
    console.error('Error submitting evidence:', err);
    res.status(500).json({ error: 'Failed to submit evidence' });
  }
});

app.get('/api/v1/evidence', authenticateToken, (req, res) => {
  try {
    const { controlId, status } = req.query;
    let evidence = Array.from(evidenceStore.values());

    if (controlId) {
      evidence = evidence.filter(e => e.controlId === controlId);
    }
    if (status) {
      evidence = evidence.filter(e => e.status === status);
    }

    res.json({
      evidence,
      total: evidence.length
    });
  } catch (err) {
    console.error('Error fetching evidence:', err);
    res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

app.get('/api/v1/evidence/:id', authenticateToken, (req, res) => {
  const evidence = evidenceStore.get(req.params.id);

  if (!evidence) {
    return res.status(404).json({ error: 'Evidence not found' });
  }

  res.json(evidence);
});

app.get('/api/v1/evidence/:id/verify', authenticateToken, (req, res) => {
  const evidence = evidenceStore.get(req.params.id);

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
    match: computedHash === evidence.merkleLeafHash
  });
});

// ===================
// COMPLIANCE STATUS ENDPOINTS
// ===================

app.get('/api/v1/compliance-status', authenticateToken, (_req, res) => {
  try {
    const controls = loadControls();
    if (!controls) {
      return res.status(404).json({ error: 'Controls catalog not found' });
    }

    const evidence = Array.from(evidenceStore.values()).filter(e => e.status === 'active');
    const controlStatus = [];

    function processControls(obj) {
      if (Array.isArray(obj)) {
        obj.forEach(processControls);
      } else if (obj && typeof obj === 'object' && obj.id) {
        const controlEvidence = evidence.filter(e => e.controlId === obj.id);

        let lastEvidenceDate = null;
        if (controlEvidence.length > 0) {
          const sorted = controlEvidence
            .filter(e => e.collectedAt)
            .sort((a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime());
          lastEvidenceDate = sorted.length > 0 ? sorted[0].collectedAt : null;
        }

        controlStatus.push({
          controlId: obj.id,
          title: obj.title,
          regulationCitation: obj.props?.find(p => p.name === 'regulation-citation')?.value,
          evidenceCount: controlEvidence.length,
          lastEvidence: lastEvidenceDate,
          status: controlEvidence.length > 0 ? 'SATISFIED' : 'MISSING'
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
    const compliancePercentage = totalControls > 0 ? Math.round((satisfied / totalControls) * 100) : 0;

    res.json({
      summary: {
        totalControls,
        satisfied,
        missing,
        compliancePercentage
      },
      controls: controlStatus,
      lastUpdated: new Date().toISOString()
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
        filename: c.filename
      })),
      total: cases.length
    });
  } catch (err) {
    console.error('Error loading enforcement cases:', err);
    res.status(500).json({ error: 'Failed to load enforcement cases' });
  }
});

app.get('/api/v1/enforcement-cases/:id', (req, res) => {
  try {
    const cases = loadEnforcementCases();
    const caseData = cases.find(c =>
      c.content.case?.id === req.params.id ||
      c.filename.includes(req.params.id)
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

app.get('/api/v1/audit-trail', authenticateToken, requireRole('admin', 'auditor'), (req, res) => {
  const limit = safeParseInt(req.query.limit, 100);
  const offset = safeParseInt(req.query.offset, 0);
  const { eventType } = req.query;

  let logs = [...auditLog];

  if (eventType) {
    logs = logs.filter(l => l.event === eventType);
  }

  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({
    auditLog: logs.slice(offset, offset + limit),
    total: logs.length,
    pagination: { limit, offset }
  });
});

// ===================
// TOKEN ENDPOINTS (for demo)
// ===================

app.post('/api/v1/auth/token', (req, res) => {
  const { email, role = 'viewer' } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const validRoles = ['admin', 'compliance', 'viewer', 'auditor'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  const token = jwt.sign(
    { email, role, sub: email },
    config.jwtSecret,
    { expiresIn: role === 'auditor' ? '72h' : '24h' }
  );

  logAudit('TOKEN_ISSUED', 'system', { email, role });

  res.json({
    token,
    expiresIn: role === 'auditor' ? '72h' : '24h',
    role
  });
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

// Start server
const server = app.listen(config.port, () => {
  console.log(`\n========================================`);
  console.log(`Compliance API Server`);
  console.log(`========================================`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Port: ${config.port}`);
  console.log(`CORS: ${config.corsOrigins.join(', ')}`);
  console.log(`Health: http://localhost:${config.port}/api/v1/health`);
  console.log(`========================================\n`);
});

export default app;
export { server };
