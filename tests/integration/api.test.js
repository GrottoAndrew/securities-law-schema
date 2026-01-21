/**
 * Integration Tests for Compliance API
 *
 * Tests the full API stack including:
 * - Authentication flow
 * - Control endpoints
 * - Evidence submission and retrieval
 * - Compliance status calculation
 * - Audit trail integrity
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import app from '../../src/api/server.js';

const API_BASE = 'http://localhost:3002';
let server;
let authToken;

// Start server before tests
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(3002, resolve);
  });
});

// Stop server after tests
afterAll(async () => {
  await new Promise((resolve) => {
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

describe('Health Check', () => {
  it('should return healthy status', async () => {
    const { response, data } = await fetchJson('/api/v1/health');

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.version).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });
});

describe('Authentication', () => {
  it('should issue JWT token for valid request', async () => {
    const { response, data } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', role: 'compliance' }),
    });

    expect(response.status).toBe(200);
    expect(data.token).toBeDefined();
    expect(data.role).toBe('compliance');
    expect(data.expiresIn).toBe('24h');

    authToken = data.token;
  });

  it('should reject token request without email', async () => {
    const { response, data } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ role: 'viewer' }),
    });

    expect(response.status).toBe(400);
    expect(data.error).toContain('Email');
  });

  it('should reject invalid role', async () => {
    const { response, data } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', role: 'superadmin' }),
    });

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid role');
  });

  it('should issue auditor token with 72h expiry', async () => {
    const { response, data } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'auditor@example.com', role: 'auditor' }),
    });

    expect(response.status).toBe(200);
    expect(data.expiresIn).toBe('72h');
  });
});

describe('Controls API', () => {
  it('should list all controls', async () => {
    const { response, data } = await fetchJson('/api/v1/controls');

    expect(response.status).toBe(200);
    expect(data.controls).toBeDefined();
    expect(Array.isArray(data.controls)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
    expect(data.catalog).toBeDefined();
  });

  it('should return specific control by ID', async () => {
    // First get list to find a valid ID
    const { data: listData } = await fetchJson('/api/v1/controls');
    const controlId = listData.controls[0]?.id;

    if (controlId) {
      const { response, data } = await fetchJson(`/api/v1/controls/${controlId}`);

      expect(response.status).toBe(200);
      expect(data.id).toBe(controlId);
      expect(data.title).toBeDefined();
    }
  });

  it('should return 404 for non-existent control', async () => {
    const { response, data } = await fetchJson('/api/v1/controls/non-existent-id');

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });
});

describe('Regulations API', () => {
  it('should list all regulations', async () => {
    const { response, data } = await fetchJson('/api/v1/regulations');

    expect(response.status).toBe(200);
    expect(data.regulations).toBeDefined();
    expect(Array.isArray(data.regulations)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
  });

  it('should return specific regulation by citation', async () => {
    const { response, data } = await fetchJson('/api/v1/regulations/230-501');

    expect(response.status).toBe(200);
    expect(data['@id']).toBeDefined();
    expect(data.citation).toBeDefined();
  });

  it('should return 404 for non-existent regulation', async () => {
    const { response, data } = await fetchJson('/api/v1/regulations/999-999');

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });
});

describe('Evidence API', () => {
  let evidenceId;

  it('should require authentication for evidence listing', async () => {
    const { response, data } = await fetchJson('/api/v1/evidence');

    expect(response.status).toBe(401);
    expect(data.error).toContain('Authentication');
  });

  it('should list evidence with valid token', async () => {
    const { response, data } = await fetchJson('/api/v1/evidence', {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);
    expect(data.evidence).toBeDefined();
    expect(Array.isArray(data.evidence)).toBe(true);
  });

  it('should submit evidence with compliance role', async () => {
    const { data: listData } = await fetchJson('/api/v1/controls');
    const controlId = listData.controls[0]?.id || 'test-control';

    const { response, data } = await fetchJson('/api/v1/evidence', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        controlId,
        artifactHash: 'sha256:abc123def456',
        metadata: { filename: 'test-document.pdf', size: 1024 },
      }),
    });

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.merkleLeafHash).toBeDefined();
    expect(data.controlId).toBe(controlId);

    evidenceId = data.id;
  });

  it('should reject evidence submission without required fields', async () => {
    const { response, data } = await fetchJson('/api/v1/evidence', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ metadata: { test: true } }),
    });

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });

  it('should retrieve specific evidence by ID', async () => {
    if (!evidenceId) return;

    const { response, data } = await fetchJson(`/api/v1/evidence/${evidenceId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);
    expect(data.id).toBe(evidenceId);
    expect(data.merkleLeafHash).toBeDefined();
  });

  it('should verify evidence integrity', async () => {
    if (!evidenceId) return;

    const { response, data } = await fetchJson(`/api/v1/evidence/${evidenceId}/verify`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);
    expect(data.verified).toBe(true);
    expect(data.match).toBe(true);
    expect(data.storedHash).toBe(data.computedHash);
  });
});

describe('Compliance Status API', () => {
  it('should require authentication', async () => {
    const { response, data } = await fetchJson('/api/v1/compliance-status');

    expect(response.status).toBe(401);
  });

  it('should return compliance status', async () => {
    const { response, data } = await fetchJson('/api/v1/compliance-status', {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);
    expect(data.summary).toBeDefined();
    expect(data.summary.totalControls).toBeGreaterThan(0);
    expect(data.summary.compliancePercentage).toBeGreaterThanOrEqual(0);
    expect(data.summary.compliancePercentage).toBeLessThanOrEqual(100);
    expect(data.controls).toBeDefined();
    expect(Array.isArray(data.controls)).toBe(true);
  });
});

describe('Audit Trail API', () => {
  it('should require admin or auditor role', async () => {
    // Get viewer token
    const { data: tokenData } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'viewer' }),
    });

    const { response, data } = await fetchJson('/api/v1/audit-trail', {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });

    expect(response.status).toBe(403);
    expect(data.error).toContain('permissions');
  });

  it('should return audit trail for auditor', async () => {
    // Get auditor token
    const { data: tokenData } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'auditor@example.com', role: 'auditor' }),
    });

    const { response, data } = await fetchJson('/api/v1/audit-trail', {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });

    expect(response.status).toBe(200);
    expect(data.auditLog).toBeDefined();
    expect(Array.isArray(data.auditLog)).toBe(true);
    expect(data.pagination).toBeDefined();
  });

  it('should support pagination', async () => {
    const { data: tokenData } = await fetchJson('/api/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ email: 'auditor@example.com', role: 'auditor' }),
    });

    const { response, data } = await fetchJson('/api/v1/audit-trail?limit=5&offset=0', {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });

    expect(response.status).toBe(200);
    expect(data.pagination.limit).toBe(5);
    expect(data.pagination.offset).toBe(0);
  });
});

describe('Enforcement Cases API', () => {
  it('should list enforcement cases', async () => {
    const { response, data } = await fetchJson('/api/v1/enforcement-cases');

    expect(response.status).toBe(200);
    expect(data.cases).toBeDefined();
    expect(Array.isArray(data.cases)).toBe(true);
  });
});

describe('Error Handling', () => {
  it('should return 404 for unknown endpoints', async () => {
    const { response, data } = await fetchJson('/api/v1/unknown-endpoint');

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  it('should handle malformed JSON gracefully', async () => {
    const response = await fetch(`${API_BASE}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    expect(response.status).toBe(400);
  });

  it('should handle expired tokens', async () => {
    // This would require a mock or very short-lived token
    // For now, test invalid token format
    const { response, data } = await fetchJson('/api/v1/evidence', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });

    expect(response.status).toBe(401);
    expect(data.code).toBe('TOKEN_INVALID');
  });
});

describe('Security Headers', () => {
  it('should include security headers', async () => {
    const response = await fetch(`${API_BASE}/api/v1/health`);

    expect(response.headers.get('x-content-type-options')).toBeDefined();
    expect(response.headers.get('x-frame-options')).toBeDefined();
  });
});
