const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  connectionResultsToChecks,
  npmAuditToCheck,
  slugifyCheckId,
  buildStatusReport,
} = require('../lib/statusReport');
const {
  readReporterConfig,
  pushStatusReport,
  reportOnce,
  startStatusReporter,
} = require('../lib/statusReporter');

describe('statusReport mapping', () => {
  it('slugifies check ids', () => {
    assert.equal(slugifyCheckId('AI (anthropic)'), 'ai_anthropic');
  });

  it('maps connection rows to SPEC checks', () => {
    const checks = connectionResultsToChecks([
      { name: 'MongoDB', status: 'ok', message: 'connected' },
      { name: 'HubSpot', status: 'fail', message: 'expired' },
    ]);
    assert.equal(checks[0].id, 'mongodb');
    assert.equal(checks[1].status, 'fail');
    assert.equal(checks[1].message, 'expired');
  });

  it('maps npm audit JSON to fail on high vulns', () => {
    const check = npmAuditToCheck({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    });
    assert.equal(check.status, 'fail');
    assert.match(check.message, /1 vulnerabilit/);
  });

  it('maps clean audit to ok', () => {
    const check = npmAuditToCheck({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    });
    assert.equal(check.status, 'ok');
  });

  it('maps audit errors to warn', () => {
    const check = npmAuditToCheck(null, new Error('boom'));
    assert.equal(check.status, 'warn');
  });

  it('builds a report with runtime versions and lockfiles (no client npm audit)', async () => {
    const report = await buildStatusReport({
      packageJson: { name: 'care.theodi.org', version: '3.0.0' },
      connectionResults: [{ name: 'MongoDB', status: 'ok', message: 'connected (care)' }],
      includeNpmAudit: false,
      dependencies: {
        packageJson: { name: 'care.theodi.org', version: '3.0.0' },
        packageLock: { lockfileVersion: 3, packages: {} },
      },
      runtime: {
        node: 'v22.23.2',
        os: { id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04.1 LTS' },
      },
      env: {},
      instance: 'test-host',
    });
    assert.equal(report.service, 'care.theodi.org');
    assert.equal(report.version, '3.0.0');
    assert.equal(report.instance, 'test-host');
    assert.ok(report.reportedAt);
    assert.equal(report.runtime.node, 'v22.23.2');
    assert.equal(report.runtime.os.id, 'ubuntu');
    assert.ok(report.dependencies);
    assert.equal(report.dependencies.packageLock.lockfileVersion, 3);
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0].id, 'mongodb');
    assert.ok(!report.checks.some((c) => c.id === 'npm_audit'));
    assert.ok(!report.checks.some((c) => c.id === 'node_runtime'));
  });
});

describe('statusReporter', () => {
  it('is disabled when URL or key missing', () => {
    const cfg = readReporterConfig({});
    assert.equal(cfg.enabled, false);
  });

  it('is enabled when URL and key set', () => {
    const cfg = readReporterConfig({
      STATUS_REPORT_URL: 'http://localhost:3090/reports',
      STATUS_REPORT_KEY: 'secret',
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.url, 'http://localhost:3090/reports');
  });

  it('skips reportOnce when disabled', async () => {
    const out = await reportOnce({ env: {} });
    assert.equal(out.skipped, true);
  });

  it('POSTs with Bearer token', async () => {
    let captured;
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        async text() {
          return '{"ok":true}';
        },
      };
    };
    const result = await pushStatusReport(
      { service: 'care.theodi.org', checks: [] },
      { url: 'http://localhost:3090/reports', key: 'dev-key', fetchImpl }
    );
    assert.equal(result.ok, true);
    assert.equal(captured.url, 'http://localhost:3090/reports');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers.Authorization, 'Bearer dev-key');
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.service, 'care.theodi.org');
  });

  it('startStatusReporter no-ops when disabled', () => {
    const handle = startStatusReporter({ env: {} });
    assert.equal(handle.enabled, false);
    handle.stop();
  });
});
