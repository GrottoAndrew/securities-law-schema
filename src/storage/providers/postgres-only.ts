/**
 * PostgreSQL-only storage provider for demo/development.
 *
 * Stores checkpoint data in JSONB columns - no external object storage required.
 * NOT suitable for SEC 17a-4 production (no true WORM support).
 *
 * Use cases:
 * - Local development with Docker PostgreSQL
 * - Demo deployments on Supabase/Neon free tier
 * - Testing without cloud credentials
 */

import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  ImmutableStorage,
  StoredObject,
  ObjectMetadata,
  RetentionPolicy,
  StorageCapabilities,
  StorageError,
} from '../interface.js';

interface StoredRecord {
  key: string;
  content: Buffer;
  content_hash: string;
  size: number;
  stored_at: Date;
  content_type: string | null;
  retention_days: number | null;
  retention_mode: string | null;
  metadata: Record<string, string> | null;
  legal_hold: boolean;
}

/**
 * PostgreSQL-based storage for checkpoints and audit data.
 *
 * Creates table on first use:
 * ```sql
 * CREATE TABLE IF NOT EXISTS immutable_objects (
 *   key TEXT PRIMARY KEY,
 *   content BYTEA NOT NULL,
 *   content_hash TEXT NOT NULL,
 *   size INTEGER NOT NULL,
 *   stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   content_type TEXT,
 *   retention_days INTEGER,
 *   retention_mode TEXT,
 *   metadata JSONB,
 *   legal_hold BOOLEAN DEFAULT FALSE
 * );
 * ```
 */
export class PostgresOnlyStorage implements ImmutableStorage {
  private pool: Pool;
  private initialized = false;

  constructor(connectionString: string);
  constructor(pool: Pool);
  constructor(arg: string | Pool) {
    if (typeof arg === 'string') {
      this.pool = new Pool({ connectionString: arg });
    } else {
      this.pool = arg;
    }
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;

    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS immutable_objects (
          key TEXT PRIMARY KEY,
          content BYTEA NOT NULL,
          content_hash TEXT NOT NULL,
          size INTEGER NOT NULL,
          stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          content_type TEXT,
          retention_days INTEGER,
          retention_mode TEXT CHECK (retention_mode IN ('compliance', 'governance')),
          metadata JSONB,
          legal_hold BOOLEAN DEFAULT FALSE
        );

        CREATE INDEX IF NOT EXISTS idx_immutable_objects_prefix
          ON immutable_objects (key text_pattern_ops);

        CREATE INDEX IF NOT EXISTS idx_immutable_objects_stored_at
          ON immutable_objects (stored_at);
      `);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  async store(
    key: string,
    data: Buffer,
    options?: {
      retention?: RetentionPolicy;
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StoredObject> {
    await this.ensureTable();

    const contentHash = createHash('sha256').update(data).digest('hex');
    const size = data.length;

    const client = await this.pool.connect();
    try {
      // Check if already exists (immutable - no overwrites)
      const existing = await client.query(
        'SELECT key FROM immutable_objects WHERE key = $1',
        [key]
      );

      if (existing.rows.length > 0) {
        throw new StorageError(
          `Object already exists: ${key}`,
          'ALREADY_EXISTS'
        );
      }

      const result = await client.query<{ stored_at: Date }>(
        `INSERT INTO immutable_objects
          (key, content, content_hash, size, content_type, retention_days, retention_mode, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING stored_at`,
        [
          key,
          data,
          contentHash,
          size,
          options?.contentType || 'application/octet-stream',
          options?.retention?.retentionDays || null,
          options?.retention?.mode || null,
          options?.metadata ? JSON.stringify(options.metadata) : null,
        ]
      );

      return {
        key,
        contentHash,
        size,
        storedAt: result.rows[0].stored_at,
        retention: options?.retention,
      };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to store object: ${key}`,
        'UNKNOWN',
        err as Error
      );
    } finally {
      client.release();
    }
  }

  async retrieve(key: string): Promise<{ data: Buffer; metadata: ObjectMetadata }> {
    await this.ensureTable();

    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredRecord>(
        `SELECT content, content_hash, size, stored_at, content_type,
                retention_days, retention_mode, legal_hold
         FROM immutable_objects WHERE key = $1`,
        [key]
      );

      if (result.rows.length === 0) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND');
      }

      const row = result.rows[0];
      return {
        data: row.content,
        metadata: {
          contentHash: row.content_hash,
          size: row.size,
          storedAt: row.stored_at,
          contentType: row.content_type || undefined,
          retention: row.retention_days
            ? {
                retentionDays: row.retention_days,
                mode: row.retention_mode as 'compliance' | 'governance',
              }
            : undefined,
          legalHold: row.legal_hold,
        },
      };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to retrieve object: ${key}`,
        'UNKNOWN',
        err as Error
      );
    } finally {
      client.release();
    }
  }

  async verifyIntegrity(key: string): Promise<boolean> {
    const { data, metadata } = await this.retrieve(key);
    const computedHash = createHash('sha256').update(data).digest('hex');
    return computedHash === metadata.contentHash;
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureTable();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT 1 FROM immutable_objects WHERE key = $1',
        [key]
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  async list(prefix?: string, limit = 1000): Promise<string[]> {
    await this.ensureTable();

    const client = await this.pool.connect();
    try {
      let query: string;
      let params: (string | number)[];

      if (prefix) {
        query = `SELECT key FROM immutable_objects
                 WHERE key LIKE $1
                 ORDER BY stored_at DESC
                 LIMIT $2`;
        params = [`${prefix}%`, limit];
      } else {
        query = `SELECT key FROM immutable_objects
                 ORDER BY stored_at DESC
                 LIMIT $1`;
        params = [limit];
      }

      const result = await client.query<{ key: string }>(query, params);
      return result.rows.map((r: { key: string }) => r.key);
    } finally {
      client.release();
    }
  }

  async applyLegalHold(key: string): Promise<void> {
    await this.ensureTable();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'UPDATE immutable_objects SET legal_hold = TRUE WHERE key = $1',
        [key]
      );

      if (result.rowCount === 0) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND');
      }
    } finally {
      client.release();
    }
  }

  async removeLegalHold(key: string): Promise<void> {
    await this.ensureTable();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'UPDATE immutable_objects SET legal_hold = FALSE WHERE key = $1',
        [key]
      );

      if (result.rowCount === 0) {
        throw new StorageError(`Object not found: ${key}`, 'NOT_FOUND');
      }
    } finally {
      client.release();
    }
  }

  getCapabilities(): StorageCapabilities {
    return {
      // PostgreSQL cannot provide true WORM - data can be deleted by admins
      supportsWORM: false,
      // Legal hold is tracked but not enforced at storage level
      supportsLegalHold: true,
      // Retention is tracked but not enforced at storage level
      supportsRetention: true,
      // PostgreSQL BYTEA limit is ~1GB, but practical limit is lower
      maxObjectSize: 100 * 1024 * 1024, // 100MB
      providerName: 'PostgreSQL (Demo)',
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }

  /**
   * Close the connection pool.
   * Call this when shutting down the application.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Create a PostgreSQL-only storage instance from environment variables.
 *
 * Looks for DATABASE_URL or individual PG* variables.
 */
export function createPostgresStorage(): PostgresOnlyStorage {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER || 'audit'}:${process.env.PGPASSWORD || 'dev_password_change_in_prod'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'audit'}`;

  return new PostgresOnlyStorage(connectionString);
}
