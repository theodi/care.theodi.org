/**
 * Build a service-status push report (collector SPEC).
 * Sends runtime versions + lockfiles — collector scores LTS and npm audit.
 * App checks: live connection probes only (no local npm audit).
 */

const path = require('path');
const { runConnectionChecks } = require('./connectionChecks');
const { detectRuntime } = require('./odi-status/detectRuntime');
const { readDependencies } = require('./odi-status/readDependencies');
const { npmAuditCheck, npmAuditToCheck } = require('./odi-status/checks/npmAudit');

function slugifyCheckId(name) {
  return (
    String(name || 'check')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64) || 'check'
  );
}

/**
 * Map connectionChecks rows into SPEC checks[].
 * @param {Array<{ name: string, status: string, message: string }>} results
 */
function connectionResultsToChecks(results) {
  return (results || []).map((row) => ({
    id: slugifyCheckId(row.name),
    name: row.name,
    status:
      row.status === 'ok' || row.status === 'warn' || row.status === 'fail' ? row.status : 'fail',
    message: row.message || '',
  }));
}

/**
 * @deprecated Prefer collector-side audit via dependencies.
 */
function runNpmAuditCheck(opts = {}) {
  return npmAuditCheck(opts).then((check) => ({ check }));
}

/**
 * Build a full push report.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function buildStatusReport(options = {}) {
  const pkg = options.packageJson || require('../package.json');
  const env = options.env || process.env;
  const cwd = options.cwd || path.join(__dirname, '..');

  let connectionResults = options.connectionResults;
  if (!connectionResults) {
    const mongoose = options.mongoose || require('mongoose');
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const loadAiConfig =
      options.loadAiConfig ||
      (() => {
        try {
          return require('../services/aiChat').loadConfig();
        } catch {
          return null;
        }
      });

    const connection = await runConnectionChecks({
      env,
      mongoose,
      fetchImpl,
      loadAiConfig,
      timeoutMs: options.timeoutMs,
    });
    connectionResults = connection.results;
  }

  const checks = connectionResultsToChecks(connectionResults);

  // Optional legacy: only if explicitly requested
  if (options.includeNpmAudit === true) {
    if (options.npmAuditCheck) {
      checks.push(options.npmAuditCheck);
    } else {
      checks.push(
        await npmAuditCheck({
          cwd,
          timeoutMs: options.npmAuditTimeoutMs,
          spawnFn: options.spawnFn,
        })
      );
    }
  }

  const report = {
    service: options.service || pkg.name || 'care.theodi.org',
    version: options.version || pkg.version || undefined,
    reportedAt: new Date().toISOString(),
    instance:
      options.instance ||
      env.STATUS_REPORT_INSTANCE ||
      env.HOSTNAME ||
      require('os').hostname(),
    checks,
  };

  if (options.includeRuntime !== false) {
    report.runtime =
      options.runtime ||
      detectRuntime({
        nodeVersion: options.nodeVersion,
        osInfo: options.osInfo,
        osReleasePath: options.osReleasePath,
        platform: options.platform,
        release: options.release,
      });
  }

  if (options.includeDependencies !== false) {
    report.dependencies =
      options.dependencies || readDependencies({ cwd }) || undefined;
    if (!report.dependencies) delete report.dependencies;
  }

  return report;
}

module.exports = {
  slugifyCheckId,
  connectionResultsToChecks,
  npmAuditToCheck,
  npmAuditCheck,
  runNpmAuditCheck,
  buildStatusReport,
  detectRuntime,
  readDependencies,
};
