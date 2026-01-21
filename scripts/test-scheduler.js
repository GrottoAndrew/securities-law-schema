#!/usr/bin/env node
/**
 * Test Scheduler
 *
 * Manages automated test execution based on hot/cold database classification.
 *
 * Hot databases (active offerings): More frequent testing
 * Cold databases (archived): Less frequent testing
 *
 * Usage:
 *   node scripts/test-scheduler.js              # Start scheduler
 *   TEST_CADENCE=hot node scripts/test-scheduler.js   # Force hot cadence
 *   TEST_CADENCE=cold node scripts/test-scheduler.js  # Force cold cadence
 */

import cron from 'node-cron';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Load configuration
function loadConfig() {
  const configPath = resolve(projectRoot, 'config', 'testing-cadence.json');

  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  // Default configuration
  return {
    databases: {
      hot: {
        testSchedule: {
          unit: { cron: '*/15 * * * *', description: 'Every 15 minutes' },
          integration: { cron: '0 * * * *', description: 'Every hour' },
          redTeam: { cron: '0 * * * *', description: 'Hourly' },
          e2e: { cron: '0 */4 * * *', description: 'Every 4 hours' }
        }
      },
      cold: {
        testSchedule: {
          unit: { cron: '0 */6 * * *', description: 'Every 6 hours' },
          integration: { cron: '0 4 * * *', description: 'Daily at 4 AM' },
          redTeam: { cron: '0 4 * * *', description: 'Daily' },
          e2e: { cron: '0 4 * * 0', description: 'Weekly on Sunday' }
        }
      }
    }
  };
}

// Run a test script
function runTest(testType, script) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${new Date().toISOString()}] Starting ${testType} tests...`);

    const proc = spawn('npm', ['run', script], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[${new Date().toISOString()}] ${testType} tests PASSED`);
        resolve({ testType, status: 'passed', code });
      } else {
        console.error(`[${new Date().toISOString()}] ${testType} tests FAILED (exit code: ${code})`);
        resolve({ testType, status: 'failed', code });
      }
    });

    proc.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] ${testType} tests ERROR:`, err);
      reject(err);
    });
  });
}

// Main scheduler
function startScheduler() {
  const config = loadConfig();
  const cadence = process.env.TEST_CADENCE || 'hot';
  const schedule = config.databases[cadence]?.testSchedule;

  if (!schedule) {
    console.error(`Invalid cadence: ${cadence}. Using 'hot' as default.`);
    return;
  }

  console.log('========================================');
  console.log('Test Scheduler Started');
  console.log('========================================');
  console.log(`Cadence: ${cadence.toUpperCase()}`);
  console.log(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log('\nScheduled Tests:');

  const testScripts = {
    unit: 'test:unit',
    integration: 'test:integration',
    redTeam: 'test:redteam',
    e2e: 'test:e2e'
  };

  // Schedule each test type
  Object.entries(schedule).forEach(([testType, config]) => {
    const { cron: cronExpr, description } = config;
    const script = testScripts[testType];

    if (!script) {
      console.log(`  - ${testType}: No script defined, skipping`);
      return;
    }

    if (!cron.validate(cronExpr)) {
      console.error(`  - ${testType}: Invalid cron expression "${cronExpr}"`);
      return;
    }

    console.log(`  - ${testType}: ${description} (${cronExpr})`);

    cron.schedule(cronExpr, async () => {
      try {
        const result = await runTest(testType, script);

        // Log result for monitoring
        const logEntry = {
          timestamp: new Date().toISOString(),
          testType,
          cadence,
          ...result
        };
        console.log('Test Result:', JSON.stringify(logEntry));

        // In production, send to monitoring system
        // await sendToMonitoring(logEntry);
      } catch (err) {
        console.error(`Error running ${testType} tests:`, err);
      }
    });
  });

  console.log('\n========================================');
  console.log('Scheduler is running. Press Ctrl+C to stop.');
  console.log('========================================\n');

  // Run initial test to verify setup
  if (process.env.RUN_INITIAL_TEST !== 'false') {
    console.log('Running initial unit tests to verify setup...');
    runTest('unit', 'test:unit').catch(console.error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down scheduler...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down scheduler...');
  process.exit(0);
});

// Start
startScheduler();
