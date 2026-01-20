/**
 * Shared utilities for storage providers.
 */

import { Readable } from 'node:stream';
import { StorageError, StorageErrorCode } from './interface.js';

/**
 * Convert a readable stream to a Buffer.
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Normalized error shape from cloud SDKs.
 */
export interface CloudError extends Error {
  code?: string;
  Code?: string;
  statusCode?: number;
  $metadata?: {
    httpStatusCode?: number;
  };
}

/**
 * Map cloud SDK error to StorageErrorCode.
 */
export function mapCloudError(err: unknown, key: string): StorageError {
  const error = err as CloudError;
  const httpStatus = error.$metadata?.httpStatusCode ?? error.statusCode;
  const errorCode = error.code ?? error.Code;

  // Not found
  if (
    httpStatus === 404 ||
    errorCode === 'NoSuchKey' ||
    errorCode === 'NotFound' ||
    errorCode === 'BlobNotFound' ||
    error.name === 'NotFound'
  ) {
    return new StorageError(`Object not found: ${key}`, 'NOT_FOUND', error);
  }

  // Already exists
  if (
    httpStatus === 409 ||
    errorCode === 'BlobAlreadyExists' ||
    errorCode === 'EntityAlreadyExists'
  ) {
    return new StorageError(`Object already exists: ${key}`, 'ALREADY_EXISTS', error);
  }

  // Permission denied
  if (
    httpStatus === 403 ||
    errorCode === 'AccessDenied' ||
    errorCode === 'AuthorizationFailure'
  ) {
    return new StorageError(`Access denied: ${key}`, 'PERMISSION_DENIED', error);
  }

  // Bucket/container not found
  if (
    errorCode === 'NoSuchBucket' ||
    errorCode === 'ContainerNotFound'
  ) {
    return new StorageError(`Container not found`, 'CONNECTION_FAILED', error);
  }

  // Retention/legal hold active
  if (
    errorCode === 'ObjectLocked' ||
    errorCode === 'ImmutabilityPolicyLocked'
  ) {
    return new StorageError(`Object is locked: ${key}`, 'RETENTION_ACTIVE', error);
  }

  // Default
  return new StorageError(`Storage operation failed: ${key}`, 'UNKNOWN', error);
}
