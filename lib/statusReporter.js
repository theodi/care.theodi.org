/**
 * Periodically push status reports to a central collector.
 * Disabled unless STATUS_REPORT_URL and STATUS_REPORT_KEY are set.
 */

const { buildStatusReport } = require('./statusReport');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 5000;

function readReporterConfig(env) {
  const e = env || process.env;
  const url = (e.STATUS_REPORT_URL || '').trim();
  const key = (e.STATUS_REPORT_KEY || '').trim();
  const intervalMs = parseInt(e.STATUS_REPORT_INTERVAL_MS || String(DEFAULT_INTERVAL_MS), 10);
  return {
    enabled: Boolean(url && key),
    url,
    key,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 10000 ? intervalMs : DEFAULT_INTERVAL_MS,
  };
}

/**
 * POST one report. Never throws.
 */
async function pushStatusReport(report, { url, key, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (!url || !key) {
    return { ok: false, skipped: true, reason: 'url or key missing' };
  }
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'fetch is not available' };
  }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(report),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 300) || res.statusText,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Build + push once. Logs warnings on failure; never throws.
 */
async function reportOnce(options = {}) {
  const cfg = options.config || readReporterConfig(options.env);
  if (!cfg.enabled && !options.force) {
    return { ok: false, skipped: true, reason: 'reporter disabled' };
  }
  if ((!cfg.url || !cfg.key) && options.force) {
    return { ok: false, skipped: true, reason: 'STATUS_REPORT_URL / STATUS_REPORT_KEY required' };
  }

  let report;
  try {
    report =
      options.report ||
      (await buildStatusReport({
        env: options.env,
        mongoose: options.mongoose,
        fetchImpl: options.fetchImpl,
        loadAiConfig: options.loadAiConfig,
        includeNpmAudit: options.includeNpmAudit,
        includeRuntime: options.includeRuntime,
        includeDependencies: options.includeDependencies,
        npmAuditCheck: options.npmAuditCheck,
        connectionResults: options.connectionResults,
        spawnFn: options.spawnFn,
        packageJson: options.packageJson,
        service: options.service,
        version: options.version,
        instance: options.instance,
        runtime: options.runtime,
        dependencies: options.dependencies,
        cwd: options.cwd,
        nodeVersion: options.nodeVersion,
        osInfo: options.osInfo,
      }));
  } catch (err) {
    console.warn('[statusReporter] failed to build report:', err.message || err);
    return { ok: false, error: err.message || String(err) };
  }

  const result = await pushStatusReport(report, {
    url: cfg.url,
    key: cfg.key,
    fetchImpl: options.fetchImpl,
  });

  if (result.skipped) {
    return result;
  }
  if (!result.ok) {
    console.warn(
      '[statusReporter] push failed:',
      result.status ? `HTTP ${result.status}` : '',
      result.error || ''
    );
  } else {
    console.log('[statusReporter] pushed report for', report.service);
  }
  return { ...result, report };
}

/**
 * Start background reporter. Returns a stop() function.
 */
function startStatusReporter(options = {}) {
  const cfg = readReporterConfig(options.env);
  if (!cfg.enabled) {
    return { stop() {}, enabled: false };
  }

  let timer = null;
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await reportOnce({ ...options, config: cfg });
    } finally {
      inFlight = false;
    }
  };

  const startupDelay = options.startupDelayMs != null ? options.startupDelayMs : STARTUP_DELAY_MS;
  const startupTimer = setTimeout(() => {
    tick();
    timer = setInterval(tick, cfg.intervalMs);
    if (timer.unref) timer.unref();
  }, startupDelay);
  if (startupTimer.unref) startupTimer.unref();

  console.log(
    `[statusReporter] enabled → ${cfg.url} every ${cfg.intervalMs}ms (first push in ${startupDelay}ms)`
  );

  return {
    enabled: true,
    stop() {
      stopped = true;
      clearTimeout(startupTimer);
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = {
  readReporterConfig,
  pushStatusReport,
  reportOnce,
  startStatusReporter,
  DEFAULT_INTERVAL_MS,
};
