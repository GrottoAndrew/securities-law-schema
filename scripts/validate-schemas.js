#!/usr/bin/env node
/**
 * Validate Regulation D JSON-LD schemas against JSON Schema
 *
 * Usage:
 *   node scripts/validate-schemas.js                    # Validate all schemas
 *   node scripts/validate-schemas.js schemas/regulation-d  # Validate specific directory
 *   node scripts/validate-schemas.js path/to/file.jsonld   # Validate single file
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Load JSON Schema
const schemaPath = join(projectRoot, 'schemas', 'regulation-d-schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

// Initialize Ajv with strict mode and formats
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  verbose: true
});
addFormats(ajv);

const validate = ajv.compile(schema);

/**
 * Validate a single JSON-LD file
 * @param {string} filePath - Path to JSON-LD file
 * @returns {object} Validation result
 */
function validateFile(filePath) {
  const absolutePath = resolve(filePath);
  let data;

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    data = JSON.parse(content);
  } catch (err) {
    return {
      file: absolutePath,
      valid: false,
      errors: [{ message: `Failed to read/parse file: ${err.message}` }]
    };
  }

  const valid = validate(data);

  return {
    file: absolutePath,
    valid,
    errors: valid ? null : validate.errors.map(err => ({
      path: err.instancePath,
      message: err.message,
      params: err.params,
      schemaPath: err.schemaPath
    }))
  };
}

/**
 * Find all JSON-LD files in a directory
 * @param {string} dirPath - Directory to search
 * @returns {string[]} Array of file paths
 */
function findJsonLdFiles(dirPath) {
  const files = [];
  const absolutePath = resolve(dirPath);

  const entries = readdirSync(absolutePath);
  for (const entry of entries) {
    const fullPath = join(absolutePath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findJsonLdFiles(fullPath));
    } else if (extname(entry) === '.jsonld') {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Format validation results for display
 * @param {object[]} results - Array of validation results
 */
function displayResults(results) {
  let passed = 0;
  let failed = 0;

  console.log('\nValidation Results');
  console.log('==================\n');

  for (const result of results) {
    const relativePath = result.file.replace(projectRoot + '/', '');

    if (result.valid) {
      console.log(`PASS  ${relativePath}`);
      passed++;
    } else {
      console.log(`FAIL  ${relativePath}`);
      failed++;

      for (const err of result.errors) {
        const path = err.path || '(root)';
        console.log(`      - ${path}: ${err.message}`);
        if (err.params && Object.keys(err.params).length > 0) {
          console.log(`        ${JSON.stringify(err.params)}`);
        }
      }
      console.log();
    }
  }

  console.log('\n------------------');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  return failed === 0 ? 0 : 1;
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let targetPath = args[0] || join(projectRoot, 'schemas', 'regulation-d');

  targetPath = resolve(targetPath);
  const stat = statSync(targetPath);

  let files;
  if (stat.isDirectory()) {
    files = findJsonLdFiles(targetPath);
    console.log(`Validating ${files.length} JSON-LD files in ${targetPath}`);
  } else {
    files = [targetPath];
    console.log(`Validating single file: ${targetPath}`);
  }

  if (files.length === 0) {
    console.log('No JSON-LD files found.');
    process.exit(0);
  }

  const results = files.map(validateFile);
  const exitCode = displayResults(results);
  process.exit(exitCode);
}

main();
