/**
 * Cryptographic Signing Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalSigner,
  createCheckpointSigningData,
  signCheckpoint,
  verifyCheckpointSignature,
  verifyCheckpointWithPublicKey,
  type SigningKeyPair,
  type CheckpointData,
} from '../signing.js';

describe('LocalSigner', () => {
  let signer: LocalSigner;

  beforeEach(() => {
    signer = new LocalSigner();
  });

  describe('key generation', () => {
    it('should generate a key pair', () => {
      const keyPair = signer.generateKeyPair();

      expect(keyPair.keyId).toBeDefined();
      expect(keyPair.keyId).toMatch(/^local-/);
      expect(keyPair.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(keyPair.privateKeyPem).toContain('BEGIN PRIVATE KEY');
      expect(keyPair.algorithm).toBe('ECDSA-P256-SHA256');
      expect(keyPair.status).toBe('active');
      expect(keyPair.createdAt).toBeInstanceOf(Date);
      expect(keyPair.expiresAt).toBeInstanceOf(Date);
    });

    it('should set expiration based on rotation period', () => {
      const customSigner = new LocalSigner({ rotationPeriodDays: 30 });
      const keyPair = customSigner.generateKeyPair();

      const expectedExpiry = new Date(keyPair.createdAt);
      expectedExpiry.setDate(expectedExpiry.getDate() + 30);

      // Allow 1 second tolerance
      expect(Math.abs(keyPair.expiresAt!.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    it('should set generated key as active', () => {
      const keyPair = signer.generateKeyPair();
      const active = signer.getActiveKeyPair();

      expect(active).toBeDefined();
      expect(active!.keyId).toBe(keyPair.keyId);
    });

    it('should generate unique key IDs', () => {
      const keyPair1 = signer.generateKeyPair();
      const keyPair2 = signer.generateKeyPair();

      expect(keyPair1.keyId).not.toBe(keyPair2.keyId);
    });
  });

  describe('signing', () => {
    beforeEach(() => {
      signer.generateKeyPair();
    });

    it('should sign string data', () => {
      const signature = signer.sign('test data');

      expect(signature.signature).toBeDefined();
      expect(signature.signature.length).toBeGreaterThan(0);
      expect(signature.keyId).toBeDefined();
      expect(signature.algorithm).toBe('ECDSA-P256-SHA256');
      expect(signature.signedAt).toBeInstanceOf(Date);
    });

    it('should sign buffer data', () => {
      const signature = signer.sign(Buffer.from('test data'));

      expect(signature.signature).toBeDefined();
    });

    it('should produce different signatures for different data', () => {
      const sig1 = signer.sign('data1');
      const sig2 = signer.sign('data2');

      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it('should throw without active key', () => {
      const emptySigner = new LocalSigner();
      expect(() => emptySigner.sign('data')).toThrow('No active signing key');
    });

    it('should throw for revoked key', () => {
      const keyPair = signer.getActiveKeyPair()!;
      signer.revokeKey(keyPair.keyId);

      expect(() => signer.signWithKey('data', keyPair.keyId)).toThrow('revoked');
    });
  });

  describe('verification', () => {
    beforeEach(() => {
      signer.generateKeyPair();
    });

    it('should verify valid signature', () => {
      const data = 'test data';
      const signature = signer.sign(data);
      const result = signer.verify(data, signature);

      expect(result.isValid).toBe(true);
      expect(result.keyId).toBe(signature.keyId);
      expect(result.error).toBeUndefined();
    });

    it('should reject tampered data', () => {
      const signature = signer.sign('original data');
      const result = signer.verify('tampered data', signature);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject tampered signature', () => {
      const data = 'test data';
      const signature = signer.sign(data);

      // Tamper with signature
      const tamperedSig = {
        ...signature,
        signature: Buffer.from('tampered').toString('base64'),
      };

      const result = signer.verify(data, tamperedSig);
      expect(result.isValid).toBe(false);
    });

    it('should fail for unknown key', () => {
      const signature = signer.sign('data');
      const unknownSig = { ...signature, keyId: 'unknown-key' };

      const result = signer.verify('data', unknownSig);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('verifyWithPublicKey', () => {
    it('should verify with just public key', () => {
      signer.generateKeyPair();
      const keyPair = signer.getActiveKeyPair()!;

      const data = 'test data';
      const signature = signer.sign(data);

      // Create new signer with only public key
      const verifier = new LocalSigner();
      const result = verifier.verifyWithPublicKey(data, signature, keyPair.publicKeyPem);

      expect(result.isValid).toBe(true);
    });

    it('should reject invalid public key', () => {
      signer.generateKeyPair();
      const signature = signer.sign('data');

      const result = signer.verifyWithPublicKey('data', signature, 'invalid-pem');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('key rotation', () => {
    it('should rotate key and mark old as rotated', () => {
      const oldKey = signer.generateKeyPair();
      const newKey = signer.rotateKey();

      expect(newKey.keyId).not.toBe(oldKey.keyId);
      expect(signer.getActiveKeyPair()!.keyId).toBe(newKey.keyId);

      const oldKeyAfter = signer.getKeyPair(oldKey.keyId);
      expect(oldKeyAfter!.status).toBe('rotated');
    });

    it('should allow verification with rotated key', () => {
      signer.generateKeyPair();
      const signature = signer.sign('data');

      signer.rotateKey();

      // Should still verify with old key
      const result = signer.verify('data', signature);
      expect(result.isValid).toBe(true);
    });
  });

  describe('key revocation', () => {
    it('should revoke key', () => {
      const keyPair = signer.generateKeyPair();
      signer.revokeKey(keyPair.keyId);

      expect(signer.getKeyPair(keyPair.keyId)!.status).toBe('revoked');
      expect(signer.getActiveKeyPair()).toBeUndefined();
    });

    it('should throw for unknown key revocation', () => {
      expect(() => signer.revokeKey('unknown')).toThrow('not found');
    });
  });

  describe('key import', () => {
    it('should import key pair', () => {
      const originalSigner = new LocalSigner();
      const originalKey = originalSigner.generateKeyPair();

      const newSigner = new LocalSigner();
      newSigner.importKeyPair(originalKey);

      const signature = originalSigner.sign('test');
      const result = newSigner.verify('test', signature);

      expect(result.isValid).toBe(true);
    });

    it('should throw without private key', () => {
      const keyPair: SigningKeyPair = {
        keyId: 'test',
        algorithm: 'ECDSA-P256-SHA256',
        publicKeyPem: 'public',
        // No privateKeyPem
        createdAt: new Date(),
        status: 'active',
      };

      expect(() => signer.importKeyPair(keyPair)).toThrow('Private key is required');
    });
  });

  describe('needsRotation', () => {
    it('should return true without active key', () => {
      expect(signer.needsRotation()).toBe(true);
    });

    it('should return false for fresh key', () => {
      signer.generateKeyPair();
      expect(signer.needsRotation()).toBe(false);
    });

    it('should return true for expired key', () => {
      // Create signer with 0 day rotation (immediate expiry)
      const expiredSigner = new LocalSigner({ rotationPeriodDays: 0 });
      expiredSigner.generateKeyPair();

      // Key expires immediately
      expect(expiredSigner.needsRotation()).toBe(true);
    });
  });

  describe('getAllKeyPairs', () => {
    it('should return all key pairs', () => {
      signer.generateKeyPair();
      signer.rotateKey();
      signer.rotateKey();

      const allKeys = signer.getAllKeyPairs();
      expect(allKeys).toHaveLength(3);
    });
  });

  describe('exportKeys', () => {
    it('should export all keys with private keys', () => {
      signer.generateKeyPair();
      signer.rotateKey();

      const exported = signer.exportKeys();
      expect(exported).toHaveLength(2);
      expect(exported[0]!.privateKeyPem).toBeDefined();
      expect(exported[1]!.privateKeyPem).toBeDefined();
    });
  });
});

describe('P-384 algorithm', () => {
  let signer: LocalSigner;

  beforeEach(() => {
    signer = new LocalSigner({ algorithm: 'ECDSA-P384-SHA384' });
    signer.generateKeyPair();
  });

  it('should generate P-384 key', () => {
    const keyPair = signer.getActiveKeyPair()!;
    expect(keyPair.algorithm).toBe('ECDSA-P384-SHA384');
  });

  it('should sign and verify with P-384', () => {
    const data = 'test data';
    const signature = signer.sign(data);
    const result = signer.verify(data, signature);

    expect(result.isValid).toBe(true);
    expect(signature.algorithm).toBe('ECDSA-P384-SHA384');
  });
});

describe('Checkpoint signing', () => {
  let signer: LocalSigner;
  let checkpoint: CheckpointData;

  beforeEach(() => {
    signer = new LocalSigner();
    signer.generateKeyPair();

    checkpoint = {
      checkpointNumber: 1,
      periodStart: new Date('2026-01-20T00:00:00Z'),
      periodEnd: new Date('2026-01-20T01:00:00Z'),
      firstSequenceNumber: 1n,
      lastSequenceNumber: 100n,
      eventCount: 100,
      merkleRoot: 'a'.repeat(64),
      previousCheckpointId: undefined,
      previousMerkleRoot: undefined,
    };
  });

  describe('createCheckpointSigningData', () => {
    it('should create deterministic data', () => {
      const data1 = createCheckpointSigningData(checkpoint);
      const data2 = createCheckpointSigningData(checkpoint);

      expect(data1.equals(data2)).toBe(true);
    });

    it('should include all checkpoint fields', () => {
      const data = createCheckpointSigningData(checkpoint).toString('utf8');

      expect(data).toContain('checkpoint:1');
      expect(data).toContain('2026-01-20T00:00:00.000Z');
      expect(data).toContain('2026-01-20T01:00:00.000Z');
      expect(data).toContain('sequences:1-100');
      expect(data).toContain('events:100');
      expect(data).toContain('merkle:' + 'a'.repeat(64));
    });

    it('should handle previous checkpoint references', () => {
      checkpoint.previousCheckpointId = 'prev-id';
      checkpoint.previousMerkleRoot = 'b'.repeat(64);

      const data = createCheckpointSigningData(checkpoint).toString('utf8');

      expect(data).toContain('prev_id:prev-id');
      expect(data).toContain('prev_root:' + 'b'.repeat(64));
    });
  });

  describe('signCheckpoint', () => {
    it('should sign checkpoint', () => {
      const signature = signCheckpoint(checkpoint, signer);

      expect(signature.signature).toBeDefined();
      expect(signature.keyId).toBeDefined();
    });
  });

  describe('verifyCheckpointSignature', () => {
    it('should verify valid checkpoint signature', () => {
      const signature = signCheckpoint(checkpoint, signer);
      const result = verifyCheckpointSignature(checkpoint, signature, signer);

      expect(result.isValid).toBe(true);
    });

    it('should reject tampered checkpoint', () => {
      const signature = signCheckpoint(checkpoint, signer);

      checkpoint.eventCount = 999; // Tamper

      const result = verifyCheckpointSignature(checkpoint, signature, signer);
      expect(result.isValid).toBe(false);
    });
  });

  describe('verifyCheckpointWithPublicKey', () => {
    it('should verify with public key only', () => {
      const keyPair = signer.getActiveKeyPair()!;
      const signature = signCheckpoint(checkpoint, signer);

      const result = verifyCheckpointWithPublicKey(checkpoint, signature, keyPair.publicKeyPem);

      expect(result.isValid).toBe(true);
    });
  });
});

describe('edge cases', () => {
  it('should handle empty string signing', () => {
    const signer = new LocalSigner();
    signer.generateKeyPair();

    const signature = signer.sign('');
    const result = signer.verify('', signature);

    expect(result.isValid).toBe(true);
  });

  it('should handle large data signing', () => {
    const signer = new LocalSigner();
    signer.generateKeyPair();

    const largeData = 'x'.repeat(1_000_000);
    const signature = signer.sign(largeData);
    const result = signer.verify(largeData, signature);

    expect(result.isValid).toBe(true);
  });

  it('should handle binary data', () => {
    const signer = new LocalSigner();
    signer.generateKeyPair();

    const binaryData = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00]);
    const signature = signer.sign(binaryData);
    const result = signer.verify(binaryData, signature);

    expect(result.isValid).toBe(true);
  });
});
