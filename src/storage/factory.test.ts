/**
 * Unit tests for storage factory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getStorageProviderInfo,
  validateStorageConfig,
  type StorageProviderType,
} from './factory';

describe('Storage Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env for each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getStorageProviderInfo', () => {
    it('should detect postgres by default when no credentials', () => {
      // Clear all storage-related env vars
      delete process.env.STORAGE_PROVIDER;
      delete process.env.S3_BUCKET;
      delete process.env.AWS_REGION;
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
      delete process.env.B2_APPLICATION_KEY_ID;

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('postgres');
      expect(info.isExplicit).toBe(false);
    });

    it('should respect explicit STORAGE_PROVIDER', () => {
      process.env.STORAGE_PROVIDER = 's3';

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('s3');
      expect(info.isExplicit).toBe(true);
    });

    it('should auto-detect S3 from credentials', () => {
      delete process.env.STORAGE_PROVIDER;
      process.env.AWS_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'my-bucket';

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('s3');
      expect(info.isExplicit).toBe(false);
    });

    it('should auto-detect Azure from credentials', () => {
      delete process.env.STORAGE_PROVIDER;
      delete process.env.S3_BUCKET;
      process.env.AZURE_STORAGE_ACCOUNT_NAME = 'myaccount';
      process.env.AZURE_STORAGE_CONTAINER_NAME = 'mycontainer';

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('azure');
      expect(info.isExplicit).toBe(false);
    });

    it('should auto-detect Backblaze from credentials', () => {
      delete process.env.STORAGE_PROVIDER;
      delete process.env.S3_BUCKET;
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
      process.env.B2_APPLICATION_KEY_ID = 'keyid';
      process.env.B2_APPLICATION_KEY = 'key';
      process.env.B2_BUCKET_NAME = 'bucket';

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('backblaze');
      expect(info.isExplicit).toBe(false);
    });

    it('should report missing S3 credentials', () => {
      process.env.STORAGE_PROVIDER = 's3';
      delete process.env.AWS_REGION;
      delete process.env.S3_REGION;
      delete process.env.S3_BUCKET;

      const info = getStorageProviderInfo();

      expect(info.missingCredentials).toContain('AWS_REGION or S3_REGION');
      expect(info.missingCredentials).toContain('S3_BUCKET');
    });

    it('should report missing Azure credentials', () => {
      process.env.STORAGE_PROVIDER = 'azure';
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      delete process.env.AZURE_STORAGE_CONTAINER_NAME;

      const info = getStorageProviderInfo();

      expect(info.missingCredentials).toContain('AZURE_STORAGE_ACCOUNT_NAME');
      expect(info.missingCredentials).toContain('AZURE_STORAGE_CONTAINER_NAME');
    });

    it('should report missing Backblaze credentials', () => {
      process.env.STORAGE_PROVIDER = 'backblaze';
      delete process.env.B2_APPLICATION_KEY_ID;
      delete process.env.B2_APPLICATION_KEY;
      delete process.env.B2_BUCKET_NAME;

      const info = getStorageProviderInfo();

      expect(info.missingCredentials).toContain('B2_APPLICATION_KEY_ID');
      expect(info.missingCredentials).toContain('B2_APPLICATION_KEY');
      expect(info.missingCredentials).toContain('B2_BUCKET_NAME');
    });
  });

  describe('validateStorageConfig', () => {
    it('should return no errors for valid S3 config', () => {
      process.env.AWS_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'my-bucket';

      const errors = validateStorageConfig('s3');

      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing S3 bucket', () => {
      process.env.AWS_REGION = 'us-east-1';
      delete process.env.S3_BUCKET;

      const errors = validateStorageConfig('s3');

      expect(errors).toContain('Missing S3_BUCKET');
    });

    it('should return no errors for valid Azure config', () => {
      process.env.AZURE_STORAGE_ACCOUNT_NAME = 'myaccount';
      process.env.AZURE_STORAGE_CONTAINER_NAME = 'mycontainer';

      const errors = validateStorageConfig('azure');

      expect(errors).toHaveLength(0);
    });

    it('should accept Azure connection string', () => {
      process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;...';
      process.env.AZURE_STORAGE_CONTAINER_NAME = 'mycontainer';

      const errors = validateStorageConfig('azure');

      expect(errors).toHaveLength(0);
    });

    it('should return no errors for valid Backblaze config', () => {
      process.env.B2_APPLICATION_KEY_ID = 'keyid';
      process.env.B2_APPLICATION_KEY = 'key';
      process.env.B2_BUCKET_NAME = 'bucket';

      const errors = validateStorageConfig('backblaze');

      expect(errors).toHaveLength(0);
    });

    it('should return no errors for postgres (has defaults)', () => {
      const errors = validateStorageConfig('postgres');

      expect(errors).toHaveLength(0);
    });
  });

  describe('provider selection priority', () => {
    it('should prioritize S3 over Azure when both present', () => {
      delete process.env.STORAGE_PROVIDER;
      process.env.AWS_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'my-bucket';
      process.env.AZURE_STORAGE_ACCOUNT_NAME = 'myaccount';
      process.env.AZURE_STORAGE_CONTAINER_NAME = 'mycontainer';

      const info = getStorageProviderInfo();

      // S3 is checked first
      expect(info.provider).toBe('s3');
    });

    it('should prioritize explicit provider over auto-detection', () => {
      process.env.STORAGE_PROVIDER = 'postgres';
      process.env.AWS_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'my-bucket';

      const info = getStorageProviderInfo();

      expect(info.provider).toBe('postgres');
      expect(info.isExplicit).toBe(true);
    });
  });

  describe('case insensitivity', () => {
    const cases: Array<{ input: string; expected: StorageProviderType }> = [
      { input: 'S3', expected: 's3' },
      { input: 's3', expected: 's3' },
      { input: 'AZURE', expected: 'azure' },
      { input: 'Azure', expected: 'azure' },
      { input: 'POSTGRES', expected: 'postgres' },
      { input: 'PostgreS', expected: 'postgres' },
      { input: 'BACKBLAZE', expected: 'backblaze' },
    ];

    for (const { input, expected } of cases) {
      it(`should handle STORAGE_PROVIDER=${input}`, () => {
        process.env.STORAGE_PROVIDER = input;

        const info = getStorageProviderInfo();

        expect(info.provider).toBe(expected);
      });
    }
  });
});
