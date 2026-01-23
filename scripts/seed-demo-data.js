#!/usr/bin/env node
/**
 * Seed Demo Data Generator
 *
 * Generates 200+ realistic evidence records mapped to controls
 * for demonstration and testing purposes.
 *
 * Usage:
 *   node scripts/seed-demo-data.js              # Output JSON to stdout
 *   node scripts/seed-demo-data.js --api        # POST to running API
 *   node scripts/seed-demo-data.js --sql        # Output SQL INSERT statements
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Load controls catalog
function loadControls() {
  const path = join(projectRoot, 'controls', 'regulation-d-controls.json');
  if (!existsSync(path)) {
    console.error('Controls file not found');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Extract flat list of control IDs
function extractControlIds(controls) {
  const ids = [];
  function walk(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(walk);
    } else if (obj && typeof obj === 'object') {
      if (obj.id) ids.push(obj.id);
      if (obj.controls) walk(obj.controls);
    }
  }
  controls.catalog.groups.forEach(g => {
    if (g.controls) walk(g.controls);
  });
  return ids;
}

// File types with realistic extensions and MIME types
const FILE_TYPES = [
  { ext: 'pdf', mime: 'application/pdf', category: 'document' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'spreadsheet' },
  { ext: 'csv', mime: 'text/csv', category: 'data' },
  { ext: 'json', mime: 'application/json', category: 'data' },
  { ext: 'xml', mime: 'application/xml', category: 'data' },
  { ext: 'eml', mime: 'message/rfc822', category: 'email' },
  { ext: 'msg', mime: 'application/vnd.ms-outlook', category: 'email' },
  { ext: 'png', mime: 'image/png', category: 'image' },
  { ext: 'jpg', mime: 'image/jpeg', category: 'image' },
  { ext: 'log', mime: 'text/plain', category: 'log' },
  { ext: 'txt', mime: 'text/plain', category: 'text' },
  { ext: 'html', mime: 'text/html', category: 'web' },
  { ext: 'zip', mime: 'application/zip', category: 'archive' },
];

// Evidence templates by control category
const EVIDENCE_TEMPLATES = {
  'accredited-investor': [
    { title: 'Accredited Investor Questionnaire - {client}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'Net Worth Certification - {client}', fileType: 'pdf', sizeRange: [30000, 100000] },
    { title: 'Income Verification Letter - {client}', fileType: 'pdf', sizeRange: [20000, 80000] },
    { title: 'CPA Certification of Accredited Status - {client}', fileType: 'pdf', sizeRange: [40000, 150000] },
    { title: 'Bank Statement Summary - {client}', fileType: 'pdf', sizeRange: [100000, 500000] },
    { title: 'Brokerage Account Statement - {client}', fileType: 'pdf', sizeRange: [80000, 400000] },
    { title: 'W-2 Income Documentation - {client}', fileType: 'pdf', sizeRange: [25000, 75000] },
    { title: 'Tax Return Summary - {client}', fileType: 'pdf', sizeRange: [150000, 800000] },
  ],
  'disclosure': [
    { title: 'Private Placement Memorandum v{version}', fileType: 'pdf', sizeRange: [500000, 2000000] },
    { title: 'Form D Filing Confirmation', fileType: 'pdf', sizeRange: [30000, 100000] },
    { title: 'Risk Disclosure Statement', fileType: 'pdf', sizeRange: [80000, 300000] },
    { title: 'Subscription Agreement Template', fileType: 'docx', sizeRange: [60000, 200000] },
    { title: 'Investment Summary - {offering}', fileType: 'pdf', sizeRange: [100000, 400000] },
    { title: 'Fee Disclosure Schedule', fileType: 'xlsx', sizeRange: [20000, 80000] },
    { title: 'Conflicts of Interest Disclosure', fileType: 'pdf', sizeRange: [40000, 150000] },
  ],
  'communication': [
    { title: 'Client Communication Log - {month} {year}', fileType: 'xlsx', sizeRange: [50000, 300000] },
    { title: 'Email Archive - {client} - {quarter}', fileType: 'zip', sizeRange: [1000000, 10000000] },
    { title: 'Meeting Notes - {client} - {date}', fileType: 'docx', sizeRange: [15000, 60000] },
    { title: 'Phone Call Recording Transcript - {client}', fileType: 'txt', sizeRange: [5000, 30000] },
    { title: 'Marketing Material - {campaign}', fileType: 'pdf', sizeRange: [200000, 1000000] },
    { title: 'Investor Update Letter - {quarter} {year}', fileType: 'pdf', sizeRange: [100000, 500000] },
    { title: 'Webinar Recording Transcript - {topic}', fileType: 'txt', sizeRange: [20000, 100000] },
  ],
  'form-d': [
    { title: 'Form D Initial Filing - {offering}', fileType: 'xml', sizeRange: [10000, 50000] },
    { title: 'Form D Amendment {number} - {offering}', fileType: 'xml', sizeRange: [10000, 50000] },
    { title: 'EDGAR Filing Receipt - {date}', fileType: 'html', sizeRange: [5000, 20000] },
    { title: 'Form D Summary Report - {year}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'State Blue Sky Filing - {state}', fileType: 'pdf', sizeRange: [30000, 150000] },
  ],
  'offering': [
    { title: 'Offering Circular - {offering}', fileType: 'pdf', sizeRange: [400000, 1500000] },
    { title: 'Term Sheet - {offering}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'Capitalization Table - {offering}', fileType: 'xlsx', sizeRange: [30000, 150000] },
    { title: 'Investor Roster - {offering}', fileType: 'xlsx', sizeRange: [20000, 100000] },
    { title: 'Funds Flow Memo - {offering}', fileType: 'pdf', sizeRange: [40000, 150000] },
    { title: 'Closing Checklist - {offering}', fileType: 'xlsx', sizeRange: [25000, 80000] },
    { title: 'Wire Transfer Confirmation - {date}', fileType: 'pdf', sizeRange: [10000, 40000] },
  ],
  'integration': [
    { title: 'Bad Actor Questionnaire - {person}', fileType: 'pdf', sizeRange: [30000, 100000] },
    { title: 'Background Check Report - {person}', fileType: 'pdf', sizeRange: [80000, 300000] },
    { title: 'SEC Disciplinary History Search - {date}', fileType: 'pdf', sizeRange: [20000, 80000] },
    { title: 'FINRA BrokerCheck Report - {person}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'Integration Verification Memo', fileType: 'docx', sizeRange: [40000, 150000] },
  ],
  'solicitation': [
    { title: 'Solicitation Policy and Procedures', fileType: 'pdf', sizeRange: [60000, 250000] },
    { title: 'Pre-existing Relationship Documentation - {client}', fileType: 'docx', sizeRange: [20000, 80000] },
    { title: 'General Solicitation Compliance Memo', fileType: 'pdf', sizeRange: [40000, 150000] },
    { title: 'Advertising Review Log - {month} {year}', fileType: 'xlsx', sizeRange: [30000, 120000] },
    { title: 'Social Media Compliance Audit - {quarter}', fileType: 'pdf', sizeRange: [100000, 400000] },
  ],
  'record-retention': [
    { title: 'Record Retention Policy v{version}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'Document Destruction Log - {year}', fileType: 'xlsx', sizeRange: [20000, 100000] },
    { title: 'Retention Schedule Matrix', fileType: 'xlsx', sizeRange: [40000, 150000] },
    { title: 'Archive Inventory Report - {quarter} {year}', fileType: 'csv', sizeRange: [50000, 300000] },
    { title: 'Legal Hold Notice - {matter}', fileType: 'pdf', sizeRange: [15000, 50000] },
  ],
  'audit': [
    { title: 'Internal Audit Report - {quarter} {year}', fileType: 'pdf', sizeRange: [200000, 800000] },
    { title: 'Compliance Testing Results - {area}', fileType: 'xlsx', sizeRange: [50000, 250000] },
    { title: 'Exception Report - {month} {year}', fileType: 'pdf', sizeRange: [30000, 150000] },
    { title: 'Remediation Tracking Log', fileType: 'xlsx', sizeRange: [40000, 180000] },
    { title: 'Annual Compliance Review - {year}', fileType: 'pdf', sizeRange: [300000, 1200000] },
    { title: 'System Access Log Export - {date}', fileType: 'csv', sizeRange: [100000, 1000000] },
    { title: 'User Activity Report - {month} {year}', fileType: 'xlsx', sizeRange: [80000, 400000] },
  ],
  'training': [
    { title: 'Employee Training Completion Report - {year}', fileType: 'xlsx', sizeRange: [30000, 150000] },
    { title: 'Compliance Training Materials - {topic}', fileType: 'pdf', sizeRange: [500000, 2000000] },
    { title: 'Training Acknowledgment - {employee}', fileType: 'pdf', sizeRange: [10000, 40000] },
    { title: 'Annual Certification - {employee} - {year}', fileType: 'pdf', sizeRange: [15000, 50000] },
    { title: 'Quiz Results - {topic} - {employee}', fileType: 'json', sizeRange: [2000, 10000] },
  ],
  'aml-kyc': [
    { title: 'KYC Documentation Package - {client}', fileType: 'pdf', sizeRange: [200000, 800000] },
    { title: 'AML Screening Report - {client}', fileType: 'pdf', sizeRange: [50000, 200000] },
    { title: 'OFAC Check Results - {date}', fileType: 'csv', sizeRange: [10000, 50000] },
    { title: 'PEP Screening Report - {client}', fileType: 'pdf', sizeRange: [30000, 120000] },
    { title: 'Source of Funds Declaration - {client}', fileType: 'pdf', sizeRange: [20000, 80000] },
    { title: 'Enhanced Due Diligence Report - {client}', fileType: 'pdf', sizeRange: [100000, 500000] },
    { title: 'Beneficial Ownership Form - {entity}', fileType: 'pdf', sizeRange: [25000, 100000] },
  ],
  'cybersecurity': [
    { title: 'Penetration Test Report - {quarter} {year}', fileType: 'pdf', sizeRange: [300000, 1500000] },
    { title: 'Vulnerability Scan Results - {date}', fileType: 'csv', sizeRange: [50000, 500000] },
    { title: 'Security Incident Log - {month} {year}', fileType: 'xlsx', sizeRange: [30000, 200000] },
    { title: 'Access Control Matrix', fileType: 'xlsx', sizeRange: [40000, 180000] },
    { title: 'Firewall Configuration Backup - {date}', fileType: 'json', sizeRange: [100000, 800000] },
    { title: 'MFA Enrollment Status Report', fileType: 'xlsx', sizeRange: [20000, 100000] },
    { title: 'Security Awareness Training Completion', fileType: 'xlsx', sizeRange: [25000, 120000] },
    { title: 'Incident Response Plan v{version}', fileType: 'pdf', sizeRange: [100000, 400000] },
  ],
};

// Sample data for placeholders
const SAMPLE_DATA = {
  clients: [
    'Apex Capital Partners', 'Bridgewater Holdings', 'Cascade Investment Group',
    'Dominion Wealth Management', 'Evergreen Asset Management', 'Falcon Ridge Investments',
    'Golden Gate Ventures', 'Horizon Financial', 'Ironwood Capital', 'Jupiter Asset Management',
    'Keystone Partners', 'Lighthouse Investments', 'Meridian Wealth', 'Northstar Capital',
    'Oakwood Financial', 'Pacific Rim Investors', 'Quantum Capital', 'Ridgeline Holdings',
    'Summit Wealth Advisors', 'Titan Investment Group', 'United Venture Partners',
    'Vista Capital Management', 'Westfield Investments', 'Xavier Financial', 'Yorktown Partners',
    'Zenith Asset Management', 'Alpine Investment Co', 'Beacon Hill Capital', 'Crestview Partners',
    'Delta Wealth Management', 'John Smith Family Trust', 'Jane Doe Revocable Trust',
    'Robert Johnson IRA', 'Emily Chen 401k', 'Michael Brown Foundation',
  ],
  offerings: [
    'Series A Preferred Stock', 'Growth Fund LP', 'Real Estate Fund III',
    'Venture Capital Fund VII', 'Private Credit Fund II', 'Infrastructure Fund IV',
    'Technology Growth Fund', 'Healthcare Innovation Fund', 'Clean Energy Fund I',
    'Mezzanine Debt Fund', 'Distressed Debt Fund', 'Secondary Fund V',
  ],
  employees: [
    'Sarah Johnson', 'Michael Chen', 'Emily Rodriguez', 'David Kim', 'Jennifer Walsh',
    'Robert Martinez', 'Lisa Thompson', 'James Wilson', 'Maria Garcia', 'Christopher Lee',
    'Amanda Brown', 'Daniel Taylor', 'Jessica Anderson', 'Matthew Harris', 'Ashley Clark',
  ],
  persons: [
    'John A. Smith', 'Mary B. Johnson', 'William C. Davis', 'Elizabeth D. Miller',
    'Richard E. Wilson', 'Patricia F. Moore', 'Thomas G. Taylor', 'Jennifer H. Anderson',
  ],
  topics: [
    'Regulation D Compliance', 'Anti-Money Laundering', 'Cybersecurity Best Practices',
    'Insider Trading Prevention', 'Code of Ethics', 'Marketing Compliance',
    'Fiduciary Duty', 'Private Placement Rules', 'Form ADV Requirements',
  ],
  campaigns: [
    'Q1 Investor Outreach', 'Fund Launch Campaign', 'Annual Report Distribution',
    'Webinar Series Promo', 'Conference Follow-up', 'Newsletter Campaign',
  ],
  states: [
    'California', 'New York', 'Texas', 'Florida', 'Illinois', 'Pennsylvania',
    'Massachusetts', 'Connecticut', 'Delaware', 'New Jersey',
  ],
  matters: [
    'SEC Inquiry 2024-001', 'Internal Investigation 2024-003', 'Litigation Hold - Doe v. Fund',
    'Regulatory Exam 2024', 'Whistleblower Complaint Review',
  ],
  areas: [
    'Trade Execution', 'Client Onboarding', 'Marketing Materials', 'Portfolio Management',
    'Fee Calculations', 'Performance Reporting', 'Custody Procedures',
  ],
  entities: [
    'Acme Holdings LLC', 'Beta Investments LP', 'Gamma Capital Corp',
    'Delta Ventures Inc', 'Epsilon Partners LLC', 'Zeta Fund GP LLC',
  ],
};

// Generate random date within range
function randomDate(startYear, endYear) {
  const start = new Date(startYear, 0, 1);
  const end = new Date(endYear, 11, 31);
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0];
}

// Generate random element from array
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate random integer in range
function randomInt(min, max) {
  return Math.floor(Math.random() + min + Math.random() * (max - min));
}

// Fill template placeholders
function fillTemplate(template) {
  const year = randomFrom(['2022', '2023', '2024', '2025']);
  const quarter = randomFrom(['Q1', 'Q2', 'Q3', 'Q4']);
  const month = randomFrom(['January', 'February', 'March', 'April', 'May', 'June',
                            'July', 'August', 'September', 'October', 'November', 'December']);
  const version = randomFrom(['1.0', '1.1', '1.2', '2.0', '2.1', '3.0']);
  const number = randomFrom(['1', '2', '3', '4', '5']);
  const date = randomDate(2022, 2025);

  return template
    .replace('{client}', randomFrom(SAMPLE_DATA.clients))
    .replace('{offering}', randomFrom(SAMPLE_DATA.offerings))
    .replace('{employee}', randomFrom(SAMPLE_DATA.employees))
    .replace('{person}', randomFrom(SAMPLE_DATA.persons))
    .replace('{topic}', randomFrom(SAMPLE_DATA.topics))
    .replace('{campaign}', randomFrom(SAMPLE_DATA.campaigns))
    .replace('{state}', randomFrom(SAMPLE_DATA.states))
    .replace('{matter}', randomFrom(SAMPLE_DATA.matters))
    .replace('{area}', randomFrom(SAMPLE_DATA.areas))
    .replace('{entity}', randomFrom(SAMPLE_DATA.entities))
    .replace('{year}', year)
    .replace('{quarter}', quarter)
    .replace('{month}', month)
    .replace('{version}', version)
    .replace('{number}', number)
    .replace('{date}', date);
}

// Map control ID to evidence category
function getEvidenceCategory(controlId) {
  const id = controlId.toLowerCase();
  if (id.includes('accredited') || id.includes('investor-verification')) return 'accredited-investor';
  if (id.includes('disclosure') || id.includes('ppm') || id.includes('memorandum')) return 'disclosure';
  if (id.includes('communication') || id.includes('marketing') || id.includes('advertising')) return 'communication';
  if (id.includes('form-d') || id.includes('filing') || id.includes('edgar')) return 'form-d';
  if (id.includes('offering') || id.includes('subscription') || id.includes('investor-limit')) return 'offering';
  if (id.includes('integration') || id.includes('bad-actor') || id.includes('disqualification')) return 'integration';
  if (id.includes('solicitation') || id.includes('general-solicitation')) return 'solicitation';
  if (id.includes('retention') || id.includes('record') || id.includes('preservation')) return 'record-retention';
  if (id.includes('audit') || id.includes('compliance') || id.includes('review') || id.includes('testing')) return 'audit';
  if (id.includes('training') || id.includes('education') || id.includes('certification')) return 'training';
  if (id.includes('aml') || id.includes('kyc') || id.includes('customer') || id.includes('identity')) return 'aml-kyc';
  if (id.includes('cyber') || id.includes('security') || id.includes('access') || id.includes('encryption')) return 'cybersecurity';
  return randomFrom(Object.keys(EVIDENCE_TEMPLATES));
}

// Generate a single evidence record
function generateEvidence(controlId, index) {
  const category = getEvidenceCategory(controlId);
  const templates = EVIDENCE_TEMPLATES[category] || EVIDENCE_TEMPLATES['audit'];
  const template = randomFrom(templates);

  const title = fillTemplate(template.title);
  const fileType = FILE_TYPES.find(f => f.ext === template.fileType) || randomFrom(FILE_TYPES);
  const size = randomInt(template.sizeRange[0], template.sizeRange[1]);
  const collectedAt = randomDate(2022, 2025) + 'T' +
    String(randomInt(8, 18)).padStart(2, '0') + ':' +
    String(randomInt(0, 59)).padStart(2, '0') + ':' +
    String(randomInt(0, 59)).padStart(2, '0') + 'Z';

  const filename = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_') + '.' + fileType.ext;
  const artifactContent = `${title}|${controlId}|${index}|${Date.now()}|${Math.random()}`;
  const artifactHash = 'sha256:' + createHash('sha256').update(artifactContent).digest('hex');

  return {
    id: randomUUID(),
    controlId,
    artifactHash,
    artifactSize: size,
    contentType: fileType.mime,
    metadata: {
      title,
      filename,
      category: fileType.category,
      description: `${category.replace(/-/g, ' ')} evidence for control ${controlId}`,
      collectedBy: randomFrom(SAMPLE_DATA.employees),
      source: randomFrom(['Manual Upload', 'Email Archive', 'System Export', 'Scan', 'API Integration']),
      tags: [category, fileType.category, controlId.split('-')[0]],
      retentionYears: 7,
      jurisdiction: 'SEC',
    },
    collectedAt,
    status: randomFrom(['active', 'active', 'active', 'active', 'archived']), // 80% active
  };
}

// Main generation function
function generateAllEvidence(targetCount = 200) {
  const controls = loadControls();
  const controlIds = extractControlIds(controls);

  console.error(`Found ${controlIds.length} controls`);

  const evidence = [];
  let index = 0;

  // Ensure at least 2 evidence per control
  for (const controlId of controlIds) {
    const count = randomInt(2, 5);
    for (let i = 0; i < count && evidence.length < targetCount * 1.5; i++) {
      evidence.push(generateEvidence(controlId, index++));
    }
  }

  // Fill remaining with random distribution
  while (evidence.length < targetCount) {
    const controlId = randomFrom(controlIds);
    evidence.push(generateEvidence(controlId, index++));
  }

  // Shuffle and trim to target
  evidence.sort(() => Math.random() - 0.5);
  return evidence.slice(0, targetCount);
}

// Output formatters
function toSQL(evidence) {
  const lines = [
    '-- Generated Evidence Seed Data',
    '-- Run against PostgreSQL after migrations',
    '',
    'BEGIN;',
    '',
  ];

  for (const e of evidence) {
    const metadata = JSON.stringify(e.metadata).replace(/'/g, "''");
    lines.push(`INSERT INTO evidence (id, control_id, artifact_hash, artifact_size, content_type, metadata, collected_at, collected_by, status)`);
    lines.push(`VALUES ('${e.id}', '${e.controlId}', '${e.artifactHash}', ${e.artifactSize}, '${e.contentType}', '${metadata}', '${e.collectedAt}', '${e.metadata.collectedBy}', '${e.status}');`);
    lines.push('');
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

async function postToAPI(evidence, baseUrl = 'http://localhost:3001') {
  // Get auth token
  const tokenRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seed-script@system.local', role: 'admin' }),
  });
  const { token } = await tokenRes.json();

  let success = 0;
  let failed = 0;

  for (const e of evidence) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          controlId: e.controlId,
          artifactHash: e.artifactHash,
          artifactSize: e.artifactSize,
          contentType: e.contentType,
          metadata: e.metadata,
        }),
      });

      if (res.ok) {
        success++;
        if (success % 20 === 0) console.error(`Progress: ${success}/${evidence.length}`);
      } else {
        failed++;
        console.error(`Failed: ${e.metadata.title}`);
      }
    } catch (err) {
      failed++;
      console.error(`Error: ${err.message}`);
    }
  }

  return { success, failed };
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--json';
  const count = parseInt(args[1], 10) || 200;

  console.error(`Generating ${count} evidence records...`);
  const evidence = generateAllEvidence(count);
  console.error(`Generated ${evidence.length} records`);

  if (mode === '--sql') {
    console.log(toSQL(evidence));
  } else if (mode === '--api') {
    const baseUrl = args[1] || 'http://localhost:3001';
    console.error(`Posting to ${baseUrl}...`);
    const result = await postToAPI(evidence, baseUrl);
    console.error(`Done: ${result.success} success, ${result.failed} failed`);
  } else {
    // JSON output
    console.log(JSON.stringify(evidence, null, 2));
  }
}

main().catch(console.error);
