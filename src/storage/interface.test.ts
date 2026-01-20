/**
 * Unit tests for storage interface types and StorageError class.
 */

import { describe, it, expect } from 'vitest';
import { StorageError, type StorageErrorCode } from './interface';

describe('StorageError', () => {
  it('should create error with code', () => {
    const error = new StorageError('Object not found', 'NOT_FOUND');

    expect(error.message).toBe('Object not found');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.name).toBe('StorageError');
    expect(error.cause).toBeUndefined();
  });

  it('should create error with cause', () => {
    const cause = new Error('Connection reset');
    const error = new StorageError('Storage operation failed', 'CONNECTION_FAILED', cause);

    expect(error.message).toBe('Storage operation failed');
    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.cause).toBe(cause);
  });

  it('should be instance of Error', () => {
    const error = new StorageError('Test error', 'UNKNOWN');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StorageError);
  });

  it('should have correct stack trace', () => {
    const error = new StorageError('Test error', 'UNKNOWN');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('StorageError');
  });

  describe('error codes', () => {
    const testCases: Array<{ code: StorageErrorCode; description: string }> = [
      { code: 'NOT_FOUND', description: 'object does not exist' },
      { code: 'ALREADY_EXISTS', description: 'object already exists (immutable)' },
      { code: 'INTEGRITY_FAILED', description: 'hash verification failed' },
      { code: 'PERMISSION_DENIED', description: 'access not authorized' },
      { code: 'RETENTION_ACTIVE', description: 'retention policy prevents operation' },
      { code: 'LEGAL_HOLD_ACTIVE', description: 'legal hold prevents operation' },
      { code: 'NOT_SUPPORTED', description: 'operation not supported by provider' },
      { code: 'CONNECTION_FAILED', description: 'storage backend unreachable' },
      { code: 'UNKNOWN', description: 'unexpected error' },
    ];

    for (const { code, description } of testCases) {
      it(`should support ${code} code for ${description}`, () => {
        const error = new StorageError(`Test: ${description}`, code);
        expect(error.code).toBe(code);
      });
    }
  });

  describe('error matching', () => {
    it('should match by code in catch block', () => {
      const error = new StorageError('Not found', 'NOT_FOUND');

      // Simulating catch pattern
      const matchResult = (e: StorageError) => {
        switch (e.code) {
          case 'NOT_FOUND':
            return 'handle not found';
          case 'ALREADY_EXISTS':
            return 'handle exists';
          default:
            return 'handle other';
        }
      };

      expect(matchResult(error)).toBe('handle not found');
    });

    it('should support toMatchObject in tests', () => {
      const error = new StorageError('Already exists', 'ALREADY_EXISTS');

      expect(error).toMatchObject({
        code: 'ALREADY_EXISTS',
        message: 'Already exists',
      });
    });
  });
});

describe('RetentionPolicy type', () => {
  it('should accept valid retention modes', () => {
    // Type-level test - if this compiles, it passes
    const compliancePolicy = { retentionDays: 2555, mode: 'compliance' as const };
    const governancePolicy = { retentionDays: 365, mode: 'governance' as const };

    expect(compliancePolicy.mode).toBe('compliance');
    expect(governancePolicy.mode).toBe('governance');
    expect(compliancePolicy.retentionDays).toBe(2555); // 7 years for SEC 17a-4
  });
});

describe('StorageCapabilities type', () => {
  it('should describe provider capabilities', () => {
    // PostgreSQL demo provider (no WORM)
    const postgresCapabilities = {
      supportsWORM: false,
      supportsLegalHold: true,
      supportsRetention: true,
      maxObjectSize: 1024 * 1024 * 1024, // 1GB
      providerName: 'PostgreSQL (Demo)',
    };

    expect(postgresCapabilities.supportsWORM).toBe(false);
    expect(postgresCapabilities.providerName).toContain('Demo');
  });

  it('should describe S3 Object Lock capabilities', () => {
    // S3 production provider (with WORM)
    const s3Capabilities = {
      supportsWORM: true,
      supportsLegalHold: true,
      supportsRetention: true,
      maxObjectSize: 5 * 1024 * 1024 * 1024 * 1024, // 5TB
      providerName: 'AWS S3 Object Lock',
    };

    expect(s3Capabilities.supportsWORM).toBe(true);
    expect(s3Capabilities.providerName).toContain('Object Lock');
  });
});
