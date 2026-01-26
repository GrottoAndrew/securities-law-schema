/**
 * Configuration Management
 *
 * Validates all required environment variables on startup.
 * Fails fast with helpful error messages if configuration is invalid.
 */

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  try {
    // @ts-ignore - dotenv is optional, may not be installed
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not installed, continue with process.env
  }
}

class ConfigurationError extends Error {
  constructor(message, missingVars = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.missingVars = missingVars;
  }
}

function requireEnv(name, defaultValue = undefined) {
  const value = process.env[name] || defaultValue;
  if (value === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireEnvInt(name, defaultValue = undefined) {
  const value = requireEnv(name, defaultValue?.toString());
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ConfigurationError(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

function requireEnvBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function validateConfig(config) {
  const errors = [];

  // JWT Secret validation
  if (config.auth.jwtSecret === 'CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32') {
    errors.push('JWT_SECRET must be changed from default value');
  }
  if (config.auth.jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  // Production-specific validations
  if (config.env === 'production') {
    if (!config.database.url || config.database.url.includes('localhost')) {
      errors.push('DATABASE_URL must be set to a production database in production mode');
    }
    if (!config.aws.accessKeyId) {
      errors.push('AWS_ACCESS_KEY_ID is required in production');
    }
    if (!config.compliance.enableWormStorage) {
      errors.push('WORM storage must be enabled in production for SEC compliance');
    }
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
}

// Build configuration object
const config = {
  env: process.env.NODE_ENV || 'development',
  port: requireEnvInt('PORT', 3001),
  logLevel: process.env.LOG_LEVEL || 'info',

  auth: {
    jwtSecret: requireEnv('JWT_SECRET', 'development-secret-change-in-production'),
    jwtIssuer: process.env.JWT_ISSUER || 'securities-law-schema',
    jwtAudience: process.env.JWT_AUDIENCE || 'compliance-dashboard',
    accessExpiry: requireEnvInt('JWT_ACCESS_EXPIRY', 86400),
    auditorExpiry: requireEnvInt('JWT_AUDITOR_EXPIRY', 259200),
  },

  database: {
    url: process.env.DATABASE_URL,
    poolMin: requireEnvInt('DATABASE_POOL_MIN', 2),
    poolMax: requireEnvInt('DATABASE_POOL_MAX', 10),
    ssl: requireEnvBool('DATABASE_SSL', false),
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_EVIDENCE_BUCKET || 'evidence-locker-artifacts',
    enableObjectLock: requireEnvBool('S3_ENABLE_OBJECT_LOCK', true),
    kmsKeyId: process.env.KMS_KEY_ID,
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(','),
  },

  rateLimit: {
    windowMs: requireEnvInt('RATE_LIMIT_WINDOW_MS', 60000),
    maxRequests: requireEnvInt('RATE_LIMIT_MAX_REQUESTS', 100),
    authMaxRequests: requireEnvInt('RATE_LIMIT_AUTH_MAX', 5),
  },

  compliance: {
    primaryJurisdiction: process.env.PRIMARY_JURISDICTION || 'sec',
    secRetentionYears: requireEnvInt('SEC_RETENTION_YEARS', 7),
    enableWormStorage: requireEnvBool('ENABLE_WORM_STORAGE', true),
  },

  inMemoryLimits: {
    // Development: lower limits to catch issues early
    // Production: higher limits as safety net (should use PostgreSQL)
    evidenceSoftLimit: requireEnvInt(
      'IN_MEMORY_EVIDENCE_LIMIT',
      process.env.NODE_ENV === 'production' ? 10000 : 1000
    ),
    auditLogSoftLimit: requireEnvInt(
      'IN_MEMORY_AUDIT_LIMIT',
      process.env.NODE_ENV === 'production' ? 50000 : 5000
    ),
  },

  notifications: {
    enabled: requireEnvBool('NOTIFICATIONS_ENABLED', false),
    email: process.env.NOTIFICATION_EMAIL,
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    teamsWebhook: process.env.TEAMS_WEBHOOK_URL,
  },

  testing: {
    cadence: process.env.TEST_CADENCE || 'hot',
    enableRedteam: requireEnvBool('ENABLE_REDTEAM', true),
  },

  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
    datadogApiKey: process.env.DD_API_KEY,
  },

  integrations: {
    pershingApiUrl: process.env.PERSHING_API_URL,
    pershingApiKey: process.env.PERSHING_API_KEY,
    edgarApiUrl: process.env.EDGAR_API_URL || 'https://www.sec.gov/cgi-bin/browse-edgar',
  },
};

// Validate configuration
try {
  validateConfig(config);
} catch (err) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: Configuration error');
    console.error(err.message);
    process.exit(1);
  } else {
    console.warn('WARNING: Configuration issues detected (ignored in development)');
    console.warn(err.message);
  }
}

export default config;
export { ConfigurationError };
