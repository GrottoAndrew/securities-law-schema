/**
 * Hash Chain Implementation
 *
 * Provides cryptographic hash chain for audit trail integrity.
 * Each record contains the hash of the previous record, forming
 * a tamper-evident chain.
 *
 * Hash computation: SHA-256(sequence || timestamp || eventType || payload || previousHash)
 */

import { createHash, timingSafeEqual } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

export interface HashChainRecord {
  sequenceNumber: bigint;
  timestamp: Date;
  eventType: string;
  payload: unknown;
  previousHash: string;
  hash: string;
}

export interface HashChainInput {
  sequenceNumber: bigint;
  timestamp: Date;
  eventType: string;
  payload: unknown;
  previousHash: string;
}

export interface ChainValidationResult {
  isValid: boolean;
  validatedCount: number;
  invalidAtSequence?: bigint;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
}

export interface GenesisConfig {
  timestamp?: Date;
  version?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Constants
// =============================================================================

/** SHA-256 produces 64 hex characters */
export const HASH_LENGTH = 64;

/** Genesis block previous hash (all zeros) */
export const GENESIS_PREVIOUS_HASH = '0'.repeat(HASH_LENGTH);

/** Default genesis timestamp */
const DEFAULT_GENESIS_TIMESTAMP = new Date('2026-01-20T00:00:00.000Z');

// =============================================================================
// Hash Computation
// =============================================================================

/**
 * Compute SHA-256 hash of input data.
 * Uses canonical JSON serialization for objects.
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Canonicalize payload for hashing.
 * Ensures deterministic JSON serialization.
 */
export function canonicalize(payload: unknown): string {
  return JSON.stringify(payload, (_, value) => {
    // Sort object keys for deterministic ordering
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = (value as Record<string, unknown>)[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

/**
 * Compute hash for a chain record.
 *
 * Format: SHA-256(sequence || timestamp || eventType || canonicalPayload || previousHash)
 *
 * Using || as concatenation with | delimiter for clarity.
 */
export function computeRecordHash(input: HashChainInput): string {
  const components = [
    input.sequenceNumber.toString(),
    input.timestamp.toISOString(),
    input.eventType,
    canonicalize(input.payload),
    input.previousHash,
  ];

  const preimage = components.join('|');
  return sha256(preimage);
}

// =============================================================================
// HashChain Class
// =============================================================================

/**
 * In-memory hash chain for audit trail.
 *
 * This class maintains an in-memory representation of the hash chain.
 * For persistence, use HashChainPersistence with a database backend.
 */
export class HashChain {
  private records: HashChainRecord[] = [];
  private currentHash: string;
  private currentSequence: bigint;

  constructor(genesisConfig?: GenesisConfig) {
    const genesis = this.createGenesis(genesisConfig);
    this.records.push(genesis);
    this.currentHash = genesis.hash;
    this.currentSequence = genesis.sequenceNumber;
  }

  /**
   * Create the genesis (first) record in the chain.
   */
  private createGenesis(config?: GenesisConfig): HashChainRecord {
    const timestamp = config?.timestamp ?? DEFAULT_GENESIS_TIMESTAMP;
    const payload = {
      genesis: true,
      version: config?.version ?? '1.0.0',
      timestamp: timestamp.toISOString(),
      ...config?.metadata,
    };

    const input: HashChainInput = {
      sequenceNumber: 0n,
      timestamp,
      eventType: 'system.genesis',
      payload,
      previousHash: GENESIS_PREVIOUS_HASH,
    };

    return {
      ...input,
      hash: computeRecordHash(input),
    };
  }

  /**
   * Append a new record to the chain.
   */
  append(eventType: string, payload: unknown, timestamp?: Date): HashChainRecord {
    const nextSequence = this.currentSequence + 1n;
    const recordTimestamp = timestamp ?? new Date();

    const input: HashChainInput = {
      sequenceNumber: nextSequence,
      timestamp: recordTimestamp,
      eventType,
      payload,
      previousHash: this.currentHash,
    };

    const record: HashChainRecord = {
      ...input,
      hash: computeRecordHash(input),
    };

    this.records.push(record);
    this.currentHash = record.hash;
    this.currentSequence = nextSequence;

    return record;
  }

  /**
   * Get the current (latest) hash in the chain.
   */
  getCurrentHash(): string {
    return this.currentHash;
  }

  /**
   * Get the current sequence number.
   */
  getCurrentSequence(): bigint {
    return this.currentSequence;
  }

  /**
   * Get a record by sequence number.
   */
  getRecord(sequenceNumber: bigint): HashChainRecord | undefined {
    return this.records.find((r) => r.sequenceNumber === sequenceNumber);
  }

  /**
   * Get all records in the chain.
   */
  getAllRecords(): readonly HashChainRecord[] {
    return this.records;
  }

  /**
   * Get records in a range (inclusive).
   */
  getRecordRange(startSeq: bigint, endSeq: bigint): HashChainRecord[] {
    return this.records.filter(
      (r) => r.sequenceNumber >= startSeq && r.sequenceNumber <= endSeq
    );
  }

  /**
   * Get the genesis record.
   */
  getGenesis(): HashChainRecord {
    const genesis = this.records[0];
    if (!genesis) {
      throw new Error('Chain has no genesis record');
    }
    return genesis;
  }

  /**
   * Get the latest record.
   */
  getLatest(): HashChainRecord {
    const latest = this.records[this.records.length - 1];
    if (!latest) {
      throw new Error('Chain is empty');
    }
    return latest;
  }

  /**
   * Get chain length (including genesis).
   */
  length(): number {
    return this.records.length;
  }

  /**
   * Validate the entire chain integrity.
   */
  validate(): ChainValidationResult {
    return validateChain(this.records);
  }

  /**
   * Validate a range of the chain.
   */
  validateRange(startSeq: bigint, endSeq: bigint): ChainValidationResult {
    const range = this.getRecordRange(startSeq, endSeq);
    if (range.length === 0) {
      return {
        isValid: false,
        validatedCount: 0,
        error: 'No records in specified range',
      };
    }
    return validateChain(range, startSeq > 0n);
  }

  /**
   * Export chain to JSON.
   */
  toJSON(): object {
    return {
      version: '1.0.0',
      currentHash: this.currentHash,
      currentSequence: this.currentSequence.toString(),
      recordCount: this.records.length,
      records: this.records.map((r) => ({
        ...r,
        sequenceNumber: r.sequenceNumber.toString(),
        timestamp: r.timestamp.toISOString(),
      })),
    };
  }

  /**
   * Import chain from JSON.
   */
  static fromJSON(json: {
    records: Array<{
      sequenceNumber: string;
      timestamp: string;
      eventType: string;
      payload: unknown;
      previousHash: string;
      hash: string;
    }>;
  }): HashChain {
    if (!json.records || json.records.length === 0) {
      throw new Error('Invalid chain data: no records');
    }

    const chain = new HashChain();
    chain.records = []; // Clear default genesis

    for (const record of json.records) {
      chain.records.push({
        sequenceNumber: BigInt(record.sequenceNumber),
        timestamp: new Date(record.timestamp),
        eventType: record.eventType,
        payload: record.payload,
        previousHash: record.previousHash,
        hash: record.hash,
      });
    }

    const latest = chain.records[chain.records.length - 1];
    if (!latest) {
      throw new Error('Invalid chain data: empty after parsing');
    }

    chain.currentHash = latest.hash;
    chain.currentSequence = latest.sequenceNumber;

    // Validate imported chain
    const validation = chain.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid chain data: ${validation.error ?? 'validation failed'}`);
    }

    return chain;
  }
}

// =============================================================================
// Chain Validation
// =============================================================================

/**
 * Validate a sequence of hash chain records.
 *
 * @param records - Records to validate (must be in sequence order)
 * @param skipGenesisCheck - If true, don't validate that first record is genesis
 */
export function validateChain(
  records: HashChainRecord[],
  skipGenesisCheck = false
): ChainValidationResult {
  if (records.length === 0) {
    return {
      isValid: false,
      validatedCount: 0,
      error: 'Empty chain',
    };
  }

  const firstRecord = records[0];
  if (!firstRecord) {
    return {
      isValid: false,
      validatedCount: 0,
      error: 'No first record',
    };
  }

  // Validate genesis if this is the start of the chain
  if (!skipGenesisCheck) {
    if (firstRecord.sequenceNumber !== 0n) {
      return {
        isValid: false,
        validatedCount: 0,
        invalidAtSequence: firstRecord.sequenceNumber,
        error: 'First record must be genesis (sequence 0)',
      };
    }

    if (firstRecord.previousHash !== GENESIS_PREVIOUS_HASH) {
      return {
        isValid: false,
        validatedCount: 0,
        invalidAtSequence: 0n,
        expectedHash: GENESIS_PREVIOUS_HASH,
        actualHash: firstRecord.previousHash,
        error: 'Genesis record has invalid previous hash',
      };
    }
  }

  // Validate each record
  let previousRecord = firstRecord;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    // Verify hash computation
    const expectedHash = computeRecordHash({
      sequenceNumber: record.sequenceNumber,
      timestamp: record.timestamp,
      eventType: record.eventType,
      payload: record.payload,
      previousHash: record.previousHash,
    });

    if (!timingSafeCompare(record.hash, expectedHash)) {
      return {
        isValid: false,
        validatedCount: i,
        invalidAtSequence: record.sequenceNumber,
        expectedHash,
        actualHash: record.hash,
        error: 'Record hash does not match computed hash',
      };
    }

    // Verify chain linkage (skip for first record)
    if (i > 0) {
      if (record.previousHash !== previousRecord.hash) {
        return {
          isValid: false,
          validatedCount: i,
          invalidAtSequence: record.sequenceNumber,
          expectedHash: previousRecord.hash,
          actualHash: record.previousHash,
          error: 'Chain broken: previousHash does not match previous record hash',
        };
      }

      // Verify sequence is monotonically increasing
      if (record.sequenceNumber !== previousRecord.sequenceNumber + 1n) {
        return {
          isValid: false,
          validatedCount: i,
          invalidAtSequence: record.sequenceNumber,
          error: `Sequence gap: expected ${previousRecord.sequenceNumber + 1n}, got ${record.sequenceNumber}`,
        };
      }
    }

    previousRecord = record;
  }

  return {
    isValid: true,
    validatedCount: records.length,
  };
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  return timingSafeEqual(bufA, bufB);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Verify a single record's hash is correctly computed.
 */
export function verifyRecordHash(record: HashChainRecord): boolean {
  const expectedHash = computeRecordHash({
    sequenceNumber: record.sequenceNumber,
    timestamp: record.timestamp,
    eventType: record.eventType,
    payload: record.payload,
    previousHash: record.previousHash,
  });

  return timingSafeCompare(record.hash, expectedHash);
}

/**
 * Create a standalone record (not part of a chain).
 * Useful for testing or external verification.
 */
export function createRecord(
  sequenceNumber: bigint,
  timestamp: Date,
  eventType: string,
  payload: unknown,
  previousHash: string
): HashChainRecord {
  const input: HashChainInput = {
    sequenceNumber,
    timestamp,
    eventType,
    payload,
    previousHash,
  };

  return {
    ...input,
    hash: computeRecordHash(input),
  };
}
