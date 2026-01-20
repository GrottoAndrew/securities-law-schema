/**
 * Integration tests for PostgreSQL-only storage provider.
 *
 * Requirements:
 * - Docker running: `docker-compose up -d`
 * - PostgreSQL accessible at localhost:5432
 *
 * Run: npm test -- src/storage/providers/postgres-only.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { PostgresOnlyStorage } from './postgres-only';
import { StorageError } from '../interface';

// Skip tests if no database available
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://audit:dev_password_change_in_prod@localhost:5432/audit';

describe('PostgresOnlyStorage', () => {
  let storage: PostgresOnlyStorage;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });

    // Check if database is available
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.warn('PostgreSQL not available, skipping integration tests');
      console.warn('Start database with: docker-compose up -d');
      return;
    }

    storage = new PostgresOnlyStorage(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (!pool) return;

    // Clean up test data between tests
    try {
      await pool.query("DELETE FROM immutable_objects WHERE key LIKE 'test/%'");
    } catch {
      // Table might not exist yet
    }
  });

  describe('store()', () => {
    it('should store an object and return metadata', async () => {
      if (!storage) return;

      const key = `test/object-${Date.now()}`;
      const data = Buffer.from('Hello, World!');

      const result = await storage.store(key, data, {
        contentType: 'text/plain',
        metadata: { source: 'test' },
      });

      expect(result.key).toBe(key);
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.size).toBe(13);
      expect(result.storedAt).toBeInstanceOf(Date);
    });

    it('should store with retention policy', async () => {
      if (!storage) return;

      const key = `test/retained-${Date.now()}`;
      const data = Buffer.from('Retained data');

      const result = await storage.store(key, data, {
        retention: { retentionDays: 2555, mode: 'compliance' },
      });

      expect(result.retention).toEqual({
        retentionDays: 2555,
        mode: 'compliance',
      });
    });

    it('should reject duplicate keys', async () => {
      if (!storage) return;

      const key = `test/duplicate-${Date.now()}`;
      const data = Buffer.from('Original');

      await storage.store(key, data);

      await expect(
        storage.store(key, Buffer.from('Duplicate'))
      ).rejects.toThrow(StorageError);

      await expect(
        storage.store(key, Buffer.from('Duplicate'))
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    });
  });

  describe('retrieve()', () => {
    it('should retrieve stored object with metadata', async () => {
      if (!storage) return;

      const key = `test/retrieve-${Date.now()}`;
      const content = 'Test content for retrieval';
      const data = Buffer.from(content);

      await storage.store(key, data, {
        contentType: 'text/plain',
        retention: { retentionDays: 365, mode: 'governance' },
      });

      const result = await storage.retrieve(key);

      expect(result.data.toString()).toBe(content);
      expect(result.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.metadata.size).toBe(data.length);
      expect(result.metadata.contentType).toBe('text/plain');
      expect(result.metadata.retention).toEqual({
        retentionDays: 365,
        mode: 'governance',
      });
    });

    it('should throw NOT_FOUND for missing key', async () => {
      if (!storage) return;

      await expect(
        storage.retrieve('test/nonexistent-key')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('verifyIntegrity()', () => {
    it('should return true for intact objects', async () => {
      if (!storage) return;

      const key = `test/integrity-${Date.now()}`;
      await storage.store(key, Buffer.from('Integrity test'));

      const isValid = await storage.verifyIntegrity(key);
      expect(isValid).toBe(true);
    });
  });

  describe('exists()', () => {
    it('should return true for existing objects', async () => {
      if (!storage) return;

      const key = `test/exists-${Date.now()}`;
      await storage.store(key, Buffer.from('Exists'));

      expect(await storage.exists(key)).toBe(true);
    });

    it('should return false for missing objects', async () => {
      if (!storage) return;

      expect(await storage.exists('test/missing-object')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should list objects by prefix', async () => {
      if (!storage) return;

      const prefix = `test/list-${Date.now()}/`;

      await storage.store(`${prefix}a`, Buffer.from('A'));
      await storage.store(`${prefix}b`, Buffer.from('B'));
      await storage.store(`${prefix}c`, Buffer.from('C'));
      await storage.store(`test/other-${Date.now()}`, Buffer.from('Other'));

      const keys = await storage.list(prefix);

      expect(keys).toHaveLength(3);
      expect(keys.every((k) => k.startsWith(prefix))).toBe(true);
    });

    it('should respect limit parameter', async () => {
      if (!storage) return;

      const prefix = `test/limit-${Date.now()}/`;

      for (let i = 0; i < 5; i++) {
        await storage.store(`${prefix}${i}`, Buffer.from(`Item ${i}`));
      }

      const keys = await storage.list(prefix, 2);
      expect(keys).toHaveLength(2);
    });
  });

  describe('legal hold', () => {
    it('should apply and remove legal hold', async () => {
      if (!storage) return;

      const key = `test/legal-hold-${Date.now()}`;
      await storage.store(key, Buffer.from('Hold me'));

      // Apply hold
      await storage.applyLegalHold!(key);
      let result = await storage.retrieve(key);
      expect(result.metadata.legalHold).toBe(true);

      // Remove hold
      await storage.removeLegalHold!(key);
      result = await storage.retrieve(key);
      expect(result.metadata.legalHold).toBe(false);
    });
  });

  describe('getCapabilities()', () => {
    it('should return correct capabilities', async () => {
      if (!storage) return;

      const caps = storage.getCapabilities();

      expect(caps.supportsWORM).toBe(false); // PostgreSQL cannot enforce WORM
      expect(caps.supportsLegalHold).toBe(true);
      expect(caps.supportsRetention).toBe(true);
      expect(caps.providerName).toBe('PostgreSQL (Demo)');
    });
  });

  describe('healthCheck()', () => {
    it('should return true when database is accessible', async () => {
      if (!storage) return;

      const healthy = await storage.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});

describe('PostgresOnlyStorage - checkpoint workflow', () => {
  let storage: PostgresOnlyStorage;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });

    try {
      await pool.query('SELECT 1');
    } catch {
      return;
    }

    storage = new PostgresOnlyStorage(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('should store and retrieve a checkpoint with Merkle root', async () => {
    if (!storage) return;

    const checkpoint = {
      checkpoint_id: `cp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      merkle_root: 'abc123def456'.repeat(5).substring(0, 64),
      event_count: 100,
      previous_checkpoint: null,
      signature: 'test-signature',
    };

    const key = `checkpoints/${checkpoint.checkpoint_id}.json`;
    const data = Buffer.from(JSON.stringify(checkpoint, null, 2));

    await storage.store(key, data, {
      contentType: 'application/json',
      retention: { retentionDays: 2555, mode: 'compliance' },
    });

    const result = await storage.retrieve(key);
    const retrieved = JSON.parse(result.data.toString());

    expect(retrieved.checkpoint_id).toBe(checkpoint.checkpoint_id);
    expect(retrieved.merkle_root).toBe(checkpoint.merkle_root);
    expect(result.metadata.retention?.retentionDays).toBe(2555);
  });
});
