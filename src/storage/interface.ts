/**
 * Provider-agnostic storage interface for immutable audit data.
 *
 * This abstraction allows swapping storage backends:
 * - PostgreSQL-only (demo/development)
 * - AWS S3 with Object Lock (production SEC 17a-4)
 * - Azure Blob Immutable Storage
 * - GCP Cloud Storage with Bucket Lock
 */

export interface RetentionPolicy {
  /** Retention period in days (e.g., 2555 for 7 years) */
  retentionDays: number;
  /** WORM mode: 'compliance' cannot be deleted by anyone, 'governance' can be bypassed */
  mode: 'compliance' | 'governance';
}

export interface StoredObject {
  /** Unique key/path for the object */
  key: string;
  /** SHA-256 hash of the stored content */
  contentHash: string;
  /** Size in bytes */
  size: number;
  /** When the object was stored */
  storedAt: Date;
  /** Retention policy applied (if any) */
  retention?: RetentionPolicy;
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
}

export interface ObjectMetadata {
  /** SHA-256 hash of the content */
  contentHash: string;
  /** Size in bytes */
  size: number;
  /** When stored */
  storedAt: Date;
  /** Content type (MIME) */
  contentType?: string;
  /** Retention policy (if applicable) */
  retention?: RetentionPolicy;
  /** Whether legal hold is active */
  legalHold?: boolean;
}

export interface StorageCapabilities {
  /** Supports WORM (Write Once Read Many) */
  supportsWORM: boolean;
  /** Supports legal hold */
  supportsLegalHold: boolean;
  /** Supports retention policies */
  supportsRetention: boolean;
  /** Maximum object size in bytes */
  maxObjectSize: number;
  /** Provider name for logging */
  providerName: string;
}

/**
 * Abstract interface for immutable storage providers.
 *
 * Implementations must ensure:
 * 1. Content integrity (SHA-256 verification)
 * 2. Immutability guarantees (per provider capabilities)
 * 3. Audit-friendly metadata
 */
export interface ImmutableStorage {
  /**
   * Store an object with optional retention policy.
   *
   * @param key - Unique identifier (e.g., 'checkpoints/2024-01-20/cp-123.json')
   * @param data - Content to store
   * @param options - Storage options including retention
   * @returns Stored object metadata
   * @throws StorageError if storage fails
   */
  store(
    key: string,
    data: Buffer,
    options?: {
      retention?: RetentionPolicy;
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StoredObject>;

  /**
   * Retrieve an object by key.
   *
   * @param key - Object key
   * @returns Object data and metadata
   * @throws StorageError if not found or retrieval fails
   */
  retrieve(key: string): Promise<{ data: Buffer; metadata: ObjectMetadata }>;

  /**
   * Verify object integrity by recomputing hash.
   *
   * @param key - Object key
   * @returns true if content matches stored hash
   * @throws StorageError if verification fails
   */
  verifyIntegrity(key: string): Promise<boolean>;

  /**
   * Check if an object exists.
   *
   * @param key - Object key
   * @returns true if object exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * List objects with optional prefix filter.
   *
   * @param prefix - Key prefix to filter (e.g., 'checkpoints/')
   * @param limit - Maximum results to return
   * @returns Array of object keys
   */
  list(prefix?: string, limit?: number): Promise<string[]>;

  /**
   * Apply legal hold to an object (if supported).
   *
   * @param key - Object key
   * @throws StorageError if not supported or fails
   */
  applyLegalHold?(key: string): Promise<void>;

  /**
   * Remove legal hold from an object (if supported).
   *
   * @param key - Object key
   * @throws StorageError if not supported or fails
   */
  removeLegalHold?(key: string): Promise<void>;

  /**
   * Get storage provider capabilities.
   */
  getCapabilities(): StorageCapabilities;

  /**
   * Health check for the storage backend.
   *
   * @returns true if storage is accessible
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Error class for storage operations.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: StorageErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export type StorageErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INTEGRITY_FAILED'
  | 'PERMISSION_DENIED'
  | 'RETENTION_ACTIVE'
  | 'LEGAL_HOLD_ACTIVE'
  | 'NOT_SUPPORTED'
  | 'CONNECTION_FAILED'
  | 'UNKNOWN';
