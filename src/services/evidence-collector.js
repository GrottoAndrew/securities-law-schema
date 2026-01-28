/**
 * Evidence Collector Service
 *
 * Generic interface for automated evidence collection from any source system.
 * Implementations pull evidence from external systems and submit to the locker.
 *
 * @module services/evidence-collector
 */

import { createHash, randomUUID } from 'crypto';

/**
 * @typedef {Object} CollectorConfig
 * @property {string} id - Unique collector identifier
 * @property {string} name - Human-readable name
 * @property {string} type - Collector type (api, webhook, file, database)
 * @property {string} schedule - Cron expression for scheduled collection
 * @property {string[]} controlIds - Controls this collector provides evidence for
 * @property {boolean} enabled - Whether collector is active
 * @property {Object} config - Collector-specific configuration (credentials, endpoints)
 */

/**
 * @typedef {Object} CollectedEvidence
 * @property {string} controlId - Control this evidence satisfies
 * @property {Buffer|string} content - Raw evidence content
 * @property {string} contentType - MIME type
 * @property {Object} metadata - Source-specific metadata
 * @property {string} sourceSystem - Identifier of source system
 * @property {string} collectedAt - ISO timestamp
 */

/**
 * Base class for evidence collectors.
 * Extend this class to create collectors for specific source systems.
 */
export class EvidenceCollector {
  /**
   * @param {CollectorConfig} config
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.schedule = config.schedule;
    this.controlIds = config.controlIds;
    this.enabled = config.enabled;
    this.config = config.config || {};
  }

  /**
   * Collect evidence from the source system.
   * Override this method in subclasses.
   *
   * @returns {Promise<CollectedEvidence[]>}
   */
  async collect() {
    throw new Error('collect() must be implemented by subclass');
  }

  /**
   * Test connectivity to the source system.
   * Override this method in subclasses.
   *
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  /**
   * Hash evidence content for storage.
   *
   * @param {Buffer|string} content
   * @returns {string} SHA-256 hash
   */
  hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate Merkle leaf hash for evidence chain.
   *
   * @param {string} artifactHash
   * @param {string} controlId
   * @param {string} timestamp
   * @returns {string}
   */
  generateMerkleLeaf(artifactHash, controlId, timestamp) {
    const preimage = `${artifactHash}|${controlId}|${timestamp}`;
    return createHash('sha256').update(preimage).digest('hex');
  }

  /**
   * Transform collected evidence to API submission format.
   *
   * @param {CollectedEvidence} evidence
   * @returns {Object} Evidence ready for API submission
   */
  toEvidenceRecord(evidence) {
    const artifactHash = this.hashContent(evidence.content);
    const collectedAt = evidence.collectedAt || new Date().toISOString();

    return {
      id: randomUUID(),
      controlId: evidence.controlId,
      artifactHash,
      artifactSize: Buffer.byteLength(evidence.content),
      contentType: evidence.contentType,
      merkleLeafHash: this.generateMerkleLeaf(artifactHash, evidence.controlId, collectedAt),
      collectedAt,
      collectedBy: `collector:${this.id}`,
      status: 'active',
      metadata: {
        ...evidence.metadata,
        sourceSystem: evidence.sourceSystem || this.name,
        collectorId: this.id,
        collectorType: this.type,
      },
    };
  }
}

/**
 * API-based evidence collector.
 * Pulls evidence from REST APIs.
 */
export class ApiCollector extends EvidenceCollector {
  constructor(config) {
    super({ ...config, type: 'api' });
    this.endpoint = config.config?.endpoint;
    this.headers = config.config?.headers || {};
    this.authType = config.config?.authType; // bearer, basic, apikey
    this.authValue = config.config?.authValue;
  }

  async testConnection() {
    if (!this.endpoint) {
      return { success: false, message: 'No endpoint configured' };
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'HEAD',
        headers: this.getAuthHeaders(),
      });
      return {
        success: response.ok,
        message: response.ok ? 'Connected' : `HTTP ${response.status}`,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  getAuthHeaders() {
    const headers = { ...this.headers };

    if (this.authType === 'bearer' && this.authValue) {
      headers['Authorization'] = `Bearer ${this.authValue}`;
    } else if (this.authType === 'basic' && this.authValue) {
      headers['Authorization'] = `Basic ${Buffer.from(this.authValue).toString('base64')}`;
    } else if (this.authType === 'apikey' && this.authValue) {
      headers['X-API-Key'] = this.authValue;
    }

    return headers;
  }

  /**
   * Override to implement API-specific collection logic.
   * Default implementation fetches JSON from endpoint.
   */
  async collect() {
    if (!this.endpoint) {
      throw new Error('No endpoint configured');
    }

    const response = await fetch(this.endpoint, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = JSON.stringify(data, null, 2);

    // Default: single evidence record for all configured controls
    return this.controlIds.map(controlId => ({
      controlId,
      content,
      contentType: 'application/json',
      metadata: {
        endpoint: this.endpoint,
        responseStatus: response.status,
        fetchedAt: new Date().toISOString(),
      },
      sourceSystem: this.name,
      collectedAt: new Date().toISOString(),
    }));
  }
}

/**
 * Webhook-based evidence collector.
 * Receives evidence pushed from external systems.
 */
export class WebhookCollector extends EvidenceCollector {
  constructor(config) {
    super({ ...config, type: 'webhook' });
    this.webhookPath = config.config?.path || `/webhooks/${this.id}`;
    this.secret = config.config?.secret;
  }

  async testConnection() {
    // Webhooks are passive; connection is valid if secret is configured
    return {
      success: !!this.secret,
      message: this.secret ? 'Webhook configured' : 'No webhook secret configured',
    };
  }

  /**
   * Webhooks don't actively collect; they receive.
   * This method validates incoming webhook payloads.
   */
  async collect() {
    // Webhooks are event-driven, not scheduled
    return [];
  }

  /**
   * Validate webhook signature.
   *
   * @param {string} payload - Raw request body
   * @param {string} signature - Signature header value
   * @returns {boolean}
   */
  validateSignature(payload, signature) {
    if (!this.secret) return false;

    const expected = createHash('sha256')
      .update(payload + this.secret)
      .digest('hex');

    return signature === expected || signature === `sha256=${expected}`;
  }

  /**
   * Process incoming webhook payload.
   *
   * @param {Object} payload - Webhook payload
   * @param {string} controlId - Control to associate evidence with
   * @returns {CollectedEvidence}
   */
  processPayload(payload, controlId) {
    return {
      controlId,
      content: JSON.stringify(payload),
      contentType: 'application/json',
      metadata: {
        webhookId: this.id,
        receivedAt: new Date().toISOString(),
      },
      sourceSystem: this.name,
      collectedAt: new Date().toISOString(),
    };
  }
}

/**
 * File-based evidence collector.
 * Monitors directories or file systems for evidence.
 */
export class FileCollector extends EvidenceCollector {
  constructor(config) {
    super({ ...config, type: 'file' });
    this.watchPath = config.config?.path;
    this.pattern = config.config?.pattern || '*';
    this.processed = new Set();
  }

  async testConnection() {
    if (!this.watchPath) {
      return { success: false, message: 'No watch path configured' };
    }

    try {
      const fs = await import('fs/promises');
      await fs.access(this.watchPath);
      return { success: true, message: `Path accessible: ${this.watchPath}` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async collect() {
    if (!this.watchPath) {
      throw new Error('No watch path configured');
    }

    const fs = await import('fs/promises');
    const path = await import('path');

    const files = await fs.readdir(this.watchPath);
    const evidence = [];

    for (const file of files) {
      // Skip already processed files
      if (this.processed.has(file)) continue;

      // Match pattern (simple glob)
      if (this.pattern !== '*') {
        const regex = new RegExp(this.pattern.replace(/\*/g, '.*'));
        if (!regex.test(file)) continue;
      }

      const filePath = path.join(this.watchPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        const content = await fs.readFile(filePath);
        const ext = path.extname(file).toLowerCase();
        const contentType = this.getContentType(ext);

        // Map to first configured control (or all)
        for (const controlId of this.controlIds) {
          evidence.push({
            controlId,
            content,
            contentType,
            metadata: {
              filename: file,
              path: filePath,
              size: stat.size,
              modified: stat.mtime.toISOString(),
            },
            sourceSystem: this.name,
            collectedAt: new Date().toISOString(),
          });
        }

        this.processed.add(file);
      }
    }

    return evidence;
  }

  getContentType(ext) {
    const types = {
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };
    return types[ext] || 'application/octet-stream';
  }
}

/**
 * Database-based evidence collector.
 * Queries databases for compliance evidence.
 */
export class DatabaseCollector extends EvidenceCollector {
  constructor(config) {
    super({ ...config, type: 'database' });
    this.connectionString = config.config?.connectionString;
    this.query = config.config?.query;
  }

  async testConnection() {
    if (!this.connectionString) {
      return { success: false, message: 'No connection string configured' };
    }

    // Connection test would require database driver
    // This is a placeholder for the interface
    return {
      success: true,
      message: 'Database collector configured (connection test requires driver)',
    };
  }

  /**
   * @returns {Promise<CollectedEvidence[]>}
   */
  async collect() {
    // Database collection requires driver integration
    // This defines the interface; implementation depends on database type
    throw new Error(
      'Database collector requires driver integration. ' +
        'Implement collect() with your database driver (pg, mysql2, mongodb, etc.)'
    );
  }
}

/**
 * Collector registry and manager.
 */
export class CollectorManager {
  constructor() {
    /** @type {Map<string, EvidenceCollector>} */
    this.collectors = new Map();
    this.submitEvidence = null; // Set by application
  }

  /**
   * Register evidence submission function.
   *
   * @param {Function} submitFn - Async function that submits evidence to the locker
   */
  setSubmitFunction(submitFn) {
    this.submitEvidence = submitFn;
  }

  /**
   * Register a collector.
   *
   * @param {EvidenceCollector} collector
   */
  register(collector) {
    this.collectors.set(collector.id, collector);
  }

  /**
   * Unregister a collector.
   *
   * @param {string} id
   */
  unregister(id) {
    this.collectors.delete(id);
  }

  /**
   * Get collector by ID.
   *
   * @param {string} id
   * @returns {EvidenceCollector|undefined}
   */
  get(id) {
    return this.collectors.get(id);
  }

  /**
   * List all collectors.
   *
   * @returns {EvidenceCollector[]}
   */
  list() {
    return Array.from(this.collectors.values());
  }

  /**
   * Run collection for a specific collector.
   *
   * @param {string} id - Collector ID
   * @returns {Promise<{success: boolean, collected: number, errors: string[]}>}
   */
  async runCollector(id) {
    const collector = this.collectors.get(id);
    if (!collector) {
      return { success: false, collected: 0, errors: [`Collector not found: ${id}`] };
    }

    if (!collector.enabled) {
      return { success: false, collected: 0, errors: ['Collector is disabled'] };
    }

    const errors = [];
    let collected = 0;

    try {
      const evidence = await collector.collect();

      for (const item of evidence) {
        try {
          const record = collector.toEvidenceRecord(item);

          if (this.submitEvidence) {
            await this.submitEvidence(record);
          }

          collected++;
        } catch (err) {
          errors.push(`Failed to submit evidence: ${err.message}`);
        }
      }
    } catch (err) {
      errors.push(`Collection failed: ${err.message}`);
    }

    return {
      success: errors.length === 0,
      collected,
      errors,
    };
  }

  /**
   * Run all enabled collectors.
   *
   * @returns {Promise<Object.<string, {success: boolean, collected: number, errors: string[]}>>}
   */
  async runAll() {
    /** @type {Record<string, {success: boolean, collected: number, errors: string[]}>} */
    const results = {};

    for (const [id, collector] of this.collectors) {
      if (collector.enabled) {
        results[id] = await this.runCollector(id);
      }
    }

    return results;
  }

  /**
   * Test all collector connections.
   *
   * @returns {Promise<Object.<string, {success: boolean, message: string}>>}
   */
  async testAll() {
    /** @type {Record<string, {success: boolean, message: string}>} */
    const results = {};

    for (const [id, collector] of this.collectors) {
      results[id] = await collector.testConnection();
    }

    return results;
  }
}

// Singleton instance
export const collectorManager = new CollectorManager();
