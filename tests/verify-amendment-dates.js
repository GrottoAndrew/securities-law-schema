#!/usr/bin/env node
/**
 * Amendment Date Verification Test
 *
 * Verifies that all schema files have current amendment dates by checking
 * against the eCFR API. Run weekly via npm run verify:amendments
 *
 * Exit codes:
 *   0 - All amendments current
 *   1 - Stale amendments detected (requires schema update)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const schemasDir = join(projectRoot, 'schemas', 'regulation-d');

const ECFR_API_BASE = 'https://www.ecfr.gov/api/versioner/v1';

/**
 * @typedef {Object} VersionInfo
 * @property {string} date
 * @property {string} identifier
 * @property {string} name
 */

/**
 * @typedef {Object} SchemaAmendment
 * @property {string} file
 * @property {string} section
 * @property {string} lastAmendment
 * @property {string} asOfDate
 * @property {string[]} amendmentHistory
 */

/**
 * Fetch latest version info from eCFR for a specific section
 * @param {string} section - Section number (e.g., "230.506")
 * @returns {Promise<VersionInfo|null>}
 */
async function fetchECFRVersion(section) {
  const url = `${ECFR_API_BASE}/versions/title-17.json?section=${section}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  eCFR API error for ${section}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.content_versions && data.content_versions.length > 0) {
      // Get most recent version
      const versions = data.content_versions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      return versions[0];
    }
    return null;
  } catch (error) {
    console.error(`  eCFR fetch failed for ${section}: ${error.message}`);
    return null;
  }
}

/**
 * Parse Federal Register citation to extract date
 * @param {string} citation - e.g., "86 FR 3598, Jan. 14, 2021"
 * @returns {Date|null}
 */
function parseFRCitation(citation) {
  if (!citation) return null;

  // Match patterns like "Jan. 14, 2021" or "July 24, 2013"
  const dateMatch = citation.match(
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}/i
  );

  if (dateMatch) {
    const parsed = new Date(dateMatch[0].replace('.', ''));
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Try extracting just the year
  const yearMatch = citation.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    return new Date(`${yearMatch[1]}-12-31`);
  }

  return null;
}

/**
 * Load all schema files and extract amendment info
 * @returns {SchemaAmendment[]}
 */
function loadSchemaAmendments() {
  const files = readdirSync(schemasDir).filter(f => f.endsWith('.jsonld'));
  const amendments = [];

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(schemasDir, file), 'utf-8'));

      amendments.push({
        file,
        section: content.sectionNumber || content.citation?.replace('17 CFR ', '') || 'unknown',
        lastAmendment: content._source?.lastAmendment || null,
        asOfDate: content._source?.asOfDate || null,
        amendmentHistory: content.amendmentHistory || [],
      });
    } catch (error) {
      console.error(`Failed to parse ${file}: ${error.message}`);
    }
  }

  return amendments;
}

/**
 * Main verification function
 */
async function verifyAmendmentDates() {
  console.log('Amendment Date Verification');
  console.log('===========================\n');
  console.log(`Checking schemas in: ${schemasDir}\n`);

  const schemas = loadSchemaAmendments();
  const results = {
    current: [],
    stale: [],
    errors: [],
  };

  for (const schema of schemas) {
    process.stdout.write(`Checking ${schema.file}...`);

    // Fetch current eCFR version
    const ecfrVersion = await fetchECFRVersion(schema.section);

    if (!ecfrVersion) {
      results.errors.push({
        ...schema,
        error: 'Could not fetch eCFR version',
      });
      console.log(' ERROR (API unavailable)');
      continue;
    }

    // Parse dates for comparison
    const schemaDate = parseFRCitation(schema.lastAmendment);
    const ecfrDate = new Date(ecfrVersion.date);

    if (!schemaDate) {
      results.errors.push({
        ...schema,
        error: 'Could not parse schema amendment date',
        ecfrVersion,
      });
      console.log(' ERROR (unparseable date)');
      continue;
    }

    // Compare: is the schema's amendment date at least as recent as eCFR?
    // Allow 30 days tolerance for propagation delays
    const tolerance = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    const isStale = ecfrDate.getTime() - schemaDate.getTime() > tolerance;

    if (isStale) {
      results.stale.push({
        ...schema,
        schemaDate: schemaDate.toISOString().split('T')[0],
        ecfrDate: ecfrDate.toISOString().split('T')[0],
        ecfrVersion,
      });
      console.log(
        ` STALE (schema: ${schemaDate.toISOString().split('T')[0]}, eCFR: ${ecfrDate.toISOString().split('T')[0]})`
      );
    } else {
      results.current.push({
        ...schema,
        schemaDate: schemaDate.toISOString().split('T')[0],
        ecfrDate: ecfrDate.toISOString().split('T')[0],
      });
      console.log(' OK');
    }

    // Rate limiting - be nice to the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Report
  console.log('\n===========================');
  console.log('VERIFICATION RESULTS');
  console.log('===========================\n');

  console.log(`Current: ${results.current.length}`);
  console.log(`Stale:   ${results.stale.length}`);
  console.log(`Errors:  ${results.errors.length}`);

  if (results.stale.length > 0) {
    console.log('\n--- STALE AMENDMENTS ---');
    for (const s of results.stale) {
      console.log(`\n${s.file}:`);
      console.log(`  Section: ${s.section}`);
      console.log(`  Schema date: ${s.schemaDate}`);
      console.log(`  eCFR date:   ${s.ecfrDate}`);
      console.log(`  Last amendment in schema: ${s.lastAmendment}`);
      console.log(`  eCFR version: ${s.ecfrVersion.name || s.ecfrVersion.identifier}`);
    }
  }

  if (results.errors.length > 0) {
    console.log('\n--- ERRORS ---');
    for (const e of results.errors) {
      console.log(`\n${e.file}: ${e.error}`);
    }
  }

  // Exit with failure if any stale amendments
  const exitCode = results.stale.length > 0 ? 1 : 0;
  console.log(`\nExit code: ${exitCode}`);

  return { results, exitCode };
}

// Run verification
const { exitCode } = await verifyAmendmentDates();
process.exit(exitCode);
