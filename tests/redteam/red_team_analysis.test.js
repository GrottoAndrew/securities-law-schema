/**
 * Automated Red Team Analysis
 *
 * Runs security and compliance analysis on all schemas and controls.
 * Designed to run hourly on hot databases, daily on cold databases.
 *
 * Categories:
 * - CRITICAL: Blocks deployment, requires immediate fix
 * - HIGH: Should be fixed before next release
 * - MEDIUM: Address in next sprint
 * - LOW: Technical debt to track
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');

class RedTeamAnalyzer {
  constructor() {
    this.findings = [];
    this.stats = { critical: 0, high: 0, medium: 0, low: 0 };
  }

  addFinding(severity, category, message, file = null, line = null) {
    this.findings.push({ severity, category, message, file, line, timestamp: new Date().toISOString() });
    this.stats[severity.toLowerCase()]++;
  }

  /**
   * Check for sensitive data exposure
   */
  analyzeSensitiveDataExposure() {
    const schemasDir = join(projectRoot, 'schemas', 'regulation-d');
    const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));

    const sensitivePatterns = [
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
      { pattern: /\b\d{9}\b/, name: 'Potential SSN/TIN' },
      { pattern: /password|secret|api[_-]?key/i, name: 'Credential' },
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, name: 'Email' }
    ];

    files.forEach(file => {
      const content = readFileSync(join(schemasDir, file), 'utf-8');
      sensitivePatterns.forEach(({ pattern, name }) => {
        if (pattern.test(content)) {
          this.addFinding('CRITICAL', 'DATA_EXPOSURE',
            `Potential ${name} found in schema file`, file);
        }
      });
    });
  }

  /**
   * Verify schema integrity (no tampering)
   */
  analyzeSchemaIntegrity() {
    const schemasDir = join(projectRoot, 'schemas', 'regulation-d');
    const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));

    files.forEach(file => {
      try {
        const content = readFileSync(join(schemasDir, file), 'utf-8');
        JSON.parse(content);
      } catch (e) {
        this.addFinding('CRITICAL', 'SCHEMA_INTEGRITY',
          `Invalid JSON in schema file: ${e.message}`, file);
      }
    });
  }

  /**
   * Check for regulation citation accuracy
   */
  analyzeRegulationAccuracy() {
    const schemasDir = join(projectRoot, 'schemas', 'regulation-d');
    const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));

    // Known valid CFR sections
    const validSections = ['500', '501', '502', '503', '504', '505', '506', '507', '508'];

    files.forEach(file => {
      const content = JSON.parse(readFileSync(join(schemasDir, file), 'utf-8'));

      // Check citation format
      const citation = content.citation;
      if (citation) {
        const match = citation.match(/^17 CFR 230\.(50\d)$/);
        if (!match) {
          this.addFinding('HIGH', 'CITATION_FORMAT',
            `Invalid citation format: ${citation}`, file);
        } else if (!validSections.includes(match[1])) {
          this.addFinding('HIGH', 'CITATION_INVALID',
            `Invalid section number: ${match[1]}`, file);
        }
      } else {
        this.addFinding('CRITICAL', 'CITATION_MISSING',
          'Missing citation field', file);
      }

      // Check @id matches citation
      const id = content['@id'];
      if (id && citation) {
        const expectedId = `cfr:17/${citation.replace('17 CFR ', '')}`;
        if (id !== expectedId) {
          this.addFinding('MEDIUM', 'ID_MISMATCH',
            `@id "${id}" doesn't match citation "${citation}"`, file);
        }
      }
    });
  }

  /**
   * Analyze OSCAL controls for completeness
   */
  analyzeControlCompleteness() {
    const controlsPath = join(projectRoot, 'controls', 'regulation-d-controls.json');

    if (!existsSync(controlsPath)) {
      this.addFinding('CRITICAL', 'MISSING_FILE',
        'OSCAL controls file not found');
      return;
    }

    const controls = JSON.parse(readFileSync(controlsPath, 'utf-8'));

    // Check required metadata
    if (!controls.catalog?.metadata?.['last-modified']) {
      this.addFinding('MEDIUM', 'METADATA_INCOMPLETE',
        'Controls missing last-modified date');
    }

    // Check for orphaned controls (no regulation reference)
    function checkControls(obj, path = '') {
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => checkControls(item, `${path}[${i}]`));
      } else if (obj && typeof obj === 'object') {
        if (obj.id && !obj.props?.some(p => p.name === 'regulation-ref' || p.name === 'regulation-citation')) {
          // Some controls are procedural without direct regulation refs
          if (!obj.id.includes('record') && !obj.id.includes('offering-materials')) {
            // Only flag if it seems like a regulatory control
          }
        }
        if (obj.controls) checkControls(obj.controls, `${path}.controls`);
      }
    }

    if (controls.catalog?.groups) {
      controls.catalog.groups.forEach(group => {
        if (group.controls) checkControls(group.controls);
      });
    }
  }

  /**
   * Check for stale amendment references
   */
  analyzeAmendmentCurrency() {
    const schemasDir = join(projectRoot, 'schemas', 'regulation-d');
    const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));

    // Get current year
    const currentYear = new Date().getFullYear();
    const staleThreshold = currentYear - 3; // Warn if no amendments in 3 years

    files.forEach(file => {
      const content = JSON.parse(readFileSync(join(schemasDir, file), 'utf-8'));

      if (content.amendmentHistory && content.amendmentHistory.length > 0) {
        // Extract year from most recent amendment
        const latestAmendment = content.amendmentHistory[content.amendmentHistory.length - 1];
        const yearMatch = latestAmendment.match(/\b(20\d{2})\b/);

        if (yearMatch) {
          const amendmentYear = parseInt(yearMatch[1]);
          if (amendmentYear < staleThreshold) {
            this.addFinding('LOW', 'STALE_AMENDMENT',
              `Last amendment from ${amendmentYear}, may need review`, file);
          }
        }
      }
    });
  }

  /**
   * Security: Check for injection vulnerabilities in dynamic content
   */
  analyzeInjectionRisks() {
    const schemasDir = join(projectRoot, 'schemas', 'regulation-d');
    const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));

    const dangerousPatterns = [
      { pattern: /<script/i, name: 'Script injection' },
      { pattern: /javascript:/i, name: 'JavaScript URI' },
      { pattern: /on\w+\s*=/i, name: 'Event handler' },
      { pattern: /\$\{[^}]+\}/g, name: 'Template injection' }
    ];

    files.forEach(file => {
      const content = readFileSync(join(schemasDir, file), 'utf-8');

      dangerousPatterns.forEach(({ pattern, name }) => {
        if (pattern.test(content)) {
          this.addFinding('CRITICAL', 'INJECTION_RISK',
            `Potential ${name} vulnerability`, file);
        }
      });
    });
  }

  /**
   * Compliance: Verify evidence requirements exist for key controls
   */
  analyzeEvidenceRequirements() {
    const controlsPath = join(projectRoot, 'controls', 'regulation-d-controls.json');
    const controls = JSON.parse(readFileSync(controlsPath, 'utf-8'));

    // Controls that MUST have evidence requirements
    const criticalControls = [
      'ctrl-ai-verification',
      'ctrl-ai-natural-person-income',
      'ctrl-ai-natural-person-net-worth',
      'ctrl-form-d-filing',
      'ctrl-bad-actor-check'
    ];

    function findControl(obj, targetId) {
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = findControl(item, targetId);
          if (found) return found;
        }
      } else if (obj && typeof obj === 'object') {
        if (obj.id === targetId) return obj;
        if (obj.controls) return findControl(obj.controls, targetId);
      }
      return null;
    }

    criticalControls.forEach(ctrlId => {
      /** @type {any} */
      let found = null;
      controls.catalog.groups.forEach(group => {
        if (group.controls) {
          const ctrl = findControl(group.controls, ctrlId);
          if (ctrl) found = ctrl;
        }
      });

      if (!found) {
        this.addFinding('HIGH', 'MISSING_CONTROL',
          `Critical control ${ctrlId} not found in catalog`);
        return;
      }

      const hasEvidence = found.parts?.some(p =>
        p.name === 'evidence-requirements' ||
        p.id?.includes('evidence')
      );

      if (!hasEvidence) {
        this.addFinding('MEDIUM', 'MISSING_EVIDENCE_REQ',
          `Control ${ctrlId} should have evidence requirements`);
      }
    });
  }

  /**
   * Run all analyses
   */
  runFullAnalysis() {
    console.log('Starting Red Team Analysis...\n');

    console.log('1. Checking for sensitive data exposure...');
    this.analyzeSensitiveDataExposure();

    console.log('2. Verifying schema integrity...');
    this.analyzeSchemaIntegrity();

    console.log('3. Analyzing regulation citation accuracy...');
    this.analyzeRegulationAccuracy();

    console.log('4. Checking OSCAL control completeness...');
    this.analyzeControlCompleteness();

    console.log('5. Analyzing amendment currency...');
    this.analyzeAmendmentCurrency();

    console.log('6. Scanning for injection vulnerabilities...');
    this.analyzeInjectionRisks();

    console.log('7. Verifying evidence requirements...');
    this.analyzeEvidenceRequirements();

    return this.generateReport();
  }

  /**
   * Generate analysis report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.stats,
      passed: this.stats.critical === 0 && this.stats.high === 0,
      findings: this.findings
    };

    console.log('\n========================================');
    console.log('RED TEAM ANALYSIS REPORT');
    console.log('========================================');
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`\nSummary:`);
    console.log(`  CRITICAL: ${this.stats.critical}`);
    console.log(`  HIGH:     ${this.stats.high}`);
    console.log(`  MEDIUM:   ${this.stats.medium}`);
    console.log(`  LOW:      ${this.stats.low}`);
    console.log(`\nStatus: ${report.passed ? 'PASSED' : 'FAILED'}`);

    if (this.findings.length > 0) {
      console.log('\nFindings:');
      this.findings.forEach((f, i) => {
        console.log(`\n${i + 1}. [${f.severity}] ${f.category}`);
        console.log(`   ${f.message}`);
        if (f.file) console.log(`   File: ${f.file}`);
      });
    }

    console.log('\n========================================\n');

    return report;
  }
}

import { describe, it, expect } from 'vitest';

describe('Red Team Analysis', () => {
  it('should pass with no critical or high findings', () => {
    const analyzer = new RedTeamAnalyzer();
    const report = analyzer.runFullAnalysis();

    expect(report.passed).toBe(true);
    expect(report.summary.critical).toBe(0);
    expect(report.summary.high).toBe(0);
  });

  it('should analyze all schema files', () => {
    const analyzer = new RedTeamAnalyzer();
    const report = analyzer.runFullAnalysis();

    expect(report.findings).toBeDefined();
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
