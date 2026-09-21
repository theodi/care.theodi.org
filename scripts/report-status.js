#!/usr/bin/env node
/**
 * Build a status report (connections + runtime + lockfiles) and optionally POST it once.
 *
 * Usage:
 *   npm run report-status
 *   npm run report-status -- --push
 *   npm run report-status -- --json
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
const { buildStatusReport } = require('../lib/statusReport');
const { pushStatusReport, readReporterConfig } = require('../lib/statusReporter');

function parseArgs(argv) {
  let push = false;
  let json = false;
  for (const a of argv) {
    if (a === '--push') push = true;
    else if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') {
      console.log(`Usage: node scripts/report-status.js [--push] [--json]

Builds a service-status report (connection checks + runtime + lockfiles).
Collector scores Node/OS LTS and npm audit when you --push.

  --push   POST to STATUS_REPORT_URL with STATUS_REPORT_KEY
  --json   Print only JSON (no human summary)

Without --push, prints the report and exits 0 even if checks failed.`);
      process.exit(0);
    }
  }
  return { push, json };
}

async function main() {
  const { push, json } = parseArgs(process.argv.slice(2));

  const report = await buildStatusReport({
    mongoose,
    fetchImpl: globalThis.fetch,
    loadAiConfig: loadConfig,
    disconnectMongo: true,
  });

  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Status report: ${report.service} v${report.version || '?'} @ ${report.reportedAt}`);
    console.log(`Instance: ${report.instance || '(none)'}`);
    if (report.runtime) {
      console.log(
        `Runtime: node ${report.runtime.node || '?'} · os ${
          (report.runtime.os && report.runtime.os.prettyName) || '?'
        } (LTS scored by collector)`
      );
    }
    console.log('');
    for (const c of report.checks) {
      console.log(`[${c.status}] ${c.name}: ${c.message}`);
    }
  }

  if (push) {
    const cfg = readReporterConfig(process.env);
    if (!cfg.enabled) {
      console.error('\nCannot --push: set STATUS_REPORT_URL and STATUS_REPORT_KEY');
      process.exit(1);
    }
    const result = await pushStatusReport(report, {
      url: cfg.url,
      key: cfg.key,
      fetchImpl: globalThis.fetch,
    });
    if (!result.ok) {
      console.error('\nPush failed:', result.error || result.status);
      process.exit(1);
    }
    if (!json) {
      console.log('\nPushed OK to', cfg.url);
    }
  }

  const failed = report.checks.some((c) => c.status === 'fail');
  process.exit(failed && push ? 1 : 0);
}

main().catch((err) => {
  console.error('report-status failed:', err.message || err);
  process.exit(1);
});
