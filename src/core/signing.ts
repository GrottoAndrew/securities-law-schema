/**
 * Cryptographic Signing Module
 *
 * Provides ECDSA signing and verification for audit checkpoints.
 * Supports both local key pairs and AWS KMS integration.
 *
 * Default algorithm: ECDSA with P-256 curve and SHA-256 hash (ES256)
 */

import {
  generateKeyPairSync,
  createSign,
  createVerify,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  randomUUID,
} from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

export interface SigningKeyPair {
  /** Unique identifier for this key pair */
  keyId: string;
  /** Algorithm identifier */
  algorithm: SigningAlgorithm;
  /** Public key in PEM format */
  publicKeyPem: string;
  /** Private key in PEM format (only for local keys) */
  privateKeyPem?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp (for rotation) */
  expiresAt?: Date;
  /** Key status */
  status: KeyStatus;
}

export interface Signature {
  /** The signature bytes as base64 */
  signature: string;
  /** Key ID used for signing */
  keyId: string;
  /** Algorithm used */
  algorithm: SigningAlgorithm;
  /** Timestamp of signing */
  signedAt: Date;
}

export interface VerificationResult {
  /** Whether the signature is valid */
  isValid: boolean;
  /** Key ID that was used */
  keyId: string;
  /** Error message if verification failed */
  error?: string;
}

export type SigningAlgorithm = 'ECDSA-P256-SHA256' | 'ECDSA-P384-SHA384';

export type KeyStatus = 'active' | 'rotated' | 'revoked' | 'expired';

export interface SignerConfig {
  /** Algorithm to use for signing */
  algorithm?: SigningAlgorithm;
  /** Key rotation period in days (default: 365) */
  rotationPeriodDays?: number;
}

export interface KmsSignerConfig extends SignerConfig {
  /** AWS region */
  region: string;
  /** KMS key ID or ARN */
  keyId: string;
}

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM_CONFIG: Record<
  SigningAlgorithm,
  { curve: string; hash: string; namedCurve: string }
> = {
  'ECDSA-P256-SHA256': { curve: 'prime256v1', hash: 'sha256', namedCurve: 'P-256' },
  'ECDSA-P384-SHA384': { curve: 'secp384r1', hash: 'sha384', namedCurve: 'P-384' },
};

const DEFAULT_ALGORITHM: SigningAlgorithm = 'ECDSA-P256-SHA256';
const DEFAULT_ROTATION_DAYS = 365;

// =============================================================================
// LocalSigner - For development and testing
// =============================================================================

/**
 * Local signer using Node.js crypto.
 * Suitable for development, testing, or air-gapped environments.
 *
 * For production, use KmsSigner with AWS KMS.
 */
export class LocalSigner {
  private readonly algorithm: SigningAlgorithm;
  private readonly rotationPeriodDays: number;
  private keyPairs: Map<string, { pair: SigningKeyPair; privateKey: KeyObject }> = new Map();
  private activeKeyId: string | null = null;

  constructor(config?: SignerConfig) {
    this.algorithm = config?.algorithm ?? DEFAULT_ALGORITHM;
    this.rotationPeriodDays = config?.rotationPeriodDays ?? DEFAULT_ROTATION_DAYS;
  }

  /**
   * Generate a new signing key pair.
   */
  generateKeyPair(): SigningKeyPair {
    const algConfig = ALGORITHM_CONFIG[this.algorithm];
    if (!algConfig) {
      throw new Error(`Unsupported algorithm: ${this.algorithm}`);
    }

    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: algConfig.curve,
    });

    const keyId = `local-${randomUUID()}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + this.rotationPeriodDays);

    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const keyPair: SigningKeyPair = {
      keyId,
      algorithm: this.algorithm,
      publicKeyPem,
      privateKeyPem,
      createdAt,
      expiresAt,
      status: 'active',
    };

    this.keyPairs.set(keyId, { pair: keyPair, privateKey });
    this.activeKeyId = keyId;

    return keyPair;
  }

  /**
   * Import an existing key pair.
   */
  importKeyPair(keyPair: SigningKeyPair): void {
    if (!keyPair.privateKeyPem) {
      throw new Error('Private key is required for local signer');
    }

    const privateKey = createPrivateKey(keyPair.privateKeyPem);
    this.keyPairs.set(keyPair.keyId, { pair: keyPair, privateKey });

    if (keyPair.status === 'active') {
      this.activeKeyId = keyPair.keyId;
    }
  }

  /**
   * Get the currently active key pair.
   */
  getActiveKeyPair(): SigningKeyPair | undefined {
    if (!this.activeKeyId) {
      return undefined;
    }
    return this.keyPairs.get(this.activeKeyId)?.pair;
  }

  /**
   * Get a key pair by ID.
   */
  getKeyPair(keyId: string): SigningKeyPair | undefined {
    return this.keyPairs.get(keyId)?.pair;
  }

  /**
   * Get all key pairs.
   */
  getAllKeyPairs(): SigningKeyPair[] {
    return Array.from(this.keyPairs.values()).map((v) => v.pair);
  }

  /**
   * Sign data using the active key.
   */
  sign(data: string | Buffer): Signature {
    if (!this.activeKeyId) {
      throw new Error('No active signing key. Generate or import a key first.');
    }

    const keyData = this.keyPairs.get(this.activeKeyId);
    if (!keyData) {
      throw new Error('Active key not found');
    }

    return this.signWithKey(data, keyData.pair.keyId);
  }

  /**
   * Sign data using a specific key.
   */
  signWithKey(data: string | Buffer, keyId: string): Signature {
    const keyData = this.keyPairs.get(keyId);
    if (!keyData) {
      throw new Error(`Key not found: ${keyId}`);
    }

    if (keyData.pair.status === 'revoked') {
      throw new Error(`Key is revoked: ${keyId}`);
    }

    const algConfig = ALGORITHM_CONFIG[keyData.pair.algorithm];
    if (!algConfig) {
      throw new Error(`Unsupported algorithm: ${keyData.pair.algorithm}`);
    }

    const sign = createSign(algConfig.hash);
    sign.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);

    const signature = sign.sign(keyData.privateKey, 'base64');

    return {
      signature,
      keyId,
      algorithm: keyData.pair.algorithm,
      signedAt: new Date(),
    };
  }

  /**
   * Verify a signature.
   */
  verify(data: string | Buffer, signature: Signature): VerificationResult {
    const keyData = this.keyPairs.get(signature.keyId);
    if (!keyData) {
      return {
        isValid: false,
        keyId: signature.keyId,
        error: `Key not found: ${signature.keyId}`,
      };
    }

    return this.verifyWithPublicKey(data, signature, keyData.pair.publicKeyPem);
  }

  /**
   * Verify a signature using a public key PEM.
   */
  verifyWithPublicKey(
    data: string | Buffer,
    signature: Signature,
    publicKeyPem: string
  ): VerificationResult {
    try {
      const algConfig = ALGORITHM_CONFIG[signature.algorithm];
      if (!algConfig) {
        return {
          isValid: false,
          keyId: signature.keyId,
          error: `Unsupported algorithm: ${signature.algorithm}`,
        };
      }

      const publicKey = createPublicKey(publicKeyPem);
      const verify = createVerify(algConfig.hash);
      verify.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);

      const isValid = verify.verify(publicKey, signature.signature, 'base64');

      return {
        isValid,
        keyId: signature.keyId,
        error: isValid ? undefined : 'Signature verification failed',
      };
    } catch (error) {
      return {
        isValid: false,
        keyId: signature.keyId,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }

  /**
   * Rotate the active key.
   * Marks old key as rotated and generates new active key.
   */
  rotateKey(): SigningKeyPair {
    if (this.activeKeyId) {
      const oldKeyData = this.keyPairs.get(this.activeKeyId);
      if (oldKeyData) {
        oldKeyData.pair.status = 'rotated';
      }
    }

    return this.generateKeyPair();
  }

  /**
   * Revoke a key.
   */
  revokeKey(keyId: string): void {
    const keyData = this.keyPairs.get(keyId);
    if (!keyData) {
      throw new Error(`Key not found: ${keyId}`);
    }

    keyData.pair.status = 'revoked';

    if (this.activeKeyId === keyId) {
      this.activeKeyId = null;
    }
  }

  /**
   * Check if active key needs rotation.
   */
  needsRotation(): boolean {
    if (!this.activeKeyId) {
      return true;
    }

    const keyData = this.keyPairs.get(this.activeKeyId);
    if (!keyData || !keyData.pair.expiresAt) {
      return false;
    }

    return new Date() >= keyData.pair.expiresAt;
  }

  /**
   * Export keys for backup (WARNING: includes private keys).
   */
  exportKeys(): SigningKeyPair[] {
    return this.getAllKeyPairs();
  }
}

// =============================================================================
// KMS Signer Stub - Requires AWS SDK
// =============================================================================

/**
 * AWS KMS signer for production use.
 *
 * This is a stub that defines the interface. Full implementation
 * requires the AWS SDK and actual KMS access.
 */
export class KmsSigner {
  private readonly config: KmsSignerConfig;

  constructor(config: KmsSignerConfig) {
    this.config = config;
  }

  /**
   * Sign data using KMS.
   *
   * Implementation note: This would use:
   * - @aws-sdk/client-kms KMSClient
   * - SignCommand with SigningAlgorithm ECDSA_SHA_256
   */
  async sign(data: string | Buffer): Promise<Signature> {
    // Stub - actual implementation requires AWS SDK
    throw new Error(
      'KMS signing not implemented. Use LocalSigner for development or implement KMS integration.'
    );

    // Real implementation would be:
    // const client = new KMSClient({ region: this.config.region });
    // const command = new SignCommand({
    //   KeyId: this.config.keyId,
    //   Message: Buffer.from(data),
    //   MessageType: 'RAW',
    //   SigningAlgorithm: 'ECDSA_SHA_256',
    // });
    // const response = await client.send(command);
    // return {
    //   signature: Buffer.from(response.Signature!).toString('base64'),
    //   keyId: this.config.keyId,
    //   algorithm: 'ECDSA-P256-SHA256',
    //   signedAt: new Date(),
    // };
  }

  /**
   * Verify a signature using KMS.
   */
  async verify(data: string | Buffer, signature: Signature): Promise<VerificationResult> {
    // Stub - actual implementation requires AWS SDK
    throw new Error('KMS verification not implemented.');
  }

  /**
   * Get public key from KMS.
   */
  async getPublicKey(): Promise<string> {
    // Stub - actual implementation requires AWS SDK
    throw new Error('KMS getPublicKey not implemented.');
  }
}

// =============================================================================
// Checkpoint Signing Utilities
// =============================================================================

export interface CheckpointData {
  checkpointNumber: number;
  periodStart: Date;
  periodEnd: Date;
  firstSequenceNumber: bigint;
  lastSequenceNumber: bigint;
  eventCount: number;
  merkleRoot: string;
  previousCheckpointId?: string;
  previousMerkleRoot?: string;
}

/**
 * Create canonical bytes for checkpoint signing.
 * Uses a deterministic format that can be verified independently.
 */
export function createCheckpointSigningData(checkpoint: CheckpointData): Buffer {
  const components = [
    `checkpoint:${checkpoint.checkpointNumber}`,
    `period:${checkpoint.periodStart.toISOString()}/${checkpoint.periodEnd.toISOString()}`,
    `sequences:${checkpoint.firstSequenceNumber}-${checkpoint.lastSequenceNumber}`,
    `events:${checkpoint.eventCount}`,
    `merkle:${checkpoint.merkleRoot}`,
    checkpoint.previousCheckpointId ? `prev_id:${checkpoint.previousCheckpointId}` : 'prev_id:null',
    checkpoint.previousMerkleRoot ? `prev_root:${checkpoint.previousMerkleRoot}` : 'prev_root:null',
  ];

  return Buffer.from(components.join('\n'), 'utf8');
}

/**
 * Sign a checkpoint.
 */
export function signCheckpoint(checkpoint: CheckpointData, signer: LocalSigner): Signature {
  const data = createCheckpointSigningData(checkpoint);
  return signer.sign(data);
}

/**
 * Verify a checkpoint signature.
 */
export function verifyCheckpointSignature(
  checkpoint: CheckpointData,
  signature: Signature,
  signer: LocalSigner
): VerificationResult {
  const data = createCheckpointSigningData(checkpoint);
  return signer.verify(data, signature);
}

/**
 * Verify a checkpoint signature with just the public key.
 */
export function verifyCheckpointWithPublicKey(
  checkpoint: CheckpointData,
  signature: Signature,
  publicKeyPem: string
): VerificationResult {
  const signer = new LocalSigner();
  const data = createCheckpointSigningData(checkpoint);
  return signer.verifyWithPublicKey(data, signature, publicKeyPem);
}
