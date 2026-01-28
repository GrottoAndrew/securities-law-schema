/**
 * Regulatory Monitor Service
 *
 * Monitors official government sources for changes to securities regulations:
 * - eCFR API for CFR amendments (17 CFR 230.500-508)
 * - SEC RSS feeds for enforcement, no-action letters, policy statements
 * - Federal Register API for proposed/final rules
 *
 * @module services/regulatory-monitor
 */

import { createHash } from 'crypto';

/**
 * eCFR API endpoints
 * @see https://www.ecfr.gov/developers/documentation/api/v1
 */
const ECFR_API = {
  structure: 'https://www.ecfr.gov/api/versioner/v1/structure',
  full: 'https://www.ecfr.gov/api/versioner/v1/full',
  versions: 'https://www.ecfr.gov/api/versioner/v1/versions/title-17.json',
};

/**
 * SEC RSS Feeds
 * @see https://www.sec.gov/about/secrss.htm
 */
const SEC_RSS_FEEDS = {
  pressReleases: 'https://www.sec.gov/news/pressreleases.rss',
  speechesStatements: 'https://www.sec.gov/news/speeches-statements.rss',
  litigationReleases: 'https://www.sec.gov/enforcement-litigation/litigation-releases/rss',
  adminProceedings: 'https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss',
  finalRules: 'https://www.sec.gov/rules/final.rss',
  proposedRules: 'https://www.sec.gov/rules/proposed.rss',
  interps: 'https://www.sec.gov/rules/interp.rss',
  noAction: 'https://www.sec.gov/divisions/corpfin/cf-noaction.rss',
  staffLegalBulletins: 'https://www.sec.gov/interps/legal.rss',
};

/**
 * Federal Register API
 * @see https://www.federalregister.gov/developers/documentation/api/v1
 */
const FEDERAL_REGISTER_API = 'https://www.federalregister.gov/api/v1/documents.json';

/**
 * Regulation D sections to monitor
 */
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

/**
 * @typedef {Object} MonitorResult
 * @property {string} source - Source identifier
 * @property {string} checkTime - ISO timestamp
 * @property {boolean} hasChanges - Whether changes were detected
 * @property {Object[]} changes - Array of detected changes
 * @property {string} [error] - Error message if check failed
 * @property {string} [latestVersionDate] - Latest eCFR version date
 * @property {Object} [feedResults] - SEC RSS feed results by feed name
 * @property {number} [totalDocuments] - Total Federal Register documents found
 */

/**
 * Check eCFR for changes to Regulation D sections
 * @param {string} [lastKnownDate] - Last known version date (YYYY-MM-DD)
 * @returns {Promise<MonitorResult>}
 */
export async function checkECFRChanges(lastKnownDate) {
  const result = {
    source: 'ecfr',
    checkTime: new Date().toISOString(),
    hasChanges: false,
    changes: [],
  };

  try {
    // Get current version info for Title 17
    const versionsRes = await fetch(ECFR_API.versions);
    if (!versionsRes.ok) {
      throw new Error(`eCFR API error: ${versionsRes.status}`);
    }

    const versions = await versionsRes.json();
    const latestVersion = versions.content_versions?.[0];

    if (!latestVersion) {
      throw new Error('No version data returned from eCFR');
    }

    const currentDate = latestVersion.date;

    // Check if there's a newer version than what we know about
    if (lastKnownDate && currentDate > lastKnownDate) {
      result.hasChanges = true;
      result.changes.push({
        type: 'VERSION_UPDATE',
        previousDate: lastKnownDate,
        currentDate: currentDate,
        message: `Title 17 updated from ${lastKnownDate} to ${currentDate}`,
      });
    }

    // Check each Regulation D section for content changes
    for (const section of REG_D_SECTIONS) {
      const sectionUrl = `${ECFR_API.full}/${currentDate}/title-17.xml?part=230&section=${section}`;

      try {
        const sectionRes = await fetch(sectionUrl);
        if (sectionRes.ok) {
          const content = await sectionRes.text();
          const contentHash = createHash('sha256').update(content).digest('hex');

          result.changes.push({
            type: 'SECTION_CHECK',
            section: section,
            date: currentDate,
            contentHash: contentHash,
            url: sectionUrl,
          });
        }
      } catch (sectionErr) {
        result.changes.push({
          type: 'SECTION_ERROR',
          section: section,
          error: sectionErr.message,
        });
      }
    }

    result.latestVersionDate = currentDate;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Parse RSS feed and extract items
 * @param {string} feedUrl - RSS feed URL
 * @returns {Promise<Object[]>} - Array of feed items
 */
async function parseRSSFeed(feedUrl) {
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status}`);
  }

  const xml = await res.text();
  const items = [];

  // Simple XML parsing for RSS items
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const itemXml = match[1];

    const title = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
    const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const description =
      itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || '';

    items.push({
      title: title.trim(),
      link: link.trim(),
      pubDate: pubDate.trim(),
      description: description.trim().substring(0, 500),
    });
  }

  return items;
}

/**
 * Check SEC RSS feeds for Regulation D related content
 * @param {Date} [since] - Only return items after this date
 * @returns {Promise<MonitorResult>}
 */
export async function checkSECFeeds(since) {
  const result = {
    source: 'sec-rss',
    checkTime: new Date().toISOString(),
    hasChanges: false,
    changes: [],
    feedResults: {},
  };

  const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days

  // Keywords to filter for Regulation D relevance
  const keywords = [
    'regulation d',
    'reg d',
    'private placement',
    'accredited investor',
    'rule 506',
    'rule 504',
    'rule 501',
    'form d',
    'general solicitation',
    'private offering',
    'securities act',
    'exemption',
  ];

  for (const [feedName, feedUrl] of Object.entries(SEC_RSS_FEEDS)) {
    try {
      const items = await parseRSSFeed(feedUrl);

      const relevantItems = items.filter(item => {
        const itemDate = new Date(item.pubDate);
        if (itemDate < sinceDate) return false;

        const searchText = `${item.title} ${item.description}`.toLowerCase();
        return keywords.some(kw => searchText.includes(kw));
      });

      result.feedResults[feedName] = {
        totalItems: items.length,
        relevantItems: relevantItems.length,
        items: relevantItems,
      };

      if (relevantItems.length > 0) {
        result.hasChanges = true;
        result.changes.push(
          ...relevantItems.map(item => ({
            type: 'SEC_FEED_ITEM',
            feed: feedName,
            ...item,
          }))
        );
      }
    } catch (err) {
      result.feedResults[feedName] = {
        error: err.message,
      };
    }
  }

  return result;
}

/**
 * Check Federal Register for SEC rules affecting Regulation D
 * @param {Date} [since] - Only return documents after this date
 * @returns {Promise<MonitorResult>}
 */
export async function checkFederalRegister(since) {
  const result = {
    source: 'federal-register',
    checkTime: new Date().toISOString(),
    hasChanges: false,
    changes: [],
  };

  const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
  const formattedDate = sinceDate.toISOString().split('T')[0];

  try {
    const params = new URLSearchParams();
    params.append('conditions[agencies][]', 'securities-and-exchange-commission');
    params.append('conditions[publication_date][gte]', formattedDate);
    params.append('conditions[type][]', 'RULE');
    params.append('conditions[type][]', 'PRORULE');
    params.append('per_page', '50');
    params.append('order', 'newest');

    const res = await fetch(`${FEDERAL_REGISTER_API}?${params}`);
    if (!res.ok) {
      throw new Error(`Federal Register API error: ${res.status}`);
    }

    const data = await res.json();

    // Filter for Regulation D relevance
    const keywords = [
      'regulation d',
      'private placement',
      'accredited investor',
      'rule 506',
      'form d',
      '230.5',
    ];

    for (const doc of data.results || []) {
      const searchText = `${doc.title} ${doc.abstract || ''}`.toLowerCase();
      const isRelevant = keywords.some(kw => searchText.includes(kw));

      if (isRelevant) {
        result.hasChanges = true;
        result.changes.push({
          type: 'FEDERAL_REGISTER_DOC',
          documentNumber: doc.document_number,
          title: doc.title,
          publicationDate: doc.publication_date,
          documentType: doc.type,
          abstract: doc.abstract?.substring(0, 500),
          htmlUrl: doc.html_url,
          pdfUrl: doc.pdf_url,
        });
      }
    }

    result.totalDocuments = data.count;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Run all regulatory monitors
 * @param {Object} [options] - Monitor options
 * @param {string} [options.lastECFRDate] - Last known eCFR date
 * @param {Date} [options.since] - Check for items since this date
 * @returns {Promise<Object>} - Combined monitor results
 */
export async function runAllMonitors(options = {}) {
  const startTime = Date.now();

  const [ecfrResult, secResult, frResult] = await Promise.all([
    checkECFRChanges(options.lastECFRDate),
    checkSECFeeds(options.since),
    checkFederalRegister(options.since),
  ]);

  return {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    hasAnyChanges: ecfrResult.hasChanges || secResult.hasChanges || frResult.hasChanges,
    results: {
      ecfr: ecfrResult,
      secFeeds: secResult,
      federalRegister: frResult,
    },
    summary: {
      ecfrChanges: ecfrResult.changes.length,
      secFeedItems: secResult.changes.length,
      federalRegisterDocs: frResult.changes.length,
    },
  };
}

export default {
  checkECFRChanges,
  checkSECFeeds,
  checkFederalRegister,
  runAllMonitors,
  ECFR_API,
  SEC_RSS_FEEDS,
  FEDERAL_REGISTER_API,
};
