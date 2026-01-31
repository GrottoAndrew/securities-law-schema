/**
 * eCFR Verification Script
 *
 * Verifies that the local eCFR XML (source/cfr/ECFR-title17.xml) matches
 * the live eCFR API for all Regulation D sections (17 CFR 230.500-508).
 *
 * Uses the official eCFR API at https://www.ecfr.gov/api/versioner/v1/
 *
 * Usage:
 *   node scripts/verify-ecfr.js
 *
 * Exit codes:
 *   0 - All sections match or API is unreachable (warning only)
 *   1 - Mismatch detected between local and live eCFR
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECFR_XML_PATH = resolve(__dirname, '../source/cfr/ECFR-title17.xml');

const REG_D_SECTIONS = [
  '230.500',
  '230.501',
  '230.502',
  '230.503',
  '230.504',
  '230.505',
  '230.506',
  '230.507',
  '230.508',
];

const SECTION_MARKERS = {
  '230.500': '17:3.0.1.1.13.0.49.183',
  230.501: '17:3.0.1.1.13.0.49.184',
  230.502: '17:3.0.1.1.13.0.49.185',
  230.503: '17:3.0.1.1.13.0.49.186',
  230.504: '17:3.0.1.1.13.0.49.187',
  230.505: '17:3.0.1.1.13.0.49.188',
  230.506: '17:3.0.1.1.13.0.49.189',
  230.507: '17:3.0.1.1.13.0.49.190',
  230.508: '17:3.0.1.1.13.0.49.191',
};

function stripXmlTags(text) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL using Node fetch with curl fallback.
 * Returns the response body as a string.
 */
async function fetchUrl(url) {
  // Try Node fetch first
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (_err) {
    // Fall back to curl
    try {
      return execSync(`curl -sf --retry 3 --max-time 30 '${url}'`, {
        encoding: 'utf-8',
        timeout: 45000,
      });
    } catch (_curlErr) {
      throw new Error(`Cannot reach ${url} (both fetch and curl failed)`);
    }
  }
}

function extractLocalSection(xmlContent, section) {
  const nodeId = SECTION_MARKERS[section];
  if (!nodeId) throw new Error(`No marker for section ${section}`);

  const nodePattern = `NODE="${nodeId}"`;
  const startIdx = xmlContent.indexOf(nodePattern);
  if (startIdx === -1) {
    throw new Error(`Section ${section} not found in local XML`);
  }

  const divStart = xmlContent.lastIndexOf('<DIV8', startIdx);
  if (divStart === -1) {
    throw new Error(`Could not find DIV8 start for section ${section}`);
  }

  const divEnd = xmlContent.indexOf('</DIV8>', startIdx);
  if (divEnd === -1) {
    throw new Error(`Could not find DIV8 end for section ${section}`);
  }

  return xmlContent.substring(divStart, divEnd + '</DIV8>'.length);
}

async function main() {
  console.log('eCFR Verification: Regulation D (17 CFR 230.500-508)');
  console.log('=====================================================\n');

  // Read local XML
  let xmlContent;
  try {
    xmlContent = readFileSync(ECFR_XML_PATH, 'utf-8');
  } catch (_err) {
    console.error(`ERROR: Cannot read local eCFR XML at ${ECFR_XML_PATH}`);
    process.exit(1);
  }

  const amdDateMatch = xmlContent.match(/<AMDDATE>([^<]+)<\/AMDDATE>/);
  const localAmdDate = amdDateMatch ? amdDateMatch[1].trim() : 'unknown';
  console.log(`Local XML amendment date: ${localAmdDate}`);

  // Get latest available date from eCFR API
  let latestDate;
  try {
    const titlesJson = await fetchUrl('https://www.ecfr.gov/api/versioner/v1/titles');
    const titlesData = JSON.parse(titlesJson);
    const title17 = titlesData.titles?.find(t => String(t.number) === '17');
    if (!title17) throw new Error('Title 17 not found');
    latestDate = title17.latest_issue_date || title17.up_to_date_as_of;
    if (!latestDate) throw new Error('No date found');
    console.log(`Live eCFR latest issue date: ${latestDate}`);
  } catch (_err) {
    console.warn('\nWARNING: eCFR API is unreachable. Skipping live comparison.');
    console.warn('Local XML will be used as-is. Re-run when network is available.\n');
    process.exit(0);
  }

  // Get per-section amendment dates
  try {
    const versionsJson = await fetchUrl('https://www.ecfr.gov/api/versioner/v1/versions/title-17');
    const versionsData = JSON.parse(versionsJson);
    const versions = versionsData.content_versions || versionsData.versions || [];
    const regDVersions = versions.filter(v => v.part === '230');

    const latest = {};
    for (const v of regDVersions) {
      const id = v.identifier;
      if (REG_D_SECTIONS.includes(id)) {
        if (!latest[id] || v.amendment_date > latest[id]) {
          latest[id] = v.amendment_date;
        }
      }
    }

    console.log('\nPer-section latest amendments on eCFR:');
    for (const sec of REG_D_SECTIONS) {
      console.log(`  ${sec}: ${latest[sec] || 'not found'}`);
    }
  } catch (_err) {
    console.warn('  (Could not fetch version history)');
  }

  // Compare each section
  console.log('\n--- Section-by-section comparison ---\n');
  let allMatch = true;
  const mismatches = [];

  for (const section of REG_D_SECTIONS) {
    process.stdout.write(`${section}: `);

    try {
      const localXml = extractLocalSection(xmlContent, section);
      const localText = stripXmlTags(localXml);

      const liveXml = await fetchUrl(
        `https://www.ecfr.gov/api/versioner/v1/full/${latestDate}/title-17.xml?section=${section}`
      );
      const liveText = stripXmlTags(liveXml);

      if (localText === liveText) {
        console.log(`MATCH (${localText.length} chars)`);
      } else {
        console.log('MISMATCH!');
        allMatch = false;
        mismatches.push(section);

        const minLen = Math.min(localText.length, liveText.length);
        for (let i = 0; i < minLen; i++) {
          if (localText[i] !== liveText[i]) {
            console.log(`  First difference at char ${i}:`);
            console.log(`  Local: ...${localText.substring(Math.max(0, i - 40), i + 40)}...`);
            console.log(`  Live:  ...${liveText.substring(Math.max(0, i - 40), i + 40)}...`);
            break;
          }
        }
        if (localText.length !== liveText.length) {
          console.log(`  Length difference: local=${localText.length}, live=${liveText.length}`);
        }
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      allMatch = false;
      mismatches.push(section);
    }
  }

  console.log('\n=====================================================');
  if (allMatch) {
    console.log(`RESULT: All Regulation D sections match live eCFR (as of ${latestDate})`);
    console.log('Local XML is current. No update needed.');
    process.exit(0);
  } else {
    console.error(`RESULT: MISMATCHES DETECTED in: ${mismatches.join(', ')}`);
    console.error('');
    console.error('The local eCFR XML is OUT OF DATE. To update:');
    console.error(
      `  1. Download fresh XML from https://www.ecfr.gov/api/versioner/v1/full/${latestDate}/title-17.xml`
    );
    console.error('  2. Replace source/cfr/ECFR-title17.xml');
    console.error('  3. Review control catalog for any regulatory changes');
    console.error('  4. Re-run this script to verify');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
