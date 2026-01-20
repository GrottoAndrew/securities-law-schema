/**
 * Integration tests for cloud storage providers.
 *
 * These tests run against actual cloud providers when credentials are available.
 * Set the appropriate environment variables to enable tests:
 *
 * S3:
 *   AWS_REGION, S3_BUCKET, S3_PREFIX (optional)
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or use IAM role)
 *
 * Azure:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME
 *   AZURE_STORAGE_ACCOUNT_KEY (or use DefaultAzureCredential)
 *
 * Backblaze B2:
 *   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME
 *
 * PostgreSQL:
 *   TEST_DATABASE_URL or DATABASE_URL
 *
 * Run specific provider tests:
 *   STORAGE_PROVIDER=s3 npm test -- integration.test
 *   STORAGE_PROVIDER=azure npm test -- integration.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ImmutableStorage, StorageError } from '../interface';

// =============================================================================
// Test Utilities
// =============================================================================

const TEST_PREFIX = `integration-test-${randomUUID().slice(0, 8)}/`;

function hasS3Credentials(): boolean {
  return !!(
    (process.env.AWS_REGION || process.env.S3_REGION) &&
    process.env.S3_BUCKET
  );
}

function hasAzureCredentials(): boolean {
  return !!(
    (process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.AZURE_STORAGE_CONNECTION_STRING) &&
    process.env.AZURE_STORAGE_CONTAINER_NAME
  );
}

function hasBackblazeCredentials(): boolean {
  return !!(
    process.env.B2_APPLICATION_KEY_ID &&
    process.env.B2_APPLICATION_KEY &&
    process.env.B2_BUCKET_NAME
  );
}

function hasPostgresCredentials(): boolean {
  return !!(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
}

// =============================================================================
// Shared Test Suite
// =============================================================================

/**
 * Standard test suite for any ImmutableStorage implementation.
 */
function runStorageTestSuite(
  name: string,
  createStorage: () => Promise<ImmutableStorage>,
  options: { supportsWORM: boolean; supportsLegalHold: boolean }
) {
  describe(`${name} Integration Tests`, () => {
    let storage: ImmutableStorage;
    const storedKeys: string[] = [];

    beforeAll(async () => {
      storage = await createStorage();
    });

    afterAll(async () => {
      // Cleanup: list and note stored keys (can't delete WORM objects)
      if (storedKeys.length > 0) {
        console.log(`${name}: Test objects stored at prefix ${TEST_PREFIX}`);
        console.log(`Keys: ${storedKeys.join(', ')}`);
        if (options.supportsWORM) {
          console.log('Note: WORM objects cannot be deleted until retention expires');
        }
      }
    });

    it('should report correct capabilities', () => {
      const caps = storage.getCapabilities();

      expect(caps.supportsWORM).toBe(options.supportsWORM);
      expect(caps.supportsLegalHold).toBe(options.supportsLegalHold);
      expect(caps.maxObjectSize).toBeGreaterThan(0);
      expect(caps.providerName).toBeTruthy();
    });

    it('should pass health check', async () => {
      const healthy = await storage.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should store and retrieve an object', async () => {
      const key = `${TEST_PREFIX}test-doc-${randomUUID()}.txt`;
      const content = Buffer.from('Hello, compliance world!');
      storedKeys.push(key);

      // Store
      const stored = await storage.store(key, content, {
        contentType: 'text/plain',
        metadata: { 'test-run': 'integration' },
      });

      expect(stored.key).toBe(key);
      expect(stored.size).toBe(content.length);
      expect(stored.contentHash).toHaveLength(64); // SHA-256 hex
      expect(stored.storedAt).toBeInstanceOf(Date);

      // Retrieve
      const { data, metadata } = await storage.retrieve(key);

      expect(data.toString()).toBe('Hello, compliance world!');
      expect(metadata.contentHash).toBe(stored.contentHash);
      expect(metadata.size).toBe(content.length);
    });

    it('should verify integrity', async () => {
      const key = `${TEST_PREFIX}integrity-test-${randomUUID()}.bin`;
      const content = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      storedKeys.push(key);

      await storage.store(key, content);

      const valid = await storage.verifyIntegrity(key);
      expect(valid).toBe(true);
    });

    it('should check object existence', async () => {
      const key = `${TEST_PREFIX}exists-test-${randomUUID()}.txt`;
      const content = Buffer.from('existence test');
      storedKeys.push(key);

      // Before store
      expect(await storage.exists(key)).toBe(false);

      // After store
      await storage.store(key, content);
      expect(await storage.exists(key)).toBe(true);
    });

    it('should list objects with prefix', async () => {
      const subPrefix = `${TEST_PREFIX}list-test/`;
      const key1 = `${subPrefix}file1.txt`;
      const key2 = `${subPrefix}file2.txt`;
      const content = Buffer.from('list test');
      storedKeys.push(key1, key2);

      await storage.store(key1, content);
      await storage.store(key2, content);

      const listed = await storage.list(subPrefix);

      expect(listed).toContain(key1);
      expect(listed).toContain(key2);
    });

    it('should throw NOT_FOUND for missing object', async () => {
      const key = `${TEST_PREFIX}nonexistent-${randomUUID()}.txt`;

      await expect(storage.retrieve(key)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should reject duplicate keys (immutable)', async () => {
      const key = `${TEST_PREFIX}immutable-test-${randomUUID()}.txt`;
      const content = Buffer.from('original content');
      storedKeys.push(key);

      // First store succeeds
      await storage.store(key, content);

      // Second store should fail
      await expect(
        storage.store(key, Buffer.from('different content'))
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      });
    });

    if (options.supportsLegalHold) {
      it('should apply and remove legal hold', async () => {
        const key = `${TEST_PREFIX}legal-hold-test-${randomUUID()}.txt`;
        const content = Buffer.from('legal hold test');
        storedKeys.push(key);

        await storage.store(key, content);

        // Apply legal hold
        await storage.applyLegalHold(key);

        // Verify via retrieve metadata
        const { metadata } = await storage.retrieve(key);
        expect(metadata.legalHold).toBe(true);

        // Remove legal hold
        await storage.removeLegalHold(key);

        // Verify removed
        const { metadata: afterRemove } = await storage.retrieve(key);
        expect(afterRemove.legalHold).toBe(false);
      });
    } else {
      it('should throw NOT_SUPPORTED for legal hold', async () => {
        const key = `${TEST_PREFIX}legal-hold-unsupported-${randomUUID()}.txt`;
        const content = Buffer.from('no legal hold');
        storedKeys.push(key);

        await storage.store(key, content);

        await expect(storage.applyLegalHold(key)).rejects.toMatchObject({
          code: 'NOT_SUPPORTED',
        });
      });
    }

    if (options.supportsWORM) {
      it('should store with retention policy', async () => {
        const key = `${TEST_PREFIX}retention-test-${randomUUID()}.txt`;
        const content = Buffer.from('retained content');
        storedKeys.push(key);

        const stored = await storage.store(key, content, {
          retention: {
            retentionDays: 1, // Minimum for testing
            mode: 'compliance',
          },
        });

        expect(stored.retention?.mode).toBe('compliance');
        expect(stored.retention?.retentionDays).toBe(1);

        // Retrieve and verify retention in metadata
        const { metadata } = await storage.retrieve(key);
        expect(metadata.retention).toBeDefined();
      });
    }
  });
}

// =============================================================================
// Provider-Specific Test Suites
// =============================================================================

describe.skipIf(!hasS3Credentials())('S3 Object Lock', () => {
  runStorageTestSuite(
    'S3 Object Lock',
    async () => {
      const { S3ObjectLockStorage } = await import('./s3-object-lock');
      return new S3ObjectLockStorage({
        region: process.env.AWS_REGION || process.env.S3_REGION!,
        bucket: process.env.S3_BUCKET!,
        prefix: TEST_PREFIX,
        defaultRetentionDays: 1, // Minimum for tests
      });
    },
    { supportsWORM: true, supportsLegalHold: true }
  );
});

describe.skipIf(!hasAzureCredentials())('Azure Immutable Storage', () => {
  runStorageTestSuite(
    'Azure Immutable',
    async () => {
      const { AzureImmutableStorage } = await import('./azure-immutable');
      return new AzureImmutableStorage({
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        containerName: process.env.AZURE_STORAGE_CONTAINER_NAME!,
        accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        prefix: TEST_PREFIX,
        defaultRetentionDays: 1,
      });
    },
    { supportsWORM: true, supportsLegalHold: true }
  );
});

describe.skipIf(!hasBackblazeCredentials())('Backblaze B2', () => {
  runStorageTestSuite(
    'Backblaze B2',
    async () => {
      const { BackblazeB2Storage } = await import('./backblaze-b2');
      return new BackblazeB2Storage({
        applicationKeyId: process.env.B2_APPLICATION_KEY_ID!,
        applicationKey: process.env.B2_APPLICATION_KEY!,
        bucketName: process.env.B2_BUCKET_NAME!,
        region: process.env.B2_REGION,
        prefix: TEST_PREFIX,
      });
    },
    { supportsWORM: false, supportsLegalHold: false }
  );
});

describe.skipIf(!hasPostgresCredentials())('PostgreSQL Storage', () => {
  runStorageTestSuite(
    'PostgreSQL',
    async () => {
      const { PostgresOnlyStorage } = await import('./postgres-only');
      const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
      return new PostgresOnlyStorage(connectionString);
    },
    { supportsWORM: false, supportsLegalHold: true }
  );
});

// =============================================================================
// Factory Integration Test
// =============================================================================

describe('Storage Factory Integration', () => {
  it('should create storage from factory', async () => {
    const { createStorage, getStorageProviderInfo } = await import('../factory');

    // This will use whatever provider is configured in env
    const { storage, provider, isDemo, capabilities } = await createStorage();

    expect(storage).toBeDefined();
    expect(provider).toBeTruthy();
    expect(typeof isDemo).toBe('boolean');
    expect(capabilities).toBeDefined();

    // Health check - only run if we have valid credentials
    // Skip for postgres in CI environment without database
    const info = getStorageProviderInfo();
    if (provider === 'postgres' && info.missingCredentials.length > 0) {
      // Postgres with defaults - may not have a running database
      console.log('Skipping health check - no database credentials configured');
    } else {
      const healthy = await storage.healthCheck();
      expect(healthy).toBe(true);
    }
  });
});
