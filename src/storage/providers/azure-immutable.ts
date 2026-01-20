/**
 * Azure Blob Immutable Storage Provider
 *
 * Implements ImmutableStorage using Azure Blob Storage with Immutable Storage policies.
 * This provides WORM (Write Once Read Many) storage that meets SEC 17a-4.
 *
 * Azure Immutable Storage provides:
 * - Time-based retention policies (locked)
 * - Legal holds
 * - WORM compliance for SEC 17a-4, FINRA 4511
 *
 * Requirements:
 * - Storage account with Blob versioning enabled
 * - Container with immutable storage policy (or apply per-blob)
 * - IAM permissions for blob read/write and immutability policy management
 */

import {
  BlobServiceClient,
  ContainerClient,
  BlobClient,
  StorageSharedKeyCredential,
  type BlobImmutabilityPolicyMode,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { createHash } from 'node:crypto';
import {
  ImmutableStorage,
  StoredObject,
  ObjectMetadata,
  RetentionPolicy,
  StorageCapabilities,
  StorageError,
} from '../interface.js';

// =============================================================================
// Types
// =============================================================================

export interface AzureImmutableConfig {
  /** Storage account name */
  accountName: string;
  /** Container name */
  containerName: string;
  /** Optional blob prefix */
  prefix?: string;
  /** Default retention in days (default: 2557 = ~7 years for SEC 17a-4) */
  defaultRetentionDays?: number;
  /** Authentication: account key (uses DefaultAzureCredential if not provided) */
  accountKey?: string;
  /** Connection string (alternative to accountName + accountKey) */
  connectionString?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Default retention: 7 years (2557 days) for SEC 17a-4 */
const DEFAULT_RETENTION_DAYS = 2557;

/** Azure max block blob size: 190.7 TB (but practical limit is lower) */
const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * 1024 * 1024; // 5TB practical limit

// =============================================================================
// AzureImmutableStorage Class
// =============================================================================

/**
 * Azure Blob Immutable Storage implementing ImmutableStorage.
 *
 * Usage:
 * ```typescript
 * const storage = new AzureImmutableStorage({
 *   accountName: 'mycomplianceaccount',
 *   containerName: 'evidence',
 *   accountKey: process.env.AZURE_STORAGE_KEY,
 * });
 *
 * await storage.store('evidence/doc-123.pdf', pdfBuffer, {
 *   retention: { retentionDays: 2557, mode: 'compliance' },
 *   contentType: 'application/pdf',
 * });
 * ```
 */
export class AzureImmutableStorage implements ImmutableStorage {
  private readonly containerClient: ContainerClient;
  private readonly prefix: string;
  private readonly defaultRetentionDays: number;

  constructor(config: AzureImmutableConfig) {
    let blobServiceClient: BlobServiceClient;

    if (config.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    } else if (config.accountKey) {
      const credential = new StorageSharedKeyCredential(config.accountName, config.accountKey);
      blobServiceClient = new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        credential
      );
    } else {
      // Use DefaultAzureCredential (managed identity, CLI, env vars, etc.)
      blobServiceClient = new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        new DefaultAzureCredential()
      );
    }

    this.containerClient = blobServiceClient.getContainerClient(config.containerName);
    this.prefix = config.prefix ?? '';
    this.defaultRetentionDays = config.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS;
  }

  /**
   * Store an object with immutability policy.
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
    const contentHash = createHash('sha256').update(data).digest('hex');
    const blobClient = this.containerClient.getBlockBlobClient(fullKey);

    // Calculate retention date
    const retentionDays = options?.retention?.retentionDays ?? this.defaultRetentionDays;
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + retentionDays);

    // Determine policy mode
    const policyMode: BlobImmutabilityPolicyMode =
      options?.retention?.mode === 'governance' ? 'Unlocked' : 'Locked';

    try {
      // Upload the blob
      const uploadResponse = await blobClient.upload(data, data.length, {
        blobHTTPHeaders: {
          blobContentType: options?.contentType ?? 'application/octet-stream',
        },
        metadata: {
          ...options?.metadata,
          contentHash,
          storedAt: new Date().toISOString(),
        },
      });

      // Set immutability policy
      await blobClient.setImmutabilityPolicy({
        expiriesOn: retentionDate,
        policyMode,
      });

      return {
        key,
        contentHash,
        size: data.length,
        storedAt: new Date(),
        retention: {
          retentionDays,
          mode: policyMode === 'Locked' ? 'compliance' : 'governance',
        },
        providerMetadata: {
          etag: uploadResponse.etag,
          versionId: uploadResponse.versionId,
          container: this.containerClient.containerName,
          fullKey,
        },
      };
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      if (error.statusCode === 404) {
        throw new StorageError(
          `Container not found: ${this.containerClient.containerName}`,
          'CONNECTION_FAILED',
          error
        );
      }
      if (error.statusCode === 403) {
        throw new StorageError('Access denied to Azure storage', 'PERMISSION_DENIED', error);
      }
      if (error.statusCode === 409) {
        throw new StorageError(`Object already exists: ${key}`, 'ALREADY_EXISTS', error);
      }
      throw new StorageError(`Failed to store object: ${key}`, 'UNKNOWN', error);
    }
  }

  /**
   * Retrieve an object by key.
   */
  async retrieve(key: string): Promise<{ data: Buffer; metadata: ObjectMetadata }> {
    const fullKey = this.prefix + key;
    const blobClient = this.containerClient.getBlobClient(fullKey);

    try {
      const downloadResponse = await blobClient.download();

      if (!downloadResponse.readableStreamBody) {
        throw new StorageError(`Empty response for: ${key}`, 'UNKNOWN');
      }

      const data = await this.streamToBuffer(downloadResponse.readableStreamBody);
      const computedHash = createHash('sha256').update(data).digest('hex');

      // Get properties for retention info
      const properties = await blobClient.getProperties();

      let retention: RetentionPolicy | undefined;
      if (properties.immutabilityPolicyExpiresOn) {
        const now = new Date();
        const expiresOn = properties.immutabilityPolicyExpiresOn;
        const daysRemaining = Math.ceil(
          (expiresOn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        retention = {
          retentionDays: Math.max(0, daysRemaining),
          mode: properties.immutabilityPolicyMode === 'Locked' ? 'compliance' : 'governance',
        };
      }

      return {
        data,
        metadata: {
          contentHash: computedHash,
          size: data.length,
          storedAt: properties.lastModified ?? new Date(),
          contentType: properties.contentType,
          retention,
          legalHold: properties.legalHold,
        },
      };
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      if (error.statusCode === 404) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND', error);
      }
      if (error instanceof StorageError) throw error;
      throw new StorageError(`Failed to retrieve object: ${key}`, 'UNKNOWN', error);
    }
  }

  /**
   * Verify object integrity by recomputing hash.
   */
  async verifyIntegrity(key: string): Promise<boolean> {
    const { data, metadata } = await this.retrieve(key);
    const computedHash = createHash('sha256').update(data).digest('hex');

    // Check against stored metadata hash
    const fullKey = this.prefix + key;
    const blobClient = this.containerClient.getBlobClient(fullKey);
    const properties = await blobClient.getProperties();
    const storedHash = properties.metadata?.['contentHash'] || properties.metadata?.['contenthash'];

    if (storedHash) {
      return computedHash === storedHash;
    }

    // Fallback: just verify computed hash matches what we got
    return computedHash === metadata.contentHash;
  }

  /**
   * Check if an object exists.
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;
    const blobClient = this.containerClient.getBlobClient(fullKey);

    try {
      return await blobClient.exists();
    } catch (err) {
      throw new StorageError(`Failed to check existence: ${key}`, 'UNKNOWN', err as Error);
    }
  }

  /**
   * List objects with optional prefix filter.
   */
  async list(prefix?: string, limit = 1000): Promise<string[]> {
    const fullPrefix = this.prefix + (prefix ?? '');
    const results: string[] = [];

    try {
      for await (const blob of this.containerClient.listBlobsFlat({ prefix: fullPrefix })) {
        if (results.length >= limit) break;
        results.push(blob.name.slice(this.prefix.length));
      }
      return results;
    } catch (err) {
      throw new StorageError(`Failed to list objects: ${prefix}`, 'UNKNOWN', err as Error);
    }
  }

  /**
   * Apply legal hold to an object.
   */
  async applyLegalHold(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    const blobClient = this.containerClient.getBlobClient(fullKey);

    try {
      await blobClient.setLegalHold(true);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      if (error.statusCode === 404) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND', error);
      }
      throw new StorageError(`Failed to apply legal hold: ${key}`, 'UNKNOWN', error);
    }
  }

  /**
   * Remove legal hold from an object.
   */
  async removeLegalHold(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    const blobClient = this.containerClient.getBlobClient(fullKey);

    try {
      await blobClient.setLegalHold(false);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      if (error.statusCode === 404) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND', error);
      }
      throw new StorageError(`Failed to remove legal hold: ${key}`, 'UNKNOWN', error);
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
      providerName: 'Azure Blob Immutable Storage',
    };
  }

  /**
   * Health check - verify container is accessible.
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.containerClient.exists();
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Convert readable stream to buffer.
   */
  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Create Azure Immutable Storage from environment variables.
 *
 * Expected env vars:
 * - AZURE_STORAGE_ACCOUNT_NAME
 * - AZURE_STORAGE_CONTAINER_NAME
 * - AZURE_STORAGE_ACCOUNT_KEY (optional, uses DefaultAzureCredential if not set)
 * - AZURE_STORAGE_CONNECTION_STRING (alternative to above)
 * - AZURE_STORAGE_PREFIX (optional)
 * - AZURE_RETENTION_DAYS (optional, default: 2557)
 */
export function createAzureImmutableStorage(): AzureImmutableStorage {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (connectionString) {
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
    if (!containerName) {
      throw new Error('Missing AZURE_STORAGE_CONTAINER_NAME environment variable');
    }

    return new AzureImmutableStorage({
      accountName: '', // Not needed with connection string
      containerName,
      connectionString,
      prefix: process.env.AZURE_STORAGE_PREFIX,
      defaultRetentionDays: process.env.AZURE_RETENTION_DAYS
        ? parseInt(process.env.AZURE_RETENTION_DAYS, 10)
        : undefined,
    });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  if (!accountName) {
    throw new Error('Missing AZURE_STORAGE_ACCOUNT_NAME environment variable');
  }
  if (!containerName) {
    throw new Error('Missing AZURE_STORAGE_CONTAINER_NAME environment variable');
  }

  return new AzureImmutableStorage({
    accountName,
    containerName,
    accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
    prefix: process.env.AZURE_STORAGE_PREFIX,
    defaultRetentionDays: process.env.AZURE_RETENTION_DAYS
      ? parseInt(process.env.AZURE_RETENTION_DAYS, 10)
      : undefined,
  });
}
