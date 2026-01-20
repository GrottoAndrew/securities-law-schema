/**
 * Backblaze B2 Storage Provider
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  ⚠️  WARNING: NO WORM COMPLIANCE - COST OPTIMIZATION ONLY             │
 * │                                                                        │
 * │  Backblaze B2 does NOT support Object Lock or WORM:                    │
 * │  • Objects can be deleted at any time                                  │
 * │  • No retention policy enforcement                                     │
 * │  • No legal hold capability                                            │
 * │                                                                        │
 * │  For SEC 17a-4, FINRA 4511, or any regulatory WORM requirement:        │
 * │  → Use S3 Object Lock (COMPLIANCE mode) or Azure Immutable Blob        │
 * │                                                                        │
 * │  B2 is appropriate for:                                                │
 * │  • Development and testing                                             │
 * │  • Non-regulated backup storage                                        │
 * │  • Cost-sensitive archival (non-compliance)                            │
 * │  • Starter tier with limited budget                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Uses S3-compatible API with B2 endpoint.
 *
 * Cost Benefits:
 * - Storage: $0.006/GB/month (vs S3 $0.023/GB)
 * - Egress: $0.01/GB (vs S3 $0.09/GB)
 * - Free egress to Cloudflare (bandwidth alliance)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

export interface BackblazeB2Config {
  /** B2 Application Key ID */
  applicationKeyId: string;
  /** B2 Application Key */
  applicationKey: string;
  /** B2 Bucket name */
  bucketName: string;
  /** B2 Bucket region (e.g., 'us-west-004') */
  region?: string;
  /** Optional key prefix for all objects */
  prefix?: string;
  /** Custom endpoint (default: auto-detected from region) */
  endpoint?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** B2 max object size: 10TB (with multipart) */
const MAX_OBJECT_SIZE = 10 * 1024 * 1024 * 1024 * 1024;

/** Default B2 region */
const DEFAULT_REGION = 'us-west-004';

// =============================================================================
// BackblazeB2Storage Class
// =============================================================================

/**
 * Backblaze B2 storage implementing ImmutableStorage.
 *
 * Uses S3-compatible API. Note: B2 does NOT support Object Lock,
 * so this provider is for cost optimization, not compliance.
 *
 * Usage:
 * ```typescript
 * const storage = new BackblazeB2Storage({
 *   applicationKeyId: process.env.B2_APPLICATION_KEY_ID!,
 *   applicationKey: process.env.B2_APPLICATION_KEY!,
 *   bucketName: 'my-evidence-bucket',
 * });
 *
 * // Store (no WORM - can be deleted)
 * await storage.store('evidence/doc-123.pdf', pdfBuffer, {
 *   contentType: 'application/pdf',
 * });
 * ```
 */
export class BackblazeB2Storage implements ImmutableStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: BackblazeB2Config) {
    const region = config.region ?? DEFAULT_REGION;

    // B2 S3-compatible endpoint format
    const endpoint =
      config.endpoint ?? `https://s3.${region}.backblazeb2.com`;

    this.client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: config.applicationKeyId,
        secretAccessKey: config.applicationKey,
      },
      // B2 requires path-style addressing
      forcePathStyle: true,
    });

    this.bucket = config.bucketName;
    this.prefix = config.prefix ?? '';
  }

  /**
   * Store an object.
   * Rejects if object already exists (immutability enforcement).
   *
   * Note: B2 does NOT support Object Lock, so retention parameters are
   * stored as metadata only (not enforced).
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

    // B2 doesn't enforce retention, but we track it in metadata
    const retentionMetadata: Record<string, string> = {};
    if (options?.retention) {
      retentionMetadata['retention-days'] = String(options.retention.retentionDays);
      retentionMetadata['retention-mode'] = options.retention.mode;
      retentionMetadata['retention-note'] = 'NOT ENFORCED - B2 does not support Object Lock';
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: data,
        ContentType: options?.contentType ?? 'application/octet-stream',
        ChecksumSHA256: Buffer.from(contentHash, 'hex').toString('base64'),
        Metadata: {
          ...options?.metadata,
          ...retentionMetadata,
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
        retention: options?.retention,
        providerMetadata: {
          versionId: response.VersionId,
          etag: response.ETag,
          bucket: this.bucket,
          fullKey,
          warning: 'B2 does not enforce retention - object can be deleted',
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

      // Parse retention from metadata (not enforced)
      let retention: RetentionPolicy | undefined;
      const retentionDays = response.Metadata?.['retention-days'];
      const retentionMode = response.Metadata?.['retention-mode'];
      if (retentionDays && retentionMode) {
        retention = {
          retentionDays: parseInt(retentionDays, 10),
          mode: retentionMode as 'compliance' | 'governance',
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
          legalHold: false,
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
   * Apply legal hold - NOT SUPPORTED by B2.
   *
   * Throws NOT_SUPPORTED error.
   */
  async applyLegalHold(key: string): Promise<void> {
    // Verify object exists first
    const exists = await this.exists(key);
    if (!exists) {
      throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND');
    }

    throw new StorageError(
      'Backblaze B2 does not support legal holds. Use S3 Object Lock or Azure Immutable Storage for compliance.',
      'NOT_SUPPORTED'
    );
  }

  /**
   * Remove legal hold - NOT SUPPORTED by B2.
   */
  async removeLegalHold(key: string): Promise<void> {
    // Verify object exists first
    const exists = await this.exists(key);
    if (!exists) {
      throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND');
    }

    throw new StorageError(
      'Backblaze B2 does not support legal holds. Use S3 Object Lock or Azure Immutable Storage for compliance.',
      'NOT_SUPPORTED'
    );
  }

  /**
   * Get storage provider capabilities.
   */
  getCapabilities(): StorageCapabilities {
    return {
      supportsWORM: false, // B2 has no Object Lock
      supportsLegalHold: false, // B2 has no legal hold
      supportsRetention: false, // Retention tracked in metadata only, not enforced
      maxObjectSize: MAX_OBJECT_SIZE,
      providerName: 'Backblaze B2 (No WORM - Cost Optimization)',
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
      const mapped = mapCloudError(err, '');
      // NotFound is expected - bucket is accessible
      if (mapped.code === 'NOT_FOUND') {
        return true;
      }
      // AccessDenied or NoSuchBucket means unhealthy
      return false;
    }
  }
}

/**
 * Create Backblaze B2 storage from environment variables.
 *
 * Expected env vars:
 * - B2_APPLICATION_KEY_ID
 * - B2_APPLICATION_KEY
 * - B2_BUCKET_NAME
 * - B2_REGION (optional, default: us-west-004)
 * - B2_PREFIX (optional)
 * - B2_ENDPOINT (optional, for custom endpoints)
 */
export function createBackblazeB2Storage(): BackblazeB2Storage {
  const applicationKeyId = process.env.B2_APPLICATION_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;
  const bucketName = process.env.B2_BUCKET_NAME;

  if (!applicationKeyId) {
    throw new Error('Missing B2_APPLICATION_KEY_ID environment variable');
  }
  if (!applicationKey) {
    throw new Error('Missing B2_APPLICATION_KEY environment variable');
  }
  if (!bucketName) {
    throw new Error('Missing B2_BUCKET_NAME environment variable');
  }

  return new BackblazeB2Storage({
    applicationKeyId,
    applicationKey,
    bucketName,
    region: process.env.B2_REGION,
    prefix: process.env.B2_PREFIX,
    endpoint: process.env.B2_ENDPOINT,
  });
}
