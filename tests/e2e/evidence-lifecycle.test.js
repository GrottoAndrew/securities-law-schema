/**
 * End-to-End Tests: Evidence Lifecycle
 *
 * Tests complete user workflows from authentication through
 * evidence submission, verification, and audit trail integrity.
 * Unlike integration tests that test individual endpoints,
 * e2e tests verify multi-step business processes end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../src/api/server.js';

const API_BASE = 'http://localhost:3003';
let server;

beforeAll(async () => {
  await new Promise(resolve => {
    server = app.listen(3003, resolve);
  });
});

afterAll(async () => {
  await new Promise(resolve => {
    if (server) {
      server.close(resolve);
    } else {
      resolve();
    }
  });
});

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json();
  return { response, data };
}

async function getToken(email, role) {
  const { data } = await fetchJson('/api/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return data.token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// =============================================================================
// E2E Workflow 1: Full Evidence Submission Lifecycle
// =============================================================================
describe('Evidence Submission Lifecycle', () => {
  let complianceToken;
  let auditorToken;
  let submittedEvidenceId;
  let submittedMerkleHash;
  let controlId;

  it('step 1: authenticate as compliance officer', async () => {
    complianceToken = await getToken('compliance-officer@irongrotto.com', 'compliance');
    expect(complianceToken).toBeDefined();
    expect(typeof complianceToken).toBe('string');
    expect(complianceToken.split('.').length).toBe(3); // valid JWT structure
  });

  it('step 2: retrieve a control to submit evidence against', async () => {
    const { response, data } = await fetchJson('/api/v1/controls');
    expect(response.status).toBe(200);
    expect(data.controls.length).toBeGreaterThan(0);
    controlId = data.controls[0].id;
    expect(controlId).toBeDefined();
  });

  it('step 3: submit evidence for the control', async () => {
    const { response, data } = await fetchJson('/api/v1/evidence', {
      method: 'POST',
      headers: authHeader(complianceToken),
      body: JSON.stringify({
        controlId,
        artifactHash: 'sha256:e2e-test-lifecycle-artifact-001',
        metadata: {
          filename: 'investor-accreditation-proof.pdf',
          size: 245760,
          source: 'e2e-test',
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.controlId).toBe(controlId);
    expect(data.merkleLeafHash).toBeDefined();
    expect(data.merkleLeafHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex

    submittedEvidenceId = data.id;
    submittedMerkleHash = data.merkleLeafHash;
  });

  it('step 4: verify the evidence hash chain is intact', async () => {
    const { response, data } = await fetchJson(`/api/v1/evidence/${submittedEvidenceId}/verify`, {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.verified).toBe(true);
    expect(data.match).toBe(true);
    expect(data.storedHash).toBe(submittedMerkleHash);
    expect(data.computedHash).toBe(submittedMerkleHash);
  });

  it('step 5: retrieve the evidence and confirm all fields persisted', async () => {
    const { response, data } = await fetchJson(`/api/v1/evidence/${submittedEvidenceId}`, {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.id).toBe(submittedEvidenceId);
    expect(data.controlId).toBe(controlId);
    expect(data.artifactHash).toBe('sha256:e2e-test-lifecycle-artifact-001');
    expect(data.metadata.filename).toBe('investor-accreditation-proof.pdf');
    expect(data.merkleLeafHash).toBe(submittedMerkleHash);
    expect(data.collectedBy).toBe('compliance-officer@irongrotto.com');
  });

  it('step 6: confirm compliance status reflects the new evidence', async () => {
    const { response, data } = await fetchJson('/api/v1/compliance-status', {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.summary.totalControls).toBeGreaterThan(0);

    // The control we submitted evidence for should be SATISFIED
    const controlStatus = data.controls.find(c => c.controlId === controlId);
    expect(controlStatus).toBeDefined();
    expect(controlStatus.status).toBe('SATISFIED');
    expect(controlStatus.evidenceCount).toBeGreaterThanOrEqual(1);
  });

  it('step 7: auditor retrieves audit trail and sees the submission event', async () => {
    auditorToken = await getToken('auditor@irongrotto.com', 'auditor');

    const { response, data } = await fetchJson('/api/v1/audit-trail?limit=50', {
      headers: authHeader(auditorToken),
    });

    expect(response.status).toBe(200);
    expect(data.auditLog.length).toBeGreaterThan(0);

    // Find the evidence submission audit entry
    // In-memory store uses 'event' field; DB uses 'event_type' mapped to 'event'
    const submissionLog = data.auditLog.find(
      entry =>
        (entry.event === 'EVIDENCE_SUBMITTED' || entry.eventType === 'EVIDENCE_SUBMITTED') &&
        entry.details?.evidenceId === submittedEvidenceId
    );
    expect(submissionLog).toBeDefined();
    expect(submissionLog.details.controlId).toBe(controlId);
    expect(submissionLog.details.merkleLeafHash).toBe(submittedMerkleHash);
  });
});

// =============================================================================
// E2E Workflow 2: Multi-Evidence Compliance Coverage
// =============================================================================
describe('Multi-Evidence Compliance Coverage', () => {
  let complianceToken;
  let controls;

  it('step 1: authenticate and load full control catalog', async () => {
    complianceToken = await getToken('compliance-lead@irongrotto.com', 'compliance');

    const { data } = await fetchJson('/api/v1/controls');
    controls = data.controls;
    expect(controls.length).toBeGreaterThan(0);
  });

  it('step 2: submit evidence for multiple controls', async () => {
    // Submit evidence for up to 3 controls
    const targetControls = controls.slice(0, 3);

    for (const control of targetControls) {
      const { response, data } = await fetchJson('/api/v1/evidence', {
        method: 'POST',
        headers: authHeader(complianceToken),
        body: JSON.stringify({
          controlId: control.id,
          artifactHash: `sha256:multi-evidence-${control.id}-${Date.now()}`,
          metadata: {
            filename: `evidence-for-${control.id}.pdf`,
            source: 'e2e-multi-test',
          },
        }),
      });

      expect(response.status).toBe(201);
      expect(data.controlId).toBe(control.id);
    }
  });

  it('step 3: verify compliance percentage increased', async () => {
    const { response, data } = await fetchJson('/api/v1/compliance-status', {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.summary.satisfied).toBeGreaterThanOrEqual(3);
    expect(data.summary.compliancePercentage).toBeGreaterThan(0);
  });

  it('step 4: filter evidence by control ID', async () => {
    const targetControlId = controls[0].id;

    const { response, data } = await fetchJson(`/api/v1/evidence?controlId=${targetControlId}`, {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.evidence.length).toBeGreaterThanOrEqual(1);
    data.evidence.forEach(e => {
      expect(e.controlId).toBe(targetControlId);
    });
  });
});

// =============================================================================
// E2E Workflow 3: Audit Export Integrity
// =============================================================================
describe('Audit Export Integrity', () => {
  let auditorToken;

  it('step 1: authenticate as auditor', async () => {
    auditorToken = await getToken('sec-auditor@irongrotto.com', 'auditor');
    expect(auditorToken).toBeDefined();
  });

  it('step 2: generate JSON audit export and verify integrity hashes', async () => {
    const { response, data } = await fetchJson('/api/v1/audit-export', {
      headers: authHeader(auditorToken),
    });

    expect(response.status).toBe(200);

    // Verify export structure
    expect(data.exportMetadata).toBeDefined();
    expect(data.exportMetadata.generatedAt).toBeDefined();
    expect(data.exportMetadata.generatedBy).toBe('sec-auditor@irongrotto.com');

    // Verify integrity hashes exist and are SHA-256
    expect(data.integrity.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.integrity.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.integrity.combinedHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify summary numbers are consistent
    expect(data.summary.totalControls).toBe(data.controlCatalog.length);
    expect(data.summary.satisfiedControls + data.summary.missingControls).toBe(
      data.summary.totalControls
    );

    // Verify evidence manifest contains only hashes, no PII
    if (data.evidenceManifest.length > 0) {
      const sample = data.evidenceManifest[0];
      expect(sample.artifactHash).toBeDefined();
      expect(sample.merkleLeafHash).toBeDefined();
      // PII fields should NOT be in the export
      expect(sample.collectedBy).toBeUndefined();
      expect(sample.metadata).toBeUndefined();
      expect(sample.s3Key).toBeUndefined();
    }
  });

  it('step 3: generate CSV audit export', async () => {
    const response = await fetch(`${API_BASE}/api/v1/audit-export?format=csv`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(auditorToken),
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');

    const csv = await response.text();
    // Filter out empty lines from trailing newlines
    const lines = csv.split('\n').filter(line => line.trim().length > 0);
    // Header + at least one data row
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('Control ID');
    expect(lines[0]).toContain('Evidence Count');
    expect(lines[0]).toContain('Status');
  });

  it('step 4: audit export generation appears in audit trail', async () => {
    const { data } = await fetchJson('/api/v1/audit-trail?limit=50', {
      headers: authHeader(auditorToken),
    });

    const exportEntries = data.auditLog.filter(
      entry =>
        entry.event === 'AUDIT_EXPORT_GENERATED' || entry.eventType === 'AUDIT_EXPORT_GENERATED'
    );
    expect(exportEntries.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// E2E Workflow 4: Role-Based Access Control
// =============================================================================
describe('Role-Based Access Control Enforcement', () => {
  let viewerToken;
  let complianceToken;
  let adminToken;
  let auditorToken;

  it('step 1: acquire tokens for all four roles', async () => {
    viewerToken = await getToken('viewer@irongrotto.com', 'viewer');
    complianceToken = await getToken('compliance@irongrotto.com', 'compliance');
    adminToken = await getToken('admin@irongrotto.com', 'admin');
    auditorToken = await getToken('auditor@irongrotto.com', 'auditor');

    expect(viewerToken).toBeDefined();
    expect(complianceToken).toBeDefined();
    expect(adminToken).toBeDefined();
    expect(auditorToken).toBeDefined();
  });

  it('step 2: viewer cannot submit evidence', async () => {
    const { response } = await fetchJson('/api/v1/evidence', {
      method: 'POST',
      headers: authHeader(viewerToken),
      body: JSON.stringify({
        controlId: 'test',
        artifactHash: 'sha256:unauthorized',
      }),
    });

    expect(response.status).toBe(403);
  });

  it('step 3: viewer cannot access audit trail', async () => {
    const { response } = await fetchJson('/api/v1/audit-trail', {
      headers: authHeader(viewerToken),
    });

    expect(response.status).toBe(403);
  });

  it('step 4: compliance officer cannot access audit trail', async () => {
    const { response } = await fetchJson('/api/v1/audit-trail', {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(403);
  });

  it('step 5: auditor can access audit trail', async () => {
    const { response } = await fetchJson('/api/v1/audit-trail', {
      headers: authHeader(auditorToken),
    });

    expect(response.status).toBe(200);
  });

  it('step 6: admin can access audit trail', async () => {
    const { response } = await fetchJson('/api/v1/audit-trail', {
      headers: authHeader(adminToken),
    });

    expect(response.status).toBe(200);
  });

  it('step 7: unauthenticated requests are rejected for protected endpoints', async () => {
    const protectedPaths = [
      '/api/v1/evidence',
      '/api/v1/compliance-status',
      '/api/v1/audit-trail',
      '/api/v1/audit-export',
      '/api/v1/gaps',
    ];

    for (const path of protectedPaths) {
      const { response } = await fetchJson(path);
      expect(response.status).toBe(401);
    }
  });

  it('step 8: viewer cannot access audit export', async () => {
    const { response } = await fetchJson('/api/v1/audit-export', {
      headers: authHeader(viewerToken),
    });

    expect(response.status).toBe(403);
  });

  it('step 9: auditor can access audit export', async () => {
    const { response } = await fetchJson('/api/v1/audit-export', {
      headers: authHeader(auditorToken),
    });

    expect(response.status).toBe(200);
  });
});

// =============================================================================
// E2E Workflow 5: Evidence Hash Integrity Under Multiple Submissions
// =============================================================================
describe('Merkle Hash Chain Integrity', () => {
  let token;
  const evidenceIds = [];
  const merkleHashes = [];

  it('step 1: submit multiple evidence items and collect hashes', async () => {
    token = await getToken('integrity-tester@irongrotto.com', 'compliance');
    const { data: controlsData } = await fetchJson('/api/v1/controls');
    const controlId = controlsData.controls[0].id;

    for (let i = 0; i < 5; i++) {
      const { response, data } = await fetchJson('/api/v1/evidence', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({
          controlId,
          artifactHash: `sha256:integrity-test-${i}-${Date.now()}`,
          metadata: { sequence: i, test: 'merkle-integrity' },
        }),
      });

      expect(response.status).toBe(201);
      evidenceIds.push(data.id);
      merkleHashes.push(data.merkleLeafHash);
    }

    expect(evidenceIds.length).toBe(5);
  });

  it('step 2: all merkle hashes are unique', () => {
    const uniqueHashes = new Set(merkleHashes);
    expect(uniqueHashes.size).toBe(5);
  });

  it('step 3: each evidence item independently verifies', async () => {
    for (let i = 0; i < evidenceIds.length; i++) {
      const { response, data } = await fetchJson(`/api/v1/evidence/${evidenceIds[i]}/verify`, {
        headers: authHeader(token),
      });

      expect(response.status).toBe(200);
      expect(data.verified).toBe(true);
      expect(data.match).toBe(true);
      expect(data.storedHash).toBe(merkleHashes[i]);
    }
  });
});

// =============================================================================
// E2E Workflow 6: Gap Detection
// =============================================================================
describe('Gap Detection Workflow', () => {
  let complianceToken;

  it('step 1: authenticate and run gap detection', async () => {
    complianceToken = await getToken('gap-tester@irongrotto.com', 'compliance');

    const { response, data } = await fetchJson('/api/v1/gaps', {
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.summary).toBeDefined();
    expect(data.config).toBeDefined();
    expect(data.config.staleDays).toBeDefined();
  });

  it('step 2: run gap scan with alerts', async () => {
    const { response, data } = await fetchJson('/api/v1/gaps/scan', {
      method: 'POST',
      headers: authHeader(complianceToken),
    });

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.gapsFound).toBe('number');
    expect(typeof data.alertsSent).toBe('number');
  });
});
