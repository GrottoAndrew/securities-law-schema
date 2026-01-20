/**
 * Hash Chain Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HashChain,
  sha256,
  canonicalize,
  computeRecordHash,
  validateChain,
  verifyRecordHash,
  createRecord,
  GENESIS_PREVIOUS_HASH,
  HASH_LENGTH,
  type HashChainRecord,
} from '../hash-chain.js';

describe('sha256', () => {
  it('should produce 64-character hex string', () => {
    const hash = sha256('test');
    expect(hash).toHaveLength(HASH_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('should produce consistent hashes for same input', () => {
    const hash1 = sha256('test data');
    const hash2 = sha256('test data');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = sha256('test1');
    const hash2 = sha256('test2');
    expect(hash1).not.toBe(hash2);
  });

  it('should match known SHA-256 vectors', () => {
    // Known test vector
    const hash = sha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('canonicalize', () => {
  it('should produce consistent output for objects', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(canonicalize(obj1)).toBe(canonicalize(obj2));
  });

  it('should handle nested objects', () => {
    const obj1 = { outer: { z: 1, a: 2 } };
    const obj2 = { outer: { a: 2, z: 1 } };
    expect(canonicalize(obj1)).toBe(canonicalize(obj2));
  });

  it('should handle arrays (preserve order)', () => {
    const arr1 = [3, 1, 2];
    const arr2 = [1, 2, 3];
    expect(canonicalize(arr1)).not.toBe(canonicalize(arr2));
  });

  it('should handle primitives', () => {
    expect(canonicalize('string')).toBe('"string"');
    expect(canonicalize(123)).toBe('123');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });
});

describe('computeRecordHash', () => {
  it('should produce consistent hash for same input', () => {
    const input = {
      sequenceNumber: 1n,
      timestamp: new Date('2026-01-20T12:00:00.000Z'),
      eventType: 'test.event',
      payload: { key: 'value' },
      previousHash: 'a'.repeat(64),
    };

    const hash1 = computeRecordHash(input);
    const hash2 = computeRecordHash(input);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different sequence', () => {
    const base = {
      timestamp: new Date('2026-01-20T12:00:00.000Z'),
      eventType: 'test.event',
      payload: { key: 'value' },
      previousHash: 'a'.repeat(64),
    };

    const hash1 = computeRecordHash({ ...base, sequenceNumber: 1n });
    const hash2 = computeRecordHash({ ...base, sequenceNumber: 2n });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for different timestamp', () => {
    const base = {
      sequenceNumber: 1n,
      eventType: 'test.event',
      payload: { key: 'value' },
      previousHash: 'a'.repeat(64),
    };

    const hash1 = computeRecordHash({ ...base, timestamp: new Date('2026-01-20T12:00:00.000Z') });
    const hash2 = computeRecordHash({ ...base, timestamp: new Date('2026-01-20T12:00:01.000Z') });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for different payload', () => {
    const base = {
      sequenceNumber: 1n,
      timestamp: new Date('2026-01-20T12:00:00.000Z'),
      eventType: 'test.event',
      previousHash: 'a'.repeat(64),
    };

    const hash1 = computeRecordHash({ ...base, payload: { a: 1 } });
    const hash2 = computeRecordHash({ ...base, payload: { a: 2 } });
    expect(hash1).not.toBe(hash2);
  });
});

describe('HashChain', () => {
  let chain: HashChain;

  beforeEach(() => {
    chain = new HashChain({
      timestamp: new Date('2026-01-20T00:00:00.000Z'),
      version: '1.0.0',
    });
  });

  describe('initialization', () => {
    it('should start with genesis block', () => {
      expect(chain.length()).toBe(1);
      const genesis = chain.getGenesis();
      expect(genesis.sequenceNumber).toBe(0n);
      expect(genesis.eventType).toBe('system.genesis');
      expect(genesis.previousHash).toBe(GENESIS_PREVIOUS_HASH);
    });

    it('should have valid genesis hash', () => {
      const genesis = chain.getGenesis();
      expect(verifyRecordHash(genesis)).toBe(true);
    });

    it('should report current hash as genesis hash', () => {
      const genesis = chain.getGenesis();
      expect(chain.getCurrentHash()).toBe(genesis.hash);
    });
  });

  describe('append', () => {
    it('should add record with correct sequence', () => {
      const record = chain.append('test.event', { data: 'test' });
      expect(record.sequenceNumber).toBe(1n);
    });

    it('should link to previous record hash', () => {
      const genesis = chain.getGenesis();
      const record = chain.append('test.event', { data: 'test' });
      expect(record.previousHash).toBe(genesis.hash);
    });

    it('should update current hash', () => {
      const record = chain.append('test.event', { data: 'test' });
      expect(chain.getCurrentHash()).toBe(record.hash);
    });

    it('should increment sequence', () => {
      chain.append('test.event1', {});
      chain.append('test.event2', {});
      chain.append('test.event3', {});
      expect(chain.getCurrentSequence()).toBe(3n);
    });

    it('should create valid chain', () => {
      chain.append('test.event1', { data: 1 });
      chain.append('test.event2', { data: 2 });
      chain.append('test.event3', { data: 3 });

      const validation = chain.validate();
      expect(validation.isValid).toBe(true);
      expect(validation.validatedCount).toBe(4);
    });
  });

  describe('getRecord', () => {
    it('should retrieve record by sequence', () => {
      chain.append('test.event', { id: 1 });
      const record = chain.getRecord(1n);
      expect(record).toBeDefined();
      expect(record?.eventType).toBe('test.event');
    });

    it('should return undefined for non-existent sequence', () => {
      const record = chain.getRecord(999n);
      expect(record).toBeUndefined();
    });
  });

  describe('getRecordRange', () => {
    beforeEach(() => {
      chain.append('event1', {});
      chain.append('event2', {});
      chain.append('event3', {});
      chain.append('event4', {});
    });

    it('should return records in range', () => {
      const range = chain.getRecordRange(1n, 3n);
      expect(range).toHaveLength(3);
      expect(range[0]?.sequenceNumber).toBe(1n);
      expect(range[2]?.sequenceNumber).toBe(3n);
    });

    it('should include endpoints', () => {
      const range = chain.getRecordRange(2n, 2n);
      expect(range).toHaveLength(1);
      expect(range[0]?.sequenceNumber).toBe(2n);
    });
  });

  describe('validate', () => {
    it('should validate intact chain', () => {
      chain.append('event1', { data: 1 });
      chain.append('event2', { data: 2 });

      const result = chain.validate();
      expect(result.isValid).toBe(true);
    });

    it('should detect tampered hash', () => {
      chain.append('event1', { data: 1 });

      // Tamper with internal record (simulating corruption)
      const records = chain.getAllRecords() as HashChainRecord[];
      const tamperedRecord = { ...records[1]!, hash: 'b'.repeat(64) };
      records[1] = tamperedRecord;

      const result = validateChain(records);
      expect(result.isValid).toBe(false);
      expect(result.invalidAtSequence).toBe(1n);
    });

    it('should detect broken chain linkage', () => {
      chain.append('event1', { data: 1 });
      chain.append('event2', { data: 2 });

      // Break chain linkage
      const records = chain.getAllRecords() as HashChainRecord[];
      const brokenRecord = { ...records[2]!, previousHash: 'c'.repeat(64) };
      records[2] = brokenRecord;

      const result = validateChain(records);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Chain broken');
    });
  });

  describe('serialization', () => {
    it('should export to JSON', () => {
      chain.append('test.event', { data: 'test' });

      const json = chain.toJSON();
      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('currentHash');
      expect(json).toHaveProperty('records');
    });

    it('should import from JSON', () => {
      chain.append('event1', { id: 1 });
      chain.append('event2', { id: 2 });

      const json = chain.toJSON();
      const imported = HashChain.fromJSON(json as Parameters<typeof HashChain.fromJSON>[0]);

      expect(imported.getCurrentHash()).toBe(chain.getCurrentHash());
      expect(imported.getCurrentSequence()).toBe(chain.getCurrentSequence());
      expect(imported.length()).toBe(chain.length());
    });

    it('should reject invalid imported chain', () => {
      const invalidJson = {
        records: [
          {
            sequenceNumber: '0',
            timestamp: '2026-01-20T00:00:00.000Z',
            eventType: 'system.genesis',
            payload: {},
            previousHash: GENESIS_PREVIOUS_HASH,
            hash: 'invalid_hash', // Invalid hash
          },
        ],
      };

      expect(() => HashChain.fromJSON(invalidJson)).toThrow();
    });
  });
});

describe('validateChain', () => {
  it('should reject empty chain', () => {
    const result = validateChain([]);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Empty');
  });

  it('should validate single genesis record', () => {
    const genesis = createRecord(
      0n,
      new Date('2026-01-20T00:00:00.000Z'),
      'system.genesis',
      { genesis: true },
      GENESIS_PREVIOUS_HASH
    );

    const result = validateChain([genesis]);
    expect(result.isValid).toBe(true);
  });

  it('should detect sequence gap', () => {
    const record0 = createRecord(
      0n,
      new Date('2026-01-20T00:00:00.000Z'),
      'system.genesis',
      {},
      GENESIS_PREVIOUS_HASH
    );

    const record2 = createRecord(
      2n, // Gap: should be 1
      new Date('2026-01-20T00:00:01.000Z'),
      'test.event',
      {},
      record0.hash
    );

    const result = validateChain([record0, record2]);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Sequence gap');
  });
});

describe('createRecord', () => {
  it('should create record with valid hash', () => {
    const record = createRecord(
      1n,
      new Date('2026-01-20T12:00:00.000Z'),
      'test.event',
      { key: 'value' },
      'a'.repeat(64)
    );

    expect(record.hash).toHaveLength(HASH_LENGTH);
    expect(verifyRecordHash(record)).toBe(true);
  });
});

describe('verifyRecordHash', () => {
  it('should return true for valid record', () => {
    const record = createRecord(
      1n,
      new Date(),
      'test.event',
      { data: 'test' },
      'a'.repeat(64)
    );

    expect(verifyRecordHash(record)).toBe(true);
  });

  it('should return false for tampered record', () => {
    const record = createRecord(
      1n,
      new Date(),
      'test.event',
      { data: 'test' },
      'a'.repeat(64)
    );

    const tampered = { ...record, payload: { data: 'tampered' } };
    expect(verifyRecordHash(tampered)).toBe(false);
  });
});
