/**
 * Live checks for env-configured services (MongoDB, HubSpot, AI provider).
 * Used by scripts/test-connections.js. Fetch/mongoose can be injected for unit tests.
 */

const DEFAULT_TIMEOUT_MS = 12000;

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

function isPlaceholder(value) {
  if (isBlank(value)) {
    return true;
  }
  const v = String(value).trim().toLowerCase();
  return (
    v.startsWith('your_') ||
    v.includes('your_') ||
    v.includes('changeme') ||
    v === 'placeholder' ||
    v.endsWith('_here')
  );
}

function parseJsonSafe(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(bodyText, parsed) {
  if (parsed) {
    if (parsed.message) return String(parsed.message);
    if (parsed.error && typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && parsed.error.message) return String(parsed.error.message);
    if (parsed.detail) return String(parsed.detail);
  }
  if (bodyText && bodyText.length > 0 && bodyText.length < 400) {
    return bodyText;
  }
  return '';
}

/**
 * Turn an HTTP auth/error response into a human warning/error line.
 * @param {string} service
 * @param {number} status
 * @param {string} [bodyText]
 */
function describeHttpFailure(service, status, bodyText) {
  const parsed = parseJsonSafe(bodyText);
  const detail = extractErrorMessage(bodyText, parsed);
  const lower = `${detail} ${bodyText || ''}`.toLowerCase();

  if (status === 401 || status === 403) {
    if (lower.includes('expir')) {
      return `${service} API key expired or invalid (HTTP ${status})`;
    }
    if (
      lower.includes('invalid') ||
      lower.includes('revoked') ||
      lower.includes('unauthorized') ||
      lower.includes('authentication') ||
      lower.includes('incorrect api key')
    ) {
      return `${service} API key rejected (HTTP ${status})`;
    }
    return `${service} authentication failed (HTTP ${status})`;
  }

  if (detail) {
    return `${service} HTTP ${status}: ${detail}`;
  }
  return `${service} HTTP ${status}`;
}

function result(name, status, message, extra) {
  const row = { name, status, message };
  if (extra && typeof extra === 'object') {
    Object.assign(row, extra);
  }
  return row;
}

async function readResponseText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      const timed = new Error(`Request timed out after ${timeout}ms`);
      timed.code = 'TIMEOUT';
      throw timed;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function humanizeNetworkError(err) {
  if (!err) return 'unknown error';
  const msg = err.message || String(err);
  const code = err.code || (err.cause && err.cause.code);
  if (err.code === 'TIMEOUT' || err.name === 'AbortError') {
    return msg;
  }
  if (code === 'ECONNREFUSED') {
    return `connection refused (${msg})`;
  }
  if (code === 'ENOTFOUND') {
    return `host not found (${msg})`;
  }
  if (code === 'ETIMEDOUT') {
    return `timed out (${msg})`;
  }
  return msg;
}

async function checkMongo({ uri, dbName, mongoose, timeoutMs }) {
  const name = 'MongoDB';
  if (isBlank(uri)) {
    return result(name, 'fail', 'MONGO_URI is not set');
  }
  if (isPlaceholder(uri)) {
    return result(name, 'fail', 'MONGO_URI looks like a placeholder from config.env.example');
  }
  if (!mongoose || typeof mongoose.connect !== 'function') {
    return result(name, 'fail', 'mongoose is not available');
  }

  try {
    await mongoose.connect(uri, {
      dbName: dbName || undefined,
      serverSelectionTimeoutMS: timeoutMs || 8000,
    });
    const db = mongoose.connection && mongoose.connection.db;
    if (!db || typeof db.admin !== 'function') {
      return result(name, 'fail', 'connected but could not ping the database');
    }
    await db.admin().command({ ping: 1 });
    const connectedName = mongoose.connection.name || dbName || 'ok';
    return result(name, 'ok', `connected (${connectedName})`);
  } catch (err) {
    const msg = humanizeNetworkError(err);
    const lower = msg.toLowerCase();
    if (lower.includes('auth')) {
      return result(name, 'fail', `authentication failed: ${msg}`);
    }
    return result(name, 'fail', msg);
  } finally {
    if (mongoose && typeof mongoose.disconnect === 'function') {
      try {
        await mongoose.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

async function checkHubspot({ apiKey, fetchImpl, timeoutMs }) {
  const name = 'HubSpot';
  const fetchFn = fetchImpl || globalThis.fetch;
  if (isBlank(apiKey) || isPlaceholder(apiKey)) {
    return result(
      name,
      'warn',
      'HUBSPOT_API_KEY is not set — membership lookup and HubSpot sync will not work'
    );
  }
  if (typeof fetchFn !== 'function') {
    return result(name, 'fail', 'fetch is not available');
  }

  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  const urls = [
    'https://api.hubapi.com/account-info/v3/details',
    'https://api.hubapi.com/integrations/v1/me',
  ];

  try {
    let lastFailure = null;
    for (const url of urls) {
      const res = await fetchWithTimeout(fetchFn, url, { method: 'GET', headers }, timeoutMs);
      const bodyText = await readResponseText(res);
      if (res.ok) {
        const parsed = parseJsonSafe(bodyText) || {};
        const portalId = parsed.portalId || parsed.portal_id;
        const extra = portalId ? `portalId=${portalId}` : 'authenticated';
        return result(name, 'ok', extra);
      }
      if (res.status === 401 || res.status === 403) {
        return result(name, 'fail', describeHttpFailure('HubSpot', res.status, bodyText));
      }
      if (res.status !== 404) {
        lastFailure = describeHttpFailure('HubSpot', res.status, bodyText);
      }
    }
    return result(name, 'fail', lastFailure || 'HubSpot account endpoint not found');
  } catch (err) {
    return result(name, 'fail', humanizeNetworkError(err));
  }
}

function openaiAuthHeaders(cfg) {
  const headers = { Accept: 'application/json' };
  if (cfg.useApiKeyHeader) {
    headers['api-key'] = cfg.apiKey;
  } else {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return headers;
}

function openaiModelsUrl(cfg) {
  if (cfg.baseURL) {
    const base = cfg.baseURL.replace(/\/$/, '');
    const url = new URL(`${base}/models`);
    if (cfg.openaiApiVersion) {
      url.searchParams.set('api-version', cfg.openaiApiVersion);
    }
    return url.toString();
  }
  return 'https://api.openai.com/v1/models';
}

async function checkAi({ cfg, fetchImpl, timeoutMs }) {
  const provider = (cfg && cfg.provider) || 'unknown';
  const name = `AI (${provider})`;
  const fetchFn = fetchImpl || globalThis.fetch;

  if (!cfg || isBlank(cfg.apiKey) || isPlaceholder(cfg.apiKey)) {
    return result(
      name,
      'warn',
      'No AI API key configured — the assistant will not work until a key is set'
    );
  }
  if (typeof fetchFn !== 'function') {
    return result(name, 'fail', 'fetch is not available');
  }

  try {
    if (provider === 'anthropic') {
      const base = (cfg.anthropicBaseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
      const res = await fetchWithTimeout(
        fetchFn,
        `${base}/v1/models`,
        {
          method: 'GET',
          headers: {
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            Accept: 'application/json',
          },
        },
        timeoutMs
      );
      const bodyText = await readResponseText(res);
      if (!res.ok) {
        return result(name, 'fail', describeHttpFailure('Anthropic', res.status, bodyText));
      }
      const parsed = parseJsonSafe(bodyText);
      const count = parsed && Array.isArray(parsed.data) ? parsed.data.length : null;
      const modelHint = cfg.model ? `model=${cfg.model}` : 'authenticated';
      return result(name, 'ok', count != null ? `${modelHint}, ${count} models listed` : modelHint);
    }

    if (provider === 'google' || provider === 'gemini') {
      const base = (cfg.googleBaseUrl || 'https://generativelanguage.googleapis.com').replace(
        /\/$/,
        ''
      );
      const url = `${base}/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetchWithTimeout(fetchFn, url, { method: 'GET' }, timeoutMs);
      const bodyText = await readResponseText(res);
      if (!res.ok) {
        return result(name, 'fail', describeHttpFailure('Google Gemini', res.status, bodyText));
      }
      return result(name, 'ok', cfg.model ? `model=${cfg.model}` : 'authenticated');
    }

    if (
      provider === 'openai' ||
      provider === 'openai_compatible' ||
      provider === 'azure_openai' ||
      provider === 'azure'
    ) {
      const url = openaiModelsUrl(cfg);
      const res = await fetchWithTimeout(
        fetchFn,
        url,
        { method: 'GET', headers: openaiAuthHeaders(cfg) },
        timeoutMs
      );
      const bodyText = await readResponseText(res);
      if (res.ok) {
        const parsed = parseJsonSafe(bodyText);
        const count = parsed && Array.isArray(parsed.data) ? parsed.data.length : null;
        const modelHint = cfg.model ? `model=${cfg.model}` : 'authenticated';
        return result(name, 'ok', count != null ? `${modelHint}, ${count} models listed` : modelHint);
      }
      if (res.status === 401 || res.status === 403) {
        return result(name, 'fail', describeHttpFailure('OpenAI', res.status, bodyText));
      }
      if (res.status === 404) {
        return result(
          name,
          'warn',
          'API key is set but the models list endpoint was not found (common on some Azure/proxy setups). Run npm run test-ai to confirm completions.'
        );
      }
      return result(name, 'fail', describeHttpFailure('OpenAI', res.status, bodyText));
    }

    return result(name, 'warn', `Unknown AI_PROVIDER "${provider}" — skipped live check`);
  } catch (err) {
    return result(name, 'fail', humanizeNetworkError(err));
  }
}

function checkOauthConfig(env) {
  const e = env || {};
  const rows = [];
  const googleOk =
    !isBlank(e.GOOGLE_CLIENT_ID) &&
    !isPlaceholder(e.GOOGLE_CLIENT_ID) &&
    !isBlank(e.GOOGLE_CLIENT_SECRET) &&
    !isPlaceholder(e.GOOGLE_CLIENT_SECRET);
  const djangoOk =
    !isBlank(e.DJANGO_CLIENT_ID) &&
    !isPlaceholder(e.DJANGO_CLIENT_ID) &&
    !isBlank(e.DJANGO_CLIENT_SECRET) &&
    !isPlaceholder(e.DJANGO_CLIENT_SECRET);

  if (googleOk) {
    rows.push(result('Google OAuth', 'ok', 'client id and secret are set (not live-tested)'));
  } else {
    rows.push(
      result(
        'Google OAuth',
        'warn',
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — Google login will fail'
      )
    );
  }

  if (djangoOk) {
    rows.push(result('Django OAuth', 'ok', 'client id and secret are set (not live-tested)'));
  } else {
    rows.push(
      result(
        'Django OAuth',
        'warn',
        'DJANGO_CLIENT_ID / DJANGO_CLIENT_SECRET missing — ODI login will fail'
      )
    );
  }

  if (isBlank(e.SESSION_SECRET) || isPlaceholder(e.SESSION_SECRET)) {
    rows.push(result('Session', 'warn', 'SESSION_SECRET is not set'));
  } else {
    rows.push(result('Session', 'ok', 'SESSION_SECRET is set'));
  }

  return rows;
}

/**
 * @returns {Promise<{ results: object[], failed: number, warned: number, ok: boolean }>}
 */
async function runConnectionChecks({ env, mongoose, fetchImpl, loadAiConfig, timeoutMs } = {}) {
  const e = env || process.env;
  const cfg = typeof loadAiConfig === 'function' ? loadAiConfig() : null;

  const [mongo, hubspot, ai] = await Promise.all([
    checkMongo({
      uri: e.MONGO_URI,
      dbName: e.MONGO_DB,
      mongoose,
      timeoutMs,
    }),
    checkHubspot({
      apiKey: e.HUBSPOT_API_KEY,
      fetchImpl,
      timeoutMs,
    }),
    checkAi({
      cfg: cfg || {
        provider: e.AI_PROVIDER || 'openai',
        apiKey: e.AI_API_KEY || e.OPENAI_API_KEY || e.ANTHROPIC_API_KEY || e.GOOGLE_API_KEY,
        model: e.AI_MODEL,
        baseURL: e.AI_BASE_URL || e.OPENAI_BASE_URL,
        openaiApiVersion: e.AI_OPENAI_API_VERSION,
        useApiKeyHeader: e.AI_OPENAI_USE_API_KEY_HEADER === 'true' || e.AZURE_OPENAI === 'true',
        anthropicBaseUrl: e.ANTHROPIC_BASE_URL,
        googleBaseUrl: e.GOOGLE_AI_BASE_URL,
      },
      fetchImpl,
      timeoutMs,
    }),
  ]);

  const results = [mongo, hubspot, ai, ...checkOauthConfig(e)];
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  return { results, failed, warned, ok: failed === 0 };
}

module.exports = {
  isPlaceholder,
  describeHttpFailure,
  checkMongo,
  checkHubspot,
  checkAi,
  checkOauthConfig,
  runConnectionChecks,
};
