#!/usr/bin/env node
/**
 * Check env-configured connections (MongoDB, HubSpot, AI provider, OAuth presence).
 * Loads config.env then .env, same as the app / test-ai script.
 *
 * Usage:
 *   npm run test-connections
 *   npm run test-connections -- --strict   # treat warnings as failures
 */

const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const configEnvPath = path.join(root, 'config.env');
const dotenvPath = path.join(root, '.env');

if (fs.existsSync(configEnvPath)) {
  require('dotenv').config({ path: configEnvPath });
}
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const mongoose = require('mongoose');
const { loadConfig } = require('../services/aiChat');
const { runConnectionChecks } = require('../lib/connectionChecks');

const STATUS_PAD = 6;

function parseArgs(argv) {
  let strict = false;
  for (const a of argv) {
    if (a === '--strict') {
      strict = true;
    } else if (a === '-h' || a === '--help') {
      console.log(`Usage: node scripts/test-connections.js [--strict]

Checks:
  MongoDB     ping using MONGO_URI / MONGO_DB
  HubSpot     account details using HUBSPOT_API_KEY
  AI          list models using the configured provider key (Anthropic, OpenAI, Gemini)
  OAuth       presence of Google / Django client credentials (not a live login)

Missing optional keys (HubSpot, AI, OAuth) are warnings.
Invalid or expired keys, and a failed Mongo ping, are failures.

  --strict    also exit non-zero when there are warnings

Environment is loaded from config.env then .env in the project root.`);
      process.exit(0);
    }
  }
  return { strict };
}

function formatRow(row) {
  const tag = `[${row.status}]`.padEnd(STATUS_PAD + 2);
  const name = String(row.name).padEnd(14);
  return `${tag} ${name} ${row.message}`;
}

async function main() {
  const { strict } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(configEnvPath) && !fs.existsSync(dotenvPath)) {
    console.warn('No config.env or .env found in the project root.');
  }

  console.log('CARE connection checks\n');

  const { results, failed, warned, ok } = await runConnectionChecks({
    env: process.env,
    mongoose,
    fetchImpl: globalThis.fetch,
    loadAiConfig: loadConfig,
  });

  for (const row of results) {
    const line = formatRow(row);
    if (row.status === 'fail') {
      console.error(line);
    } else if (row.status === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  console.log('');
  if (failed === 0 && warned === 0) {
    console.log('All checks passed.');
  } else {
    const parts = [];
    if (failed) parts.push(`${failed} failed`);
    if (warned) parts.push(`${warned} warning${warned === 1 ? '' : 's'}`);
    console.log(parts.join(', ') + '.');
    if (failed) {
      console.log('Fix expired/invalid keys or the database URI, then re-run.');
    } else if (!strict) {
      console.log('Warnings do not fail this script unless you pass --strict.');
    }
  }

  if (!ok || (strict && warned > 0)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Connection checks crashed:', err.message || err);
  process.exit(1);
});
