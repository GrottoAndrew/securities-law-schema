/**
 * S3 Object Lock Storage for Audit Trail
 *
 * Provides WORM (Write Once Read Many) storage for audit checkpoints
 * and evidence using S3 Object Lock in COMPLIANCE mode.
 *
 * COMPLIANCE mode ensures objects cannot be deleted by anyone,
 * including root account, until retention period expires.
 * This meets SEC 17a-4 requirements.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  GetObjectLegalHoldCommand,
  PutObjectLegalHoldCommand,
  type ObjectLockLegalHoldStatus,
  type ObjectLockMode,
  type ObjectLockRetention,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// =============================================================================
// Types
// =============================================================================

export interface S3StorageConfig {
  /** AWS region */
  region: string;
  /** S3 bucket name (must have Object Lock enabled) */
  bucket: string;
  /** Key prefix for audit objects */
  prefix?: string;
  /** Default retention period in days */
  defaultRetentionDays?: number;
  /** Object Lock mode (GOVERNANCE or COMPLIANCE) */
  lockMode?: ObjectLockMode;
}

export interface StoredObject {
  /** S3 object key */
  key: string;
  /** S3 version ID */
  versionId: string;
  /** ETag (MD5 hash) */
  etag: string;
  /** SHA-256 hash of content */
  sha256: string;
  /** Content size in bytes */
  size: number;
  /** Storage timestamp */
  storedAt: Date;
  /** Retention expiry date */
  retentionUntil?: Date;
}

export interface CheckpointExport {
  /** Checkpoint metadata */
  checkpoint: {
    checkpointNumber: number;
    periodStart: string;
    periodEnd: string;
    firstSequenceNumber: string;
    lastSequenceNumber: string;
    eventCount: number;
    merkleRoot: string;
    previousCheckpointId?: string;
    previousMerkleRoot?: string;
  };
  /** Signature data */
  signature: {
    signature: string;
    keyId: string;
    algorithm: string;
    signedAt: string;
  };
  /** Public key for verification */
  publicKey: string;
  /** All events in this checkpoint period */
  events: Array<{
    sequenceNumber: string;
    timestamp: string;
    eventType: string;
    eventCategory: string;
    payload: unknown;
    previousHash: string;
    eventHash: string;
  }>;
  /** Merkle proofs for each event */
  merkleProofs?: Array<{
    leafIndex: number;
    leafHash: string;
    siblings: Array<{
      hash: string;
      position: 'left' | 'right';
    }>;
  }>;
  /** Export metadata */
  exportedAt: string;
  exportVersion: string;
}

export interface RetrievedCheckpoint {
  /** The checkpoint export data */
  data: CheckpointExport;
  /** S3 object metadata */
  storage: StoredObject;
  /** Whether integrity was verified */
  integrityVerified: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Default retention period: 7 years (SEC 17a-4 requirement) */
const DEFAULT_RETENTION_DAYS = 2557; // ~7 years

/** Export format version */
const EXPORT_VERSION = '1.0.0';

// =============================================================================
// S3AuditStorage Class
// =============================================================================

/**
 * S3 storage with Object Lock for immutable audit records.
 */
export class S3AuditStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly retentionDays: number;
  private readonly lockMode: ObjectLockMode;

  constructor(config: S3StorageConfig) {
    this.client = new S3Client({ region: config.region });
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? 'audit/';
    this.retentionDays = config.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS;
    this.lockMode = config.lockMode ?? 'COMPLIANCE';
  }

  /**
   * Store a checkpoint export with Object Lock.
   */
  async storeCheckpoint(
    checkpointNumber: number,
    data: CheckpointExport
  ): Promise<StoredObject> {
    const key = this.getCheckpointKey(checkpointNumber, new Date(data.checkpoint.periodEnd));
    const body = JSON.stringify(data, null, 2);
    const sha256 = this.computeSha256(body);

    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + this.retentionDays);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      ObjectLockMode: this.lockMode,
      ObjectLockRetainUntilDate: retentionDate,
      Metadata: {
        'checkpoint-number': checkpointNumber.toString(),
        'merkle-root': data.checkpoint.merkleRoot,
        'event-count': data.checkpoint.eventCount.toString(),
        'sha256': sha256,
      },
    });

    const response = await this.client.send(command);

    return {
      key,
      versionId: response.VersionId ?? '',
      etag: response.ETag ?? '',
      sha256,
      size: Buffer.byteLength(body),
      storedAt: new Date(),
      retentionUntil: retentionDate,
    };
  }

  /**
   * Store evidence artifact with Object Lock.
   */
  async storeEvidence(
    evidenceId: string,
    content: Buffer | string,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<StoredObject> {
    const key = this.getEvidenceKey(evidenceId);
    const body = typeof content === 'string' ? Buffer.from(content) : content;
    const sha256 = this.computeSha256(body);

    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + this.retentionDays);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      ObjectLockMode: this.lockMode,
      ObjectLockRetainUntilDate: retentionDate,
      Metadata: {
        ...metadata,
        'evidence-id': evidenceId,
        'sha256': sha256,
      },
    });

    const response = await this.client.send(command);

    return {
      key,
      versionId: response.VersionId ?? '',
      etag: response.ETag ?? '',
      sha256,
      size: body.length,
      storedAt: new Date(),
      retentionUntil: retentionDate,
    };
  }

  /**
   * Retrieve a checkpoint export.
   */
  async getCheckpoint(
    checkpointNumber: number,
    periodEnd: Date
  ): Promise<RetrievedCheckpoint> {
    const key = this.getCheckpointKey(checkpointNumber, periodEnd);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const bodyString = await this.streamToString(response.Body as Readable);
    const data = JSON.parse(bodyString) as CheckpointExport;

    // Verify integrity
    const computedSha256 = this.computeSha256(bodyString);
    const storedSha256 = response.Metadata?.['sha256'];
    const integrityVerified = storedSha256 ? computedSha256 === storedSha256 : false;

    return {
      data,
      storage: {
        key,
        versionId: response.VersionId ?? '',
        etag: response.ETag ?? '',
        sha256: computedSha256,
        size: Buffer.byteLength(bodyString),
        storedAt: response.LastModified ?? new Date(),
        retentionUntil: response.ObjectLockRetainUntilDate,
      },
      integrityVerified,
    };
  }

  /**
   * Retrieve evidence artifact.
   */
  async getEvidence(evidenceId: string): Promise<{
    content: Buffer;
    storage: StoredObject;
    integrityVerified: boolean;
  }> {
    const key = this.getEvidenceKey(evidenceId);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const content = await this.streamToBuffer(response.Body as Readable);
    const computedSha256 = this.computeSha256(content);
    const storedSha256 = response.Metadata?.['sha256'];

    return {
      content,
      storage: {
        key,
        versionId: response.VersionId ?? '',
        etag: response.ETag ?? '',
        sha256: computedSha256,
        size: content.length,
        storedAt: response.LastModified ?? new Date(),
        retentionUntil: response.ObjectLockRetainUntilDate,
      },
      integrityVerified: storedSha256 ? computedSha256 === storedSha256 : false,
    };
  }

  /**
   * Apply legal hold to an object (prevents deletion even after retention).
   */
  async applyLegalHold(key: string, versionId?: string): Promise<void> {
    const command = new PutObjectLegalHoldCommand({
      Bucket: this.bucket,
      Key: key,
      VersionId: versionId,
      LegalHold: {
        Status: 'ON' as ObjectLockLegalHoldStatus,
      },
    });

    await this.client.send(command);
  }

  /**
   * Check legal hold status.
   */
  async getLegalHoldStatus(key: string, versionId?: string): Promise<boolean> {
    const command = new GetObjectLegalHoldCommand({
      Bucket: this.bucket,
      Key: key,
      VersionId: versionId,
    });

    const response = await this.client.send(command);
    return response.LegalHold?.Status === 'ON';
  }

  /**
   * Verify object integrity by comparing stored and computed hashes.
   */
  async verifyIntegrity(key: string): Promise<{
    isValid: boolean;
    storedSha256?: string;
    computedSha256: string;
  }> {
    const headCommand = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const headResponse = await this.client.send(headCommand);
    const storedSha256 = headResponse.Metadata?.['sha256'];

    const getCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const getResponse = await this.client.send(getCommand);
    const content = await this.streamToBuffer(getResponse.Body as Readable);
    const computedSha256 = this.computeSha256(content);

    return {
      isValid: storedSha256 ? computedSha256 === storedSha256 : false,
      storedSha256,
      computedSha256,
    };
  }

  /**
   * Get object metadata without downloading content.
   */
  async getObjectMetadata(key: string): Promise<{
    versionId?: string;
    size?: number;
    lastModified?: Date;
    retention?: ObjectLockRetention;
    sha256?: string;
  }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      versionId: response.VersionId,
      size: response.ContentLength,
      lastModified: response.LastModified,
      retention: {
        Mode: response.ObjectLockMode,
        RetainUntilDate: response.ObjectLockRetainUntilDate,
      },
      sha256: response.Metadata?.['sha256'],
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Generate S3 key for a checkpoint.
   * Format: {prefix}checkpoints/YYYY/MM/DD/checkpoint-{number}.json
   */
  private getCheckpointKey(checkpointNumber: number, date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${this.prefix}checkpoints/${year}/${month}/${day}/checkpoint-${checkpointNumber}.json`;
  }

  /**
   * Generate S3 key for evidence.
   * Format: {prefix}evidence/{first2}/{next2}/{id}
   */
  private getEvidenceKey(evidenceId: string): string {
    const cleanId = evidenceId.replace(/-/g, '');
    const prefix1 = cleanId.slice(0, 2);
    const prefix2 = cleanId.slice(2, 4);

    return `${this.prefix}evidence/${prefix1}/${prefix2}/${evidenceId}`;
  }

  /**
   * Compute SHA-256 hash of data.
   */
  private computeSha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Convert readable stream to string.
   */
  private async streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * Convert readable stream to buffer.
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

// =============================================================================
// Export Utilities
// =============================================================================

/**
 * Create a checkpoint export object.
 */
export function createCheckpointExport(
  checkpoint: {
    checkpointNumber: number;
    periodStart: Date;
    periodEnd: Date;
    firstSequenceNumber: bigint;
    lastSequenceNumber: bigint;
    eventCount: number;
    merkleRoot: string;
    previousCheckpointId?: string;
    previousMerkleRoot?: string;
  },
  signature: {
    signature: string;
    keyId: string;
    algorithm: string;
    signedAt: Date;
  },
  publicKey: string,
  events: Array<{
    sequenceNumber: bigint;
    timestamp: Date;
    eventType: string;
    eventCategory: string;
    payload: unknown;
    previousHash: string;
    hash: string;
  }>,
  merkleProofs?: Array<{
    leafIndex: number;
    leafHash: string;
    siblings: Array<{ hash: string; position: 'left' | 'right' }>;
  }>
): CheckpointExport {
  return {
    checkpoint: {
      checkpointNumber: checkpoint.checkpointNumber,
      periodStart: checkpoint.periodStart.toISOString(),
      periodEnd: checkpoint.periodEnd.toISOString(),
      firstSequenceNumber: checkpoint.firstSequenceNumber.toString(),
      lastSequenceNumber: checkpoint.lastSequenceNumber.toString(),
      eventCount: checkpoint.eventCount,
      merkleRoot: checkpoint.merkleRoot,
      previousCheckpointId: checkpoint.previousCheckpointId,
      previousMerkleRoot: checkpoint.previousMerkleRoot,
    },
    signature: {
      signature: signature.signature,
      keyId: signature.keyId,
      algorithm: signature.algorithm,
      signedAt: signature.signedAt.toISOString(),
    },
    publicKey,
    events: events.map((e) => ({
      sequenceNumber: e.sequenceNumber.toString(),
      timestamp: e.timestamp.toISOString(),
      eventType: e.eventType,
      eventCategory: e.eventCategory,
      payload: e.payload,
      previousHash: e.previousHash,
      eventHash: e.hash,
    })),
    merkleProofs,
    exportedAt: new Date().toISOString(),
    exportVersion: EXPORT_VERSION,
  };
}
