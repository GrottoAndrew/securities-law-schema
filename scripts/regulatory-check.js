#!/usr/bin/env node

/**
 * Regulatory Change Monitor - Cron Job Script
 *
 * Checks official government sources for changes to securities regulations.
 * Designed to be run on a schedule:
 *   - Daily: eCFR changes, SEC RSS feeds
 *   - Weekly: Federal Register deep scan, no-action letter review
 *
 * Usage:
 *   node scripts/regulatory-check.js [--daily|--weekly|--full]
 *
 * Environment:
 *   SLACK_WEBHOOK_URL - Optional webhook for alerts
 *   EMAIL_ALERTS_TO   - Optional email for alerts
 *   STATE_FILE        - Path to state file (default: .regulatory-monitor-state.json)
 *
 * Schedule with cron:
 *   # Daily at 6 AM ET
 *   0 6 * * * cd /app && node scripts/regulatory-check.js --daily
 *
 *   # Weekly on Monday at 7 AM ET
 *   0 7 * * 1 cd /app && node scripts/regulatory-check.js --weekly
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  checkECFRChanges,
  checkSECFeeds,
  checkFederalRegister,
  runAllMonitors,
} from '../src/services/regulatory-monitor.js';

const STATE_FILE = process.env.STATE_FILE || '.regulatory-monitor-state.json';

/**
 * Load previous state
 */
async function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const content = await readFile(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors, return default state
  }

  return {
    lastECFRDate: null,
    lastCheckTime: null,
    lastWeeklyCheck: null,
  };
}

/**
 * Save state
 */
async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Send alert notification
 */
async function sendAlert(title, changes) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      const message = {
        text: `🚨 *${title}*`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `🚨 ${title}` },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: changes
                .slice(0, 10)
                .map(c => `• ${c.type}: ${c.title || c.message || c.section || 'Change detected'}`)
                .join('\n'),
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Total changes: ${changes.length} | ${new Date().toISOString()}`,
              },
            ],
          },
        ],
      };

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      console.log('Alert sent to Slack');
    } catch (err) {
      console.error('Failed to send Slack alert:', err.message);
    }
  }

  // Log to console regardless
  console.log('\n' + '='.repeat(60));
  console.log(`ALERT: ${title}`);
  console.log('='.repeat(60));
  changes.forEach(c => {
    console.log(`  - ${c.type}: ${c.title || c.message || c.section || JSON.stringify(c)}`);
  });
  console.log('='.repeat(60) + '\n');
}

/**
 * Run daily checks
 */
async function runDailyChecks(state) {
  console.log('Running daily regulatory checks...\n');

  const since = state.lastCheckTime
    ? new Date(state.lastCheckTime)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Check eCFR for CFR changes
  console.log('1. Checking eCFR for Regulation D changes...');
  const ecfrResult = await checkECFRChanges(state.lastECFRDate);

  if (ecfrResult.error) {
    console.log(`   ERROR: ${ecfrResult.error}`);
  } else {
    console.log(`   Latest version date: ${ecfrResult.latestVersionDate}`);
    console.log(`   Changes detected: ${ecfrResult.hasChanges}`);

    if (ecfrResult.hasChanges) {
      await sendAlert('eCFR Regulation D Changes Detected', ecfrResult.changes);
    }

    // Update state with latest known date
    if (ecfrResult.latestVersionDate) {
      state.lastECFRDate = ecfrResult.latestVersionDate;
    }
  }

  // Check SEC RSS feeds
  console.log('\n2. Checking SEC RSS feeds...');
  const secResult = await checkSECFeeds(since);

  if (secResult.error) {
    console.log(`   ERROR: ${secResult.error}`);
  } else {
    console.log(`   Feeds checked: ${Object.keys(secResult.feedResults).length}`);
    console.log(`   Relevant items found: ${secResult.changes.length}`);

    if (secResult.hasChanges) {
      await sendAlert('SEC Feed Items - Regulation D Related', secResult.changes);
    }
  }

  state.lastCheckTime = new Date().toISOString();

  return { ecfrResult, secResult };
}

/**
 * Run weekly deep checks
 */
async function runWeeklyChecks(state) {
  console.log('Running weekly regulatory deep scan...\n');

  const since = state.lastWeeklyCheck
    ? new Date(state.lastWeeklyCheck)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Check Federal Register for SEC rules
  console.log('1. Checking Federal Register for SEC rulemaking...');
  const frResult = await checkFederalRegister(since);

  if (frResult.error) {
    console.log(`   ERROR: ${frResult.error}`);
  } else {
    console.log(`   Total SEC documents: ${frResult.totalDocuments}`);
    console.log(`   Regulation D related: ${frResult.changes.length}`);

    if (frResult.hasChanges) {
      await sendAlert('Federal Register - Regulation D Rulemaking', frResult.changes);
    }
  }

  state.lastWeeklyCheck = new Date().toISOString();

  return { frResult };
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--daily';

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Regulatory Change Monitor - Securities Law         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Mode: ${mode}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const state = await loadState();
  let results = {};

  try {
    switch (mode) {
      case '--daily':
        results = await runDailyChecks(state);
        break;

      case '--weekly':
        results = await runWeeklyChecks(state);
        break;

      case '--full':
        console.log('Running full regulatory scan...\n');
        results = await runAllMonitors({
          lastECFRDate: state.lastECFRDate,
          since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        });

        if (results.hasAnyChanges) {
          const allChanges = [
            ...results.results.ecfr.changes,
            ...results.results.secFeeds.changes,
            ...results.results.federalRegister.changes,
          ];
          await sendAlert('Full Regulatory Scan - Changes Detected', allChanges);
        }

        state.lastCheckTime = new Date().toISOString();
        state.lastWeeklyCheck = new Date().toISOString();
        if (results.results.ecfr.latestVersionDate) {
          state.lastECFRDate = results.results.ecfr.latestVersionDate;
        }
        break;

      default:
        console.error(`Unknown mode: ${mode}`);
        console.log('\nUsage: node scripts/regulatory-check.js [--daily|--weekly|--full]');
        process.exit(1);
    }

    await saveState(state);

    console.log('\n✓ Regulatory check complete');
    console.log(`  State saved to: ${STATE_FILE}`);
  } catch (err) {
    console.error('\n✗ Regulatory check failed:', err.message);
    process.exit(1);
  }
}

main();
