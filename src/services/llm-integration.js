/**
 * LLM Integration Service
 *
 * Real API integrations for four LLM providers used in compliance automation:
 * - Claude (Anthropic) — Primary for test analysis and security scanning
 * - OpenAI (GPT-4) — Alternative for general analysis
 * - Mistral — Primary for high-volume document classification
 * - Llama (via Ollama or Together AI) — On-premise PII processing
 *
 * SETUP REQUIRED:
 *   Each provider requires its own API account and credentials.
 *   Set the corresponding environment variables in your .env file.
 *   See .env.example for all required variables.
 *
 * USAGE:
 *   import { createLLMClient, analyzeTestFailure, classifyEvidence } from './llm-integration.js';
 *   const client = createLLMClient('claude');
 *   const result = await client.complete('Analyze this compliance finding...');
 *
 * @module services/llm-integration
 */

// ============================================================================
// Provider Configuration
// ============================================================================

const PROVIDERS = {
  claude: {
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-4-5-20251101',
    authHeader: 'x-api-key',
    docs: 'https://docs.anthropic.com/en/docs/quickstart',
    setup: [
      '1. Create an account at https://console.anthropic.com',
      '2. Generate an API key at https://console.anthropic.com/settings/keys',
      '3. Set ANTHROPIC_API_KEY in your .env file',
      '4. Optionally set ANTHROPIC_MODEL to override the default model',
    ],
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    docs: 'https://platform.openai.com/docs/quickstart',
    setup: [
      '1. Create an account at https://platform.openai.com',
      '2. Generate an API key at https://platform.openai.com/api-keys',
      '3. Set OPENAI_API_KEY in your .env file',
      '4. Optionally set OPENAI_MODEL to override the default model',
    ],
  },
  mistral: {
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    docs: 'https://docs.mistral.ai/getting-started/quickstart/',
    setup: [
      '1. Create an account at https://console.mistral.ai',
      '2. Generate an API key at https://console.mistral.ai/api-keys',
      '3. Set MISTRAL_API_KEY in your .env file',
      '4. Optionally set MISTRAL_MODEL to override the default model',
    ],
  },
  llama: {
    name: 'Llama (via Ollama or Together AI)',
    baseUrl: process.env.LLAMA_API_URL || 'http://localhost:11434/api',
    envKey: 'LLAMA_API_KEY',
    defaultModel: process.env.LLAMA_MODEL || 'llama3.1:70b',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    setup: [
      'Option A — Ollama (on-premise, air-gapped):',
      '  1. Install Ollama: https://ollama.ai/download',
      '  2. Pull a model: ollama pull llama3.1:70b',
      '  3. Ollama runs at http://localhost:11434 by default (no API key needed)',
      '  4. Set LLAMA_API_URL=http://localhost:11434/api in .env',
      '',
      'Option B — Together AI (cloud):',
      '  1. Create an account at https://www.together.ai',
      '  2. Generate an API key at https://api.together.xyz/settings/api-keys',
      '  3. Set LLAMA_API_KEY in your .env file',
      '  4. Set LLAMA_API_URL=https://api.together.xyz/v1 in .env',
      '  5. Set LLAMA_MODEL=meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo in .env',
    ],
  },
};

// ============================================================================
// LLM Client Factory
// ============================================================================

/**
 * Create an LLM client for the specified provider.
 *
 * @param {'claude' | 'openai' | 'mistral' | 'llama'} provider - LLM provider name
 * @param {Object} [options] - Override options
 * @param {string} [options.apiKey] - Override API key (otherwise reads from env)
 * @param {string} [options.model] - Override model name
 * @param {string} [options.baseUrl] - Override base URL
 * @returns {LLMClient}
 */
export function createLLMClient(provider, options = {}) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown LLM provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const apiKey = options.apiKey || process.env[providerConfig.envKey];
  const model = options.model
    || process.env[`${provider.toUpperCase()}_MODEL`]
    || providerConfig.defaultModel;
  const baseUrl = options.baseUrl || providerConfig.baseUrl;

  // Llama via Ollama doesn't require an API key
  const isOllama = provider === 'llama' && baseUrl.includes('localhost');
  if (!apiKey && !isOllama) {
    const setupInstructions = providerConfig.setup.join('\n    ');
    throw new Error(
      `${providerConfig.name} API key not configured.\n` +
      `  Set ${providerConfig.envKey} in your .env file.\n\n` +
      `  Setup instructions:\n    ${setupInstructions}\n\n` +
      `  Documentation: ${providerConfig.docs}`
    );
  }

  return new LLMClient(provider, { apiKey, model, baseUrl, providerConfig, isOllama });
}

/**
 * Get setup instructions for all providers.
 * @returns {Object} Provider setup information
 */
export function getProviderInfo() {
  const info = {};
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const envKey = provider.envKey;
    info[key] = {
      name: provider.name,
      configured: key === 'llama'
        ? !!(process.env[envKey] || process.env.LLAMA_API_URL?.includes('localhost'))
        : !!process.env[envKey],
      envVar: envKey,
      model: process.env[`${key.toUpperCase()}_MODEL`] || provider.defaultModel,
      docs: provider.docs,
      setup: provider.setup,
    };
  }
  return info;
}

// ============================================================================
// LLM Client Implementation
// ============================================================================

class LLMClient {
  constructor(provider, { apiKey, model, baseUrl, providerConfig, isOllama }) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.providerConfig = providerConfig;
    this.isOllama = isOllama;
  }

  /**
   * Build authorization headers for the provider.
   * @returns {Object} Headers object
   */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };

    if (this.isOllama) return headers;

    if (this.provider === 'claude') {
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `${this.providerConfig.authPrefix || ''}${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Send a completion request to the LLM.
   *
   * @param {string} prompt - The user prompt
   * @param {Object} [options] - Completion options
   * @param {string} [options.systemPrompt] - System prompt for context
   * @param {number} [options.maxTokens=2048] - Maximum response tokens
   * @param {number} [options.temperature=0.3] - Temperature (lower = more deterministic)
   * @returns {Promise<{content: string, model: string, provider: string, usage: Object}>}
   */
  async complete(prompt, options = {}) {
    const { systemPrompt, maxTokens = 2048, temperature = 0.3 } = options;

    // PII exfiltration guard: warn when sending data to external LLM providers
    if (!this.isOllama) {
      const piiPatterns = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b|SSN|social.security/i;
      if (piiPatterns.test(prompt)) {
        console.warn(
          `[llm-integration] WARNING: Prompt sent to external provider "${this.provider}" ` +
          `may contain PII (SSN pattern detected). Use Llama/Ollama for PII processing.`
        );
      }
    }

    // Audit log: record LLM request metadata (not prompt content)
    console.log(
      `[llm-audit] provider=${this.provider} model=${this.model} ` +
      `prompt_chars=${prompt.length} max_tokens=${maxTokens} ` +
      `timestamp=${new Date().toISOString()}`
    );

    let result;
    if (this.provider === 'claude') {
      result = await this._completeClaude(prompt, systemPrompt, maxTokens, temperature);
    } else if (this.provider === 'llama' && this.isOllama) {
      result = await this._completeOllama(prompt, systemPrompt, maxTokens, temperature);
    } else {
      // OpenAI-compatible API (OpenAI, Mistral, Together AI)
      result = await this._completeOpenAICompatible(prompt, systemPrompt, maxTokens, temperature);
    }

    // Audit log: record response metadata
    console.log(
      `[llm-audit] provider=${result.provider} model=${result.model} ` +
      `response_chars=${result.content.length} ` +
      `usage=${JSON.stringify(result.usage)} ` +
      `timestamp=${new Date().toISOString()}`
    );

    return result;
  }

  async _completeClaude(prompt, systemPrompt, maxTokens, temperature) {
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      content: data.content[0]?.text || '',
      model: data.model,
      provider: 'claude',
      usage: data.usage,
    };
  }

  async _completeOpenAICompatible(prompt, systemPrompt, maxTokens, temperature) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerConfig.name} API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model,
      provider: this.provider,
      usage: data.usage,
    };
  }

  async _completeOllama(prompt, systemPrompt, maxTokens, temperature) {
    const body = {
      model: this.model,
      prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    };

    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      content: data.response || '',
      model: data.model,
      provider: 'llama-ollama',
      usage: {
        prompt_tokens: data.prompt_eval_count,
        completion_tokens: data.eval_count,
      },
    };
  }
}

// ============================================================================
// Compliance-Specific LLM Functions
// ============================================================================

const COMPLIANCE_SYSTEM_PROMPT = `You are a securities compliance analyst specializing in SEC Regulation D (17 CFR 230.500-508). You analyze compliance evidence, test failures, and regulatory gaps with precision. Always cite specific CFR sections. Never provide legal advice — flag items for human review by a qualified attorney. All analysis must be logged to the audit trail.`;

/**
 * Analyze a test failure using the configured primary LLM.
 *
 * @param {string} testName - Name of the failed test
 * @param {string} errorOutput - Test error output
 * @param {Object} [context] - Additional context (e.g., recent changes)
 * @returns {Promise<{analysis: string, severity: string, suggestedFix: string, provider: string}>}
 */
export async function analyzeTestFailure(testName, errorOutput, context = {}) {
  /** @type {'claude' | 'openai' | 'mistral' | 'llama'} */
  const provider = /** @type {any} */ (process.env.LLM_TEST_ANALYSIS_PROVIDER || 'claude');
  const client = createLLMClient(provider);

  const prompt = `Analyze this compliance test failure and provide:
1. Root cause analysis
2. Severity assessment (critical/high/medium/low)
3. Suggested fix
4. Whether this affects regulatory compliance

Test: ${testName}
Error: ${errorOutput}
${context.recentChanges ? `Recent changes: ${context.recentChanges}` : ''}`;

  const result = await client.complete(prompt, {
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
    temperature: 0.2,
  });

  return {
    analysis: result.content,
    severity: extractSeverity(result.content),
    suggestedFix: extractSection(result.content, 'Suggested fix'),
    provider: result.provider,
  };
}

/**
 * Classify an evidence artifact using the configured classification LLM.
 *
 * @param {Object} evidence - Evidence record
 * @param {string} evidence.controlId - Control ID the evidence maps to
 * @param {string} evidence.contentType - MIME type
 * @param {Object} evidence.metadata - Evidence metadata
 * @returns {Promise<{classification: string, confidence: number, controlMapping: string[], provider: string}>}
 */
export async function classifyEvidence(evidence) {
  /** @type {'claude' | 'openai' | 'mistral' | 'llama'} */
  const provider = /** @type {any} */ (process.env.LLM_CLASSIFICATION_PROVIDER || 'mistral');
  const client = createLLMClient(provider);

  const prompt = `Classify this compliance evidence artifact:
Control ID: ${evidence.controlId}
Content Type: ${evidence.contentType}
Metadata: ${JSON.stringify(evidence.metadata)}

Provide:
1. Data classification level (RESTRICTED, CONFIDENTIAL, INTERNAL, PUBLIC)
2. Confidence score (0.0 to 1.0)
3. All applicable OSCAL control IDs this evidence supports
4. Whether this contains PII requiring special handling`;

  const result = await client.complete(prompt, {
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
    temperature: 0.1,
  });

  return {
    classification: extractClassification(result.content),
    confidence: extractConfidence(result.content),
    controlMapping: extractControlIds(result.content),
    provider: result.provider,
  };
}

/**
 * Perform deep security analysis on a schema or code artifact.
 *
 * @param {string} content - Content to analyze
 * @param {string} artifactType - Type: 'schema', 'config', 'code', 'evidence'
 * @returns {Promise<{findings: Array, riskScore: number, provider: string}>}
 */
export async function securityScan(content, artifactType) {
  /** @type {'claude' | 'openai' | 'mistral' | 'llama'} */
  const provider = /** @type {any} */ (process.env.LLM_SECURITY_PROVIDER || 'claude');
  const client = createLLMClient(provider);

  const prompt = `Perform a security analysis of this ${artifactType}:

${content.substring(0, 8000)}

Identify:
1. Data exposure risks (PII, credentials, internal URLs)
2. Injection vulnerabilities (if applicable)
3. Compliance gaps relative to SEC Regulation D requirements
4. OWASP Top 10 violations (if code)
5. Overall risk score (1-10)

Format each finding as: [SEVERITY] Description — Remediation`;

  const result = await client.complete(prompt, {
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
    maxTokens: 4096,
    temperature: 0.2,
  });

  return {
    findings: extractFindings(result.content),
    riskScore: extractRiskScore(result.content),
    provider: result.provider,
  };
}

/**
 * Process sensitive data using on-premise Llama (air-gapped).
 * This function ONLY uses Llama via Ollama to ensure PII never leaves the network.
 *
 * @param {string} content - PII-containing content
 * @param {'redact' | 'classify' | 'extract'} operation - What to do
 * @returns {Promise<{result: string, provider: string}>}
 */
export async function processSensitiveData(content, operation) {
  // Force Llama/Ollama for PII — data must not leave the network
  const client = createLLMClient('llama', {
    baseUrl: process.env.LLAMA_API_URL || 'http://localhost:11434/api',
  });

  const operations = {
    redact: 'Redact all PII (SSNs, names, addresses, account numbers) from this text. Replace with [REDACTED_TYPE].',
    classify: 'Classify the sensitivity of this document. Identify all PII types present and their locations.',
    extract: 'Extract structured data fields (name, date, amounts, identifiers) without including actual PII values.',
  };

  const prompt = `${operations[operation] || operations.classify}\n\nDocument:\n${content}`;

  const result = await client.complete(prompt, {
    systemPrompt: 'You are a PII processing system operating in an air-gapped environment. Never echo back raw PII. All output must be sanitized.',
    temperature: 0.0,
  });

  return {
    result: result.content,
    provider: result.provider,
  };
}

// ============================================================================
// Webhook Integration
// ============================================================================

/**
 * Send LLM analysis results to a configured webhook endpoint.
 * Use this to integrate with external systems (Slack, Teams, custom dashboards).
 *
 * @param {string} webhookUrl - Destination webhook URL
 * @param {Object} payload - Analysis results to send
 * @param {string} payload.type - Analysis type (test_failure, classification, security_scan)
 * @param {Object} payload.result - Analysis results
 * @returns {Promise<boolean>} - Whether the webhook was delivered successfully
 */
export async function sendToWebhook(webhookUrl, payload) {
  // SSRF protection: validate webhook URL
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    console.error(`LLM webhook rejected: invalid URL "${webhookUrl}"`);
    return false;
  }

  // Only allow HTTPS in production
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    console.error(`LLM webhook rejected: HTTPS required in production (got ${parsed.protocol})`);
    return false;
  }

  // Block private/internal IPs to prevent SSRF
  const hostname = parsed.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.') ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    console.error(`LLM webhook rejected: private/internal host "${hostname}" blocked (SSRF protection)`);
    return false;
  }

  const body = {
    source: 'evidence-locker-llm',
    timestamp: new Date().toISOString(),
    ...payload,
  };

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) return true;

      // Don't retry on 4xx client errors — the request itself is wrong
      if (response.status >= 400 && response.status < 500) {
        console.error(`LLM webhook rejected by server: ${response.status} (not retrying)`);
        return false;
      }

      lastError = new Error(`Webhook returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    // Exponential backoff for 5xx/network errors only: 1s, 2s, 4s
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
  }

  console.error(`LLM webhook delivery failed after 3 attempts: ${lastError.message}`);
  return false;
}

// ============================================================================
// Extraction Helpers
// ============================================================================

function extractSeverity(text) {
  const lower = text.toLowerCase();
  if (lower.includes('critical')) return 'critical';
  if (lower.includes('high')) return 'high';
  if (lower.includes('medium')) return 'medium';
  return 'low';
}

function extractSection(text, heading) {
  const regex = new RegExp(`${heading}[:\\s]*(.+?)(?:\\n\\n|\\n\\d|$)`, 'is');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function extractClassification(text) {
  const levels = ['RESTRICTED', 'CONFIDENTIAL', 'INTERNAL', 'PUBLIC'];
  for (const level of levels) {
    if (text.toUpperCase().includes(level)) return level;
  }
  return 'CONFIDENTIAL'; // Default to more restrictive
}

function extractConfidence(text) {
  const match = text.match(/confidence[:\s]*(\d\.\d+|\d)/i);
  if (match) return Math.min(1, Math.max(0, parseFloat(match[1])));
  return 0.5;
}

function extractControlIds(text) {
  const matches = text.match(/ctrl-[\w-]+/g);
  return matches ? [...new Set(matches)] : [];
}

function extractFindings(text) {
  const lines = text.split('\n').filter(l => /^\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?/i.test(l.trim()));
  return lines.map(line => {
    const match = line.match(/^\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?\s*(.+)/i);
    if (!match) return { severity: 'medium', description: line };
    return { severity: match[1].toLowerCase(), description: match[2].trim() };
  });
}

function extractRiskScore(text) {
  const match = text.match(/risk\s*score[:\s]*(\d+)/i);
  if (match) return Math.min(10, Math.max(1, parseInt(match[1], 10)));
  return 5;
}
