/**
 * AWS S3 Object Lock Storage Provider
 *
 * Implements ImmutableStorage using S3 with Object Lock in COMPLIANCE mode.
 * This provides true WORM (Write Once Read Many) storage that meets SEC 17a-4.
 *
 * COMPLIANCE mode ensures:
 * - Objects cannot be deleted until retention expires
 * - Retention cannot be shortened (only extended)
 * - Not even the root account can delete objects
 *
 * Requirements:
 * - S3 bucket must have Object Lock enabled at creation
 * - Bucket must have versioning enabled
 * - IAM permissions for s3:PutObject, s3:GetObject, s3:PutObjectLegalHold
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectLegalHoldCommand,
  GetObjectLegalHoldCommand,
  type ObjectLockLegalHoldStatus,
  type ObjectLockMode,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ImmutableStorage,
  StoredObject,
  ObjectMetadata,
  RetentionPolicy,
  StorageCapabilities,
  StorageError,
} from '../interface.js';
import { streamToBuffer, mapCloudError } from '../utils.js';

// =============================================================================
// Types
// =============================================================================

export interface S3ObjectLockConfig {
  /** AWS region (e.g., 'us-east-1') */
  region: string;
  /** S3 bucket name - must have Object Lock enabled */
  bucket: string;
  /** Optional key prefix for all objects */
  prefix?: string;
  /** Default retention in days (default: 2557 = ~7 years for SEC 17a-4) */
  defaultRetentionDays?: number;
  /** Object Lock mode (default: COMPLIANCE for SEC 17a-4) */
  lockMode?: 'COMPLIANCE' | 'GOVERNANCE';
  /** Optional AWS credentials (uses default credential chain if not provided) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

/** Default retention: 7 years (2557 days) for SEC 17a-4 */
const DEFAULT_RETENTION_DAYS = 2557;

/** S3 max object size: 5TB */
const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * 1024 * 1024;

// =============================================================================
// S3ObjectLockStorage Class
// =============================================================================

/**
 * S3 Object Lock storage implementing ImmutableStorage.
 *
 * Usage:
 * ```typescript
 * const storage = new S3ObjectLockStorage({
 *   region: 'us-east-1',
 *   bucket: 'my-compliance-bucket',
 *   lockMode: 'COMPLIANCE',
 * });
 *
 * await storage.store('evidence/doc-123.pdf', pdfBuffer, {
 *   retention: { retentionDays: 2557, mode: 'compliance' },
 *   contentType: 'application/pdf',
 * });
 * ```
 */
export class S3ObjectLockStorage implements ImmutableStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly defaultRetentionDays: number;
  private readonly lockMode: ObjectLockMode;

  constructor(config: S3ObjectLockConfig) {
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
    });
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? '';
    this.defaultRetentionDays = config.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS;
    this.lockMode = config.lockMode ?? 'COMPLIANCE';
  }

  /**
   * Store an object with Object Lock retention.
   * Rejects if object already exists (immutability enforcement).
   */
  async store(
    key: string,
    data: Buffer,
    options?: {
      retention?: RetentionPolicy;
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StoredObject> {
    const fullKey = this.prefix + key;

    // Enforce immutability: reject if object already exists
    const alreadyExists = await this.exists(key);
    if (alreadyExists) {
      throw new StorageError(`Object already exists: ${key}`, 'ALREADY_EXISTS');
    }

    const contentHash = createHash('sha256').update(data).digest('hex');

    // Calculate retention date
    const retentionDays = options?.retention?.retentionDays ?? this.defaultRetentionDays;
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + retentionDays);

    // Determine lock mode
    const lockMode: ObjectLockMode =
      options?.retention?.mode === 'governance' ? 'GOVERNANCE' : this.lockMode;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: data,
        ContentType: options?.contentType ?? 'application/octet-stream',
        ChecksumSHA256: Buffer.from(contentHash, 'hex').toString('base64'),
        ObjectLockMode: lockMode,
        ObjectLockRetainUntilDate: retentionDate,
        Metadata: {
          ...options?.metadata,
          'content-hash': contentHash,
          'stored-at': new Date().toISOString(),
        },
      });

      const response = await this.client.send(command);

      return {
        key,
        contentHash,
        size: data.length,
        storedAt: new Date(),
        retention: {
          retentionDays,
          mode: lockMode === 'COMPLIANCE' ? 'compliance' : 'governance',
        },
        providerMetadata: {
          versionId: response.VersionId,
          etag: response.ETag,
          bucket: this.bucket,
          fullKey,
        },
      };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw mapCloudError(err, key);
    }
  }

  /**
   * Retrieve an object by key.
   */
  async retrieve(key: string): Promise<{ data: Buffer; metadata: ObjectMetadata }> {
    const fullKey = this.prefix + key;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new StorageError(`Empty response for: ${key}`, 'UNKNOWN');
      }

      const data = await streamToBuffer(response.Body as Readable);
      const computedHash = createHash('sha256').update(data).digest('hex');

      // Get retention info
      let retention: RetentionPolicy | undefined;
      if (response.ObjectLockRetainUntilDate) {
        const now = new Date();
        const retainUntil = response.ObjectLockRetainUntilDate;
        const daysRemaining = Math.ceil(
          (retainUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        retention = {
          retentionDays: Math.max(0, daysRemaining),
          mode: response.ObjectLockMode === 'COMPLIANCE' ? 'compliance' : 'governance',
        };
      }

      return {
        data,
        metadata: {
          contentHash: computedHash,
          size: data.length,
          storedAt: response.LastModified ?? new Date(),
          contentType: response.ContentType,
          retention,
          legalHold: response.ObjectLockLegalHoldStatus === 'ON',
        },
      };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw mapCloudError(err, key);
    }
  }

  /**
   * Verify object integrity by recomputing hash.
   */
  async verifyIntegrity(key: string): Promise<boolean> {
    const { data, metadata } = await this.retrieve(key);
    const computedHash = createHash('sha256').update(data).digest('hex');
    return computedHash === metadata.contentHash;
  }

  /**
   * Check if an object exists.
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
      });

      await this.client.send(command);
      return true;
    } catch (err) {
      const mapped = mapCloudError(err, key);
      if (mapped.code === 'NOT_FOUND') {
        return false;
      }
      throw mapped;
    }
  }

  /**
   * List objects with optional prefix filter.
   */
  async list(prefix?: string, limit = 1000): Promise<string[]> {
    const fullPrefix = this.prefix + (prefix ?? '');

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
        MaxKeys: limit,
      });

      const response = await this.client.send(command);

      return (response.Contents ?? [])
        .map((obj) => obj.Key ?? '')
        .filter((k) => k.length > 0)
        .map((k) => k.slice(this.prefix.length));
    } catch (err) {
      throw mapCloudError(err, prefix ?? '');
    }
  }

  /**
   * Apply legal hold to an object.
   * Legal hold prevents deletion even after retention expires.
   */
  async applyLegalHold(key: string): Promise<void> {
    const fullKey = this.prefix + key;

    try {
      const command = new PutObjectLegalHoldCommand({
        Bucket: this.bucket,
        Key: fullKey,
        LegalHold: {
          Status: 'ON' as ObjectLockLegalHoldStatus,
        },
      });

      await this.client.send(command);
    } catch (err) {
      throw mapCloudError(err, key);
    }
  }

  /**
   * Remove legal hold from an object.
   */
  async removeLegalHold(key: string): Promise<void> {
    const fullKey = this.prefix + key;

    try {
      const command = new PutObjectLegalHoldCommand({
        Bucket: this.bucket,
        Key: fullKey,
        LegalHold: {
          Status: 'OFF' as ObjectLockLegalHoldStatus,
        },
      });

      await this.client.send(command);
    } catch (err) {
      throw mapCloudError(err, key);
    }
  }

  /**
   * Get storage provider capabilities.
   */
  getCapabilities(): StorageCapabilities {
    return {
      supportsWORM: true,
      supportsLegalHold: true,
      supportsRetention: true,
      maxObjectSize: MAX_OBJECT_SIZE,
      providerName: `AWS S3 Object Lock (${this.lockMode})`,
    };
  }

  /**
   * Health check - verify bucket is accessible.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: '__health_check_nonexistent__',
      });

      await this.client.send(command);
      return true;
    } catch (err) {
      const error = err as Error;
      // NotFound is expected - bucket is accessible
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return true;
      }
      // AccessDenied or NoSuchBucket means unhealthy
      return false;
    }
  }

  /**
   * Get legal hold status for an object.
   */
  async getLegalHoldStatus(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;

    try {
      const command = new GetObjectLegalHoldCommand({
        Bucket: this.bucket,
        Key: fullKey,
      });

      const response = await this.client.send(command);
      return response.LegalHold?.Status === 'ON';
    } catch (err) {
      throw mapCloudError(err, key);
    }
  }
}

/**
 * Create S3 Object Lock storage from environment variables.
 *
 * Expected env vars:
 * - AWS_REGION or S3_REGION
 * - S3_BUCKET
 * - S3_PREFIX (optional)
 * - S3_RETENTION_DAYS (optional, default: 2557)
 * - S3_LOCK_MODE (optional, default: COMPLIANCE)
 * - AWS_ACCESS_KEY_ID (optional, uses default chain)
 * - AWS_SECRET_ACCESS_KEY (optional, uses default chain)
 */
export function createS3ObjectLockStorage(): S3ObjectLockStorage {
  const region = process.env.AWS_REGION || process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;

  if (!region) {
    throw new Error('Missing AWS_REGION or S3_REGION environment variable');
  }
  if (!bucket) {
    throw new Error('Missing S3_BUCKET environment variable');
  }

  return new S3ObjectLockStorage({
    region,
    bucket,
    prefix: process.env.S3_PREFIX,
    defaultRetentionDays: process.env.S3_RETENTION_DAYS
      ? parseInt(process.env.S3_RETENTION_DAYS, 10)
      : undefined,
    lockMode: process.env.S3_LOCK_MODE === 'GOVERNANCE' ? 'GOVERNANCE' : 'COMPLIANCE',
  });
}
