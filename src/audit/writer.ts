/**
 * Audit Trail Writer
 *
 * Orchestrates audit event recording with:
 * - Hash chain for sequential integrity
 * - Merkle tree for efficient verification
 * - Cryptographic signing for non-repudiation
 * - S3 export for immutable storage
 */

import type { Pool, PoolClient } from 'pg';
import {
  HashChain,
  computeRecordHash,
  type HashChainRecord,
} from '../core/hash-chain.js';
import {
  MerkleTree,
  type MerkleProof,
} from '../core/merkle-tree.js';
import {
  LocalSigner,
  signCheckpoint,
  type Signature,
  type CheckpointData,
} from '../core/signing.js';
import {
  S3AuditStorage,
  createCheckpointExport,
  type StoredObject,
} from './s3-storage.js';

// =============================================================================
// Types
// =============================================================================

export interface AuditEvent {
  eventType: string;
  eventCategory: EventCategory;
  actorId?: string;
  actorType: ActorType;
  actorIp?: string;
  resourceType?: string;
  resourceId?: string;
  payload: Record<string, unknown>;
}

export type EventCategory =
  | 'authentication'
  | 'authorization'
  | 'evidence'
  | 'control_assessment'
  | 'configuration'
  | 'data_access'
  | 'data_modification'
  | 'system'
  | 'compliance';

export type ActorType = 'user' | 'system' | 'api_key';

export interface RecordedEvent extends AuditEvent {
  id: string;
  sequenceNumber: bigint;
  timestamp: Date;
  previousHash: string;
  eventHash: string;
}

export interface Checkpoint {
  id: string;
  checkpointNumber: number;
  periodStart: Date;
  periodEnd: Date;
  firstSequenceNumber: bigint;
  lastSequenceNumber: bigint;
  eventCount: number;
  merkleRoot: string;
  signature: Signature;
  signingKeyId: string;
  previousCheckpointId?: string;
  previousMerkleRoot?: string;
  s3Bucket?: string;
  s3Key?: string;
  s3VersionId?: string;
}

export interface AuditWriterConfig {
  /** PostgreSQL connection pool */
  db: Pool;
  /** Signing key manager */
  signer: LocalSigner;
  /** S3 storage (optional, for exports) */
  s3Storage?: S3AuditStorage;
  /** Checkpoint interval in events (default: 1000) */
  checkpointInterval?: number;
  /** Auto-checkpoint enabled (default: true) */
  autoCheckpoint?: boolean;
}

export interface WriterStats {
  totalEvents: bigint;
  totalCheckpoints: number;
  lastEventTimestamp?: Date;
  lastCheckpointTimestamp?: Date;
  pendingEventCount: number;
}

// =============================================================================
// AuditWriter Class
// =============================================================================

/**
 * Audit trail writer with database persistence.
 */
export class AuditWriter {
  private readonly db: Pool;
  private readonly signer: LocalSigner;
  private readonly s3Storage?: S3AuditStorage;
  private readonly checkpointInterval: number;
  private readonly autoCheckpoint: boolean;

  private currentSequence: bigint = 0n;
  private currentHash: string = '0'.repeat(64);
  private lastCheckpointSequence: bigint = 0n;
  private lastCheckpointId?: string;
  private lastMerkleRoot?: string;
  private checkpointCount: number = 0;
  private initialized: boolean = false;

  constructor(config: AuditWriterConfig) {
    this.db = config.db;
    this.signer = config.signer;
    this.s3Storage = config.s3Storage;
    this.checkpointInterval = config.checkpointInterval ?? 1000;
    this.autoCheckpoint = config.autoCheckpoint ?? true;
  }

  /**
   * Initialize writer by loading state from database.
   */
  async initialize(): Promise<void> {
    const client = await this.db.connect();
    try {
      // Get latest event
      const eventResult = await client.query<{
        sequence_number: string;
        event_hash: string;
      }>(`
        SELECT sequence_number, event_hash
        FROM audit_events
        ORDER BY sequence_number DESC
        LIMIT 1
      `);

      if (eventResult.rows.length > 0) {
        const row = eventResult.rows[0]!;
        this.currentSequence = BigInt(row.sequence_number);
        this.currentHash = row.event_hash;
      }

      // Get latest checkpoint
      const checkpointResult = await client.query<{
        id: string;
        checkpoint_number: string;
        last_sequence_number: string;
        merkle_root: string;
      }>(`
        SELECT id, checkpoint_number, last_sequence_number, merkle_root
        FROM audit_checkpoints
        ORDER BY checkpoint_number DESC
        LIMIT 1
      `);

      if (checkpointResult.rows.length > 0) {
        const row = checkpointResult.rows[0]!;
        this.lastCheckpointId = row.id;
        this.lastCheckpointSequence = BigInt(row.last_sequence_number);
        this.lastMerkleRoot = row.merkle_root;
        this.checkpointCount = parseInt(row.checkpoint_number, 10);
      }

      this.initialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Record an audit event.
   */
  async recordEvent(event: AuditEvent): Promise<RecordedEvent> {
    if (!this.initialized) {
      throw new Error('AuditWriter not initialized. Call initialize() first.');
    }

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const nextSequence = this.currentSequence + 1n;
      const timestamp = new Date();

      // Compute hash
      const eventHash = computeRecordHash({
        sequenceNumber: nextSequence,
        timestamp,
        eventType: event.eventType,
        payload: event.payload,
        previousHash: this.currentHash,
      });

      // Insert event
      const result = await client.query<{ id: string }>(`
        INSERT INTO audit_events (
          sequence_number,
          created_at,
          event_type,
          event_category,
          actor_id,
          actor_type,
          actor_ip,
          resource_type,
          resource_id,
          payload,
          previous_hash,
          event_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        nextSequence.toString(),
        timestamp,
        event.eventType,
        event.eventCategory,
        event.actorId,
        event.actorType,
        event.actorIp,
        event.resourceType,
        event.resourceId,
        JSON.stringify(event.payload),
        this.currentHash,
        eventHash,
      ]);

      await client.query('COMMIT');

      // Update state
      this.currentSequence = nextSequence;
      this.currentHash = eventHash;

      const recordedEvent: RecordedEvent = {
        ...event,
        id: result.rows[0]!.id,
        sequenceNumber: nextSequence,
        timestamp,
        previousHash: this.currentHash,
        eventHash,
      };

      // Check if auto-checkpoint needed
      if (this.autoCheckpoint) {
        const pendingCount = Number(this.currentSequence - this.lastCheckpointSequence);
        if (pendingCount >= this.checkpointInterval) {
          await this.createCheckpoint();
        }
      }

      return recordedEvent;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record multiple events in a single transaction.
   */
  async recordEvents(events: AuditEvent[]): Promise<RecordedEvent[]> {
    if (!this.initialized) {
      throw new Error('AuditWriter not initialized. Call initialize() first.');
    }

    if (events.length === 0) {
      return [];
    }

    const client = await this.db.connect();
    const recordedEvents: RecordedEvent[] = [];

    try {
      await client.query('BEGIN');

      let sequence = this.currentSequence;
      let prevHash = this.currentHash;

      for (const event of events) {
        sequence += 1n;
        const timestamp = new Date();

        const eventHash = computeRecordHash({
          sequenceNumber: sequence,
          timestamp,
          eventType: event.eventType,
          payload: event.payload,
          previousHash: prevHash,
        });

        const result = await client.query<{ id: string }>(`
          INSERT INTO audit_events (
            sequence_number,
            created_at,
            event_type,
            event_category,
            actor_id,
            actor_type,
            actor_ip,
            resource_type,
            resource_id,
            payload,
            previous_hash,
            event_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          sequence.toString(),
          timestamp,
          event.eventType,
          event.eventCategory,
          event.actorId,
          event.actorType,
          event.actorIp,
          event.resourceType,
          event.resourceId,
          JSON.stringify(event.payload),
          prevHash,
          eventHash,
        ]);

        recordedEvents.push({
          ...event,
          id: result.rows[0]!.id,
          sequenceNumber: sequence,
          timestamp,
          previousHash: prevHash,
          eventHash,
        });

        prevHash = eventHash;
      }

      await client.query('COMMIT');

      this.currentSequence = sequence;
      this.currentHash = prevHash;

      // Check auto-checkpoint
      if (this.autoCheckpoint) {
        const pendingCount = Number(this.currentSequence - this.lastCheckpointSequence);
        if (pendingCount >= this.checkpointInterval) {
          await this.createCheckpoint();
        }
      }

      return recordedEvents;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a checkpoint for events since last checkpoint.
   */
  async createCheckpoint(): Promise<Checkpoint> {
    if (!this.initialized) {
      throw new Error('AuditWriter not initialized. Call initialize() first.');
    }

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const firstSequence = this.lastCheckpointSequence + 1n;
      const lastSequence = this.currentSequence;

      if (lastSequence < firstSequence) {
        throw new Error('No events to checkpoint');
      }

      // Fetch events for checkpoint
      const eventsResult = await client.query<{
        sequence_number: string;
        created_at: Date;
        event_type: string;
        event_category: string;
        payload: unknown;
        previous_hash: string;
        event_hash: string;
      }>(`
        SELECT sequence_number, created_at, event_type, event_category,
               payload, previous_hash, event_hash
        FROM audit_events
        WHERE sequence_number >= $1 AND sequence_number <= $2
        ORDER BY sequence_number
      `, [firstSequence.toString(), lastSequence.toString()]);

      const events = eventsResult.rows;
      const eventCount = events.length;

      if (eventCount === 0) {
        throw new Error('No events found for checkpoint range');
      }

      // Build Merkle tree from event hashes
      const eventHashes = events.map((e) => e.event_hash);
      const merkleTree = new MerkleTree(eventHashes);
      const merkleRoot = merkleTree.getRoot();

      // Determine period
      const periodStart = events[0]!.created_at;
      const periodEnd = events[events.length - 1]!.created_at;

      // Create checkpoint data for signing
      const checkpointNumber = this.checkpointCount + 1;
      const checkpointData: CheckpointData = {
        checkpointNumber,
        periodStart,
        periodEnd,
        firstSequenceNumber: firstSequence,
        lastSequenceNumber: lastSequence,
        eventCount,
        merkleRoot,
        previousCheckpointId: this.lastCheckpointId,
        previousMerkleRoot: this.lastMerkleRoot,
      };

      // Sign checkpoint
      const signature = signCheckpoint(checkpointData, this.signer);
      const keyPair = this.signer.getActiveKeyPair();

      // Insert checkpoint
      const checkpointResult = await client.query<{ id: string }>(`
        INSERT INTO audit_checkpoints (
          checkpoint_number,
          period_start,
          period_end,
          first_sequence_number,
          last_sequence_number,
          event_count,
          merkle_root,
          signature,
          signature_algorithm,
          signing_key_id,
          previous_checkpoint_id,
          previous_merkle_root
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        checkpointNumber,
        periodStart,
        periodEnd,
        firstSequence.toString(),
        lastSequence.toString(),
        eventCount,
        merkleRoot,
        Buffer.from(signature.signature, 'base64'),
        signature.algorithm,
        signature.keyId,
        this.lastCheckpointId,
        this.lastMerkleRoot,
      ]);

      const checkpointId = checkpointResult.rows[0]!.id;

      // Update events with checkpoint reference and Merkle leaf index
      for (let i = 0; i < events.length; i++) {
        await client.query(`
          UPDATE audit_events
          SET checkpoint_id = $1, merkle_leaf_index = $2
          WHERE sequence_number = $3
        `, [checkpointId, i, events[i]!.sequence_number]);
      }

      await client.query('COMMIT');

      // Export to S3 if configured
      let s3Result: StoredObject | undefined;
      if (this.s3Storage && keyPair) {
        // Generate Merkle proofs for all events
        const merkleProofs: MerkleProof[] = [];
        for (let i = 0; i < eventCount; i++) {
          const proof = merkleTree.generateProof(i);
          if (proof) {
            merkleProofs.push(proof);
          }
        }

        const exportData = createCheckpointExport(
          checkpointData,
          signature,
          keyPair.publicKeyPem,
          events.map((e) => ({
            sequenceNumber: BigInt(e.sequence_number),
            timestamp: e.created_at,
            eventType: e.event_type,
            eventCategory: e.event_category as EventCategory,
            payload: e.payload,
            previousHash: e.previous_hash,
            hash: e.event_hash,
          })),
          merkleProofs
        );

        s3Result = await this.s3Storage.storeCheckpoint(checkpointNumber, exportData);

        // Update checkpoint with S3 reference
        await client.query(`
          UPDATE audit_checkpoints
          SET s3_bucket = $1, s3_key = $2, s3_version_id = $3
          WHERE id = $4
        `, [
          s3Result.key.split('/')[0], // This is a simplification
          s3Result.key,
          s3Result.versionId,
          checkpointId,
        ]);
      }

      // Update state
      this.lastCheckpointId = checkpointId;
      this.lastCheckpointSequence = lastSequence;
      this.lastMerkleRoot = merkleRoot;
      this.checkpointCount = checkpointNumber;

      return {
        id: checkpointId,
        checkpointNumber,
        periodStart,
        periodEnd,
        firstSequenceNumber: firstSequence,
        lastSequenceNumber: lastSequence,
        eventCount,
        merkleRoot,
        signature,
        signingKeyId: signature.keyId,
        previousCheckpointId: checkpointData.previousCheckpointId,
        previousMerkleRoot: checkpointData.previousMerkleRoot,
        s3Bucket: s3Result?.key.split('/')[0],
        s3Key: s3Result?.key,
        s3VersionId: s3Result?.versionId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get writer statistics.
   */
  async getStats(): Promise<WriterStats> {
    const client = await this.db.connect();
    try {
      const eventResult = await client.query<{
        count: string;
        max_timestamp: Date | null;
      }>(`
        SELECT COUNT(*) as count, MAX(created_at) as max_timestamp
        FROM audit_events
        WHERE sequence_number > 0
      `);

      const checkpointResult = await client.query<{
        count: string;
        max_timestamp: Date | null;
      }>(`
        SELECT COUNT(*) as count, MAX(created_at) as max_timestamp
        FROM audit_checkpoints
      `);

      const pendingCount = Number(this.currentSequence - this.lastCheckpointSequence);

      return {
        totalEvents: BigInt(eventResult.rows[0]?.count ?? '0'),
        totalCheckpoints: parseInt(checkpointResult.rows[0]?.count ?? '0', 10),
        lastEventTimestamp: eventResult.rows[0]?.max_timestamp ?? undefined,
        lastCheckpointTimestamp: checkpointResult.rows[0]?.max_timestamp ?? undefined,
        pendingEventCount: pendingCount,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify hash chain integrity for a range of events.
   */
  async verifyChain(startSeq?: bigint, endSeq?: bigint): Promise<{
    isValid: boolean;
    validatedCount: number;
    invalidAtSequence?: bigint;
    error?: string;
  }> {
    const client = await this.db.connect();
    try {
      const start = startSeq ?? 0n;
      const end = endSeq ?? this.currentSequence;

      const result = await client.query<{
        sequence_number: string;
        created_at: Date;
        event_type: string;
        payload: unknown;
        previous_hash: string;
        event_hash: string;
      }>(`
        SELECT sequence_number, created_at, event_type, payload,
               previous_hash, event_hash
        FROM audit_events
        WHERE sequence_number >= $1 AND sequence_number <= $2
        ORDER BY sequence_number
      `, [start.toString(), end.toString()]);

      let prevHash = start === 0n ? '0'.repeat(64) : '';
      let validatedCount = 0;

      for (const row of result.rows) {
        const seq = BigInt(row.sequence_number);

        // Compute expected hash
        const expectedHash = computeRecordHash({
          sequenceNumber: seq,
          timestamp: row.created_at,
          eventType: row.event_type,
          payload: row.payload,
          previousHash: row.previous_hash,
        });

        // Verify hash
        if (row.event_hash !== expectedHash) {
          return {
            isValid: false,
            validatedCount,
            invalidAtSequence: seq,
            error: 'Event hash mismatch',
          };
        }

        // Verify chain linkage (skip for first in range if not genesis)
        if (prevHash && row.previous_hash !== prevHash) {
          return {
            isValid: false,
            validatedCount,
            invalidAtSequence: seq,
            error: 'Chain linkage broken',
          };
        }

        prevHash = row.event_hash;
        validatedCount++;
      }

      return {
        isValid: true,
        validatedCount,
      };
    } finally {
      client.release();
    }
  }
}
