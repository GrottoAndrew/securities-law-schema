/**
 * Storage Provider Factory
 *
 * Selects and configures the appropriate storage provider based on environment
 * variables. This allows deployment flexibility - same code runs with different
 * storage backends depending on the environment.
 *
 * Provider Selection Priority:
 * 1. STORAGE_PROVIDER env var (explicit selection)
 * 2. Auto-detect based on available credentials
 * 3. Fall back to PostgreSQL for demo/development
 *
 * Environment Variables:
 * - STORAGE_PROVIDER: 's3' | 'azure' | 'postgres' | 'backblaze'
 *
 * Provider-specific variables (see individual providers for full list):
 * - S3: AWS_REGION, S3_BUCKET, S3_LOCK_MODE
 * - Azure: AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME
 * - PostgreSQL: DATABASE_URL
 * - Backblaze: B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME
 */

import { ImmutableStorage, StorageCapabilities } from './interface.js';

// =============================================================================
// Types
// =============================================================================

export type StorageProviderType = 's3' | 'azure' | 'postgres' | 'backblaze';

export interface StorageFactoryConfig {
  /** Override provider selection (ignores auto-detection) */
  provider?: StorageProviderType;
  /** Custom configuration passed to provider constructor */
  providerConfig?: Record<string, unknown>;
}

export interface StorageFactoryResult {
  /** The configured storage instance */
  storage: ImmutableStorage;
  /** Which provider was selected */
  provider: StorageProviderType;
  /** Provider capabilities */
  capabilities: StorageCapabilities;
  /** Whether this is a demo/non-WORM provider */
  isDemo: boolean;
}

// =============================================================================
// Provider Detection
// =============================================================================

/**
 * Detect which provider to use based on available environment variables.
 */
function detectProvider(): StorageProviderType {
  // Check for explicit provider selection
  const explicit = process.env.STORAGE_PROVIDER?.toLowerCase();
  if (explicit === 's3' || explicit === 'azure' || explicit === 'postgres' || explicit === 'backblaze') {
    return explicit;
  }

  // Auto-detect based on credentials present
  // S3: Need region and bucket at minimum
  if (process.env.S3_BUCKET && (process.env.AWS_REGION || process.env.S3_REGION)) {
    return 's3';
  }

  // Azure: Need account name and container
  if (
    process.env.AZURE_STORAGE_ACCOUNT_NAME &&
    process.env.AZURE_STORAGE_CONTAINER_NAME
  ) {
    return 'azure';
  }

  // Azure: Connection string also works
  if (process.env.AZURE_STORAGE_CONNECTION_STRING && process.env.AZURE_STORAGE_CONTAINER_NAME) {
    return 'azure';
  }

  // Backblaze: Need key ID, key, and bucket
  if (
    process.env.B2_APPLICATION_KEY_ID &&
    process.env.B2_APPLICATION_KEY &&
    process.env.B2_BUCKET_NAME
  ) {
    return 'backblaze';
  }

  // Default to PostgreSQL (demo mode)
  return 'postgres';
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a storage provider instance based on environment configuration.
 *
 * Usage:
 * ```typescript
 * const { storage, provider, isDemo } = await createStorage();
 *
 * if (isDemo) {
 *   console.warn('Running in demo mode - no WORM compliance');
 * }
 *
 * await storage.store('evidence/doc.pdf', buffer);
 * ```
 */
export async function createStorage(
  config?: StorageFactoryConfig
): Promise<StorageFactoryResult> {
  const provider = config?.provider ?? detectProvider();

  let storage: ImmutableStorage;
  let isDemo = false;

  switch (provider) {
    case 's3': {
      const { createS3ObjectLockStorage } = await import('./providers/s3-object-lock.js');
      storage = createS3ObjectLockStorage();
      break;
    }

    case 'azure': {
      const { createAzureImmutableStorage } = await import('./providers/azure-immutable.js');
      storage = createAzureImmutableStorage();
      break;
    }

    case 'backblaze': {
      const { createBackblazeB2Storage } = await import('./providers/backblaze-b2.js');
      storage = createBackblazeB2Storage();
      // Backblaze B2 doesn't have Object Lock - it's for cost optimization, not WORM
      isDemo = true;
      break;
    }

    case 'postgres':
    default: {
      const { createPostgresStorage } = await import('./providers/postgres-only.js');
      storage = createPostgresStorage();
      isDemo = true;
      break;
    }
  }

  const capabilities = storage.getCapabilities();

  // WORM check - only S3 COMPLIANCE and Azure Locked are truly WORM
  if (!capabilities.supportsWORM) {
    isDemo = true;
  }

  return {
    storage,
    provider,
    capabilities,
    isDemo,
  };
}

/**
 * Create storage and verify it's healthy before returning.
 *
 * Throws if the health check fails - use this in application startup.
 */
export async function createStorageWithHealthCheck(
  config?: StorageFactoryConfig
): Promise<StorageFactoryResult> {
  const result = await createStorage(config);

  const healthy = await result.storage.healthCheck();
  if (!healthy) {
    throw new Error(
      `Storage health check failed for provider: ${result.provider}. ` +
      `Check your credentials and network connectivity.`
    );
  }

  return result;
}

/**
 * Get information about which provider would be selected without creating it.
 *
 * Useful for startup logging and configuration validation.
 */
export function getStorageProviderInfo(): {
  provider: StorageProviderType;
  isExplicit: boolean;
  missingCredentials: string[];
} {
  const explicit = process.env.STORAGE_PROVIDER?.toLowerCase();
  const isExplicit = ['s3', 'azure', 'postgres', 'backblaze'].includes(explicit ?? '');
  const provider = isExplicit ? (explicit as StorageProviderType) : detectProvider();

  const missingCredentials: string[] = [];

  switch (provider) {
    case 's3':
      if (!process.env.AWS_REGION && !process.env.S3_REGION) {
        missingCredentials.push('AWS_REGION or S3_REGION');
      }
      if (!process.env.S3_BUCKET) {
        missingCredentials.push('S3_BUCKET');
      }
      break;

    case 'azure':
      if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        if (!process.env.AZURE_STORAGE_ACCOUNT_NAME) {
          missingCredentials.push('AZURE_STORAGE_ACCOUNT_NAME');
        }
      }
      if (!process.env.AZURE_STORAGE_CONTAINER_NAME) {
        missingCredentials.push('AZURE_STORAGE_CONTAINER_NAME');
      }
      break;

    case 'backblaze':
      if (!process.env.B2_APPLICATION_KEY_ID) {
        missingCredentials.push('B2_APPLICATION_KEY_ID');
      }
      if (!process.env.B2_APPLICATION_KEY) {
        missingCredentials.push('B2_APPLICATION_KEY');
      }
      if (!process.env.B2_BUCKET_NAME) {
        missingCredentials.push('B2_BUCKET_NAME');
      }
      break;

    case 'postgres':
      // PostgreSQL has sensible defaults, so nothing is strictly required
      // but DATABASE_URL is preferred
      if (!process.env.DATABASE_URL && !process.env.PGHOST) {
        missingCredentials.push('DATABASE_URL (optional - will use localhost defaults)');
      }
      break;
  }

  return {
    provider,
    isExplicit,
    missingCredentials,
  };
}

/**
 * Validate that all required environment variables are set for a provider.
 *
 * Returns validation errors (empty array if valid).
 */
export function validateStorageConfig(provider?: StorageProviderType): string[] {
  const targetProvider = provider ?? detectProvider();
  const errors: string[] = [];

  switch (targetProvider) {
    case 's3':
      if (!process.env.AWS_REGION && !process.env.S3_REGION) {
        errors.push('Missing AWS_REGION or S3_REGION');
      }
      if (!process.env.S3_BUCKET) {
        errors.push('Missing S3_BUCKET');
      }
      break;

    case 'azure':
      if (!process.env.AZURE_STORAGE_CONNECTION_STRING && !process.env.AZURE_STORAGE_ACCOUNT_NAME) {
        errors.push('Missing AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME');
      }
      if (!process.env.AZURE_STORAGE_CONTAINER_NAME) {
        errors.push('Missing AZURE_STORAGE_CONTAINER_NAME');
      }
      break;

    case 'backblaze':
      if (!process.env.B2_APPLICATION_KEY_ID) {
        errors.push('Missing B2_APPLICATION_KEY_ID');
      }
      if (!process.env.B2_APPLICATION_KEY) {
        errors.push('Missing B2_APPLICATION_KEY');
      }
      if (!process.env.B2_BUCKET_NAME) {
        errors.push('Missing B2_BUCKET_NAME');
      }
      break;

    case 'postgres':
      // PostgreSQL has defaults, so we just warn
      break;
  }

  return errors;
}

// =============================================================================
// Compliance Helpers
// =============================================================================

/**
 * Check if the current storage configuration meets SEC 17a-4 requirements.
 *
 * Returns detailed compliance status for regulatory documentation.
 */
export async function checkComplianceStatus(): Promise<{
  compliant: boolean;
  provider: StorageProviderType;
  capabilities: StorageCapabilities;
  issues: string[];
  recommendations: string[];
}> {
  const { storage, provider, capabilities } = await createStorage();
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check WORM support
  if (!capabilities.supportsWORM) {
    issues.push('Storage provider does not support WORM (Write Once Read Many)');
    recommendations.push('For SEC 17a-4 compliance, use S3 Object Lock (COMPLIANCE mode) or Azure Immutable Storage');
  }

  // Check retention support
  if (!capabilities.supportsRetention) {
    issues.push('Storage provider does not support retention policies');
  }

  // Check legal hold support
  if (!capabilities.supportsLegalHold) {
    issues.push('Storage provider does not support legal holds');
    recommendations.push('Legal holds are required for litigation preservation');
  }

  // Provider-specific checks
  if (provider === 'postgres') {
    issues.push('PostgreSQL storage is for demo/development only');
    issues.push('Database administrators can modify or delete records');
    recommendations.push('Do NOT use PostgreSQL storage for production compliance');
  }

  if (provider === 'backblaze') {
    issues.push('Backblaze B2 does not provide Object Lock/WORM');
    recommendations.push('Backblaze B2 is cost-effective for non-regulated storage');
    recommendations.push('Use S3 or Azure for regulated records');
  }

  if (provider === 's3') {
    const lockMode = process.env.S3_LOCK_MODE;
    if (lockMode === 'GOVERNANCE') {
      issues.push('S3 is configured with GOVERNANCE mode (not COMPLIANCE)');
      recommendations.push('GOVERNANCE mode allows privileged users to delete objects');
      recommendations.push('Use COMPLIANCE mode for SEC 17a-4');
    }
  }

  const healthy = await storage.healthCheck();
  if (!healthy) {
    issues.push('Storage health check failed - cannot verify compliance');
  }

  return {
    compliant: issues.length === 0,
    provider,
    capabilities,
    issues,
    recommendations,
  };
}
