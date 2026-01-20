/**
 * Storage module - provider-agnostic interface for immutable audit data.
 *
 * Available providers:
 * - PostgresOnlyStorage: Demo/development (no external dependencies)
 * - (Future) S3ObjectLockStorage: AWS production with SEC 17a-4 compliance
 * - (Future) AzureBlobStorage: Azure Immutable Storage
 * - (Future) GcsStorage: GCP Cloud Storage with Bucket Lock
 */

export * from './interface.js';
export { PostgresOnlyStorage, createPostgresStorage } from './providers/postgres-only.js';
