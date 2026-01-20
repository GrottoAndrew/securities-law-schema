/**
 * Storage Module
 *
 * Provides immutable storage implementations for SEC 17a-4 compliance.
 *
 * Quick Start:
 * ```typescript
 * import { createStorage } from './storage';
 *
 * const { storage, isDemo } = await createStorage();
 *
 * if (isDemo) {
 *   console.warn('Running in demo mode - no WORM compliance');
 * }
 *
 * await storage.store('evidence/doc.pdf', buffer);
 * ```
 *
 * Provider Selection:
 * - Set STORAGE_PROVIDER env var to 's3', 'azure', 'backblaze', or 'postgres'
 * - Or auto-detect based on available credentials
 *
 * For production SEC 17a-4 compliance, use:
 * - S3 Object Lock (COMPLIANCE mode)
 * - Azure Blob Immutable Storage
 *
 * For development/demo only:
 * - PostgreSQL (no WORM)
 * - Backblaze B2 (no WORM)
 */

// Interface and types
export {
  ImmutableStorage,
  StoredObject,
  ObjectMetadata,
  RetentionPolicy,
  StorageCapabilities,
  StorageError,
  type StorageErrorCode,
} from './interface.js';

// Factory
export {
  createStorage,
  createStorageWithHealthCheck,
  getStorageProviderInfo,
  validateStorageConfig,
  checkComplianceStatus,
  type StorageProviderType,
  type StorageFactoryConfig,
  type StorageFactoryResult,
} from './factory.js';

// Providers (for direct instantiation)
export { S3ObjectLockStorage, createS3ObjectLockStorage } from './providers/s3-object-lock.js';
export type { S3ObjectLockConfig } from './providers/s3-object-lock.js';

export { AzureImmutableStorage, createAzureImmutableStorage } from './providers/azure-immutable.js';
export type { AzureImmutableConfig } from './providers/azure-immutable.js';

export { BackblazeB2Storage, createBackblazeB2Storage } from './providers/backblaze-b2.js';
export type { BackblazeB2Config } from './providers/backblaze-b2.js';

export { PostgresOnlyStorage, createPostgresStorage } from './providers/postgres-only.js';
