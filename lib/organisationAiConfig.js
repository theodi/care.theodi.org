/**
 * Organisation-level AI overrides for services/aiChat.chatCompletion (merged over env loadConfig()).
 */

const ALLOWED_PROVIDERS = new Set([
  'openai',
  'openai_compatible',
  'anthropic',
  'google',
  'gemini',
  'azure',
  'azure_openai',
]);

function normalizeProvider(raw) {
  if (!raw || String(raw).trim() === '') return null;
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

/**
 * @param {object|null|undefined} orgAi — Mongoose subdoc or plain object
 * @returns {object|null} — runtime overrides for chatCompletion, or null if not usable
 */
function orgAiToRuntimeOverrides(orgAi) {
  if (!orgAi || !orgAi.enabled) return null;
  const provider = normalizeProvider(orgAi.provider);
  if (!provider || !ALLOWED_PROVIDERS.has(provider)) return null;
  const apiKey = typeof orgAi.apiKey === 'string' ? orgAi.apiKey.trim() : '';
  const model = typeof orgAi.model === 'string' ? orgAi.model.trim() : '';
  if (!apiKey || !model) return null;

  const maxTokens = parseInt(orgAi.maxTokens, 10);
  const overrides = {
    provider,
    apiKey,
    model,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
    baseURL:
      typeof orgAi.baseURL === 'string' && orgAi.baseURL.trim()
        ? orgAi.baseURL.trim().replace(/\/$/, '')
        : undefined,
    openaiApiVersion:
      typeof orgAi.openaiApiVersion === 'string' && orgAi.openaiApiVersion.trim()
        ? orgAi.openaiApiVersion.trim()
        : undefined,
    useApiKeyHeader: !!orgAi.useApiKeyHeader,
    anthropicBaseUrl:
      typeof orgAi.anthropicBaseUrl === 'string' && orgAi.anthropicBaseUrl.trim()
        ? orgAi.anthropicBaseUrl.trim().replace(/\/$/, '')
        : undefined,
    googleBaseUrl:
      typeof orgAi.googleBaseUrl === 'string' && orgAi.googleBaseUrl.trim()
        ? orgAi.googleBaseUrl.trim().replace(/\/$/, '')
        : undefined,
    disableStructuredOutput: !!orgAi.disableStructuredOutput,
    openaiUseLegacyMaxTokens: !!orgAi.openaiUseLegacyMaxTokens,
  };

  Object.keys(overrides).forEach((k) => {
    if (overrides[k] === undefined) delete overrides[k];
  });
  return overrides;
}

/**
 * Validate admin PUT body; returns normalised fields for merge (apiKey may be omitted to preserve).
 */
function validateOrgAiUpdate(body) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Expected JSON body');
    err.status = 400;
    throw err;
  }
  const enabled = !!body.enabled;
  if (!enabled) {
    return { enabled: false };
  }
  const provider = normalizeProvider(body.provider);
  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    const err = new Error(
      `Invalid provider. Use one of: ${[...ALLOWED_PROVIDERS].sort().join(', ')}`
    );
    err.status = 400;
    throw err;
  }
  const model = String(body.model == null ? '' : body.model).trim();
  if (!model) {
    const err = new Error('Model is required when organisation AI is enabled');
    err.status = 400;
    throw err;
  }
  const apiKeyIn = body.apiKey;
  const hasNewKey =
    typeof apiKeyIn === 'string' && apiKeyIn.trim() !== '';

  const maxTokensRaw = body.maxTokens;
  let maxTokens;
  if (maxTokensRaw != null && maxTokensRaw !== '') {
    maxTokens = parseInt(maxTokensRaw, 10);
    if (!Number.isFinite(maxTokens) || maxTokens < 1) {
      const err = new Error('maxTokens must be a positive integer');
      err.status = 400;
      throw err;
    }
  }

  const out = {
    enabled: true,
    provider,
    model,
    baseURL: String(body.baseURL == null ? '' : body.baseURL).trim() || undefined,
    maxTokens: maxTokens != null ? maxTokens : undefined,
    openaiApiVersion:
      String(body.openaiApiVersion == null ? '' : body.openaiApiVersion).trim() || undefined,
    useApiKeyHeader: !!body.useApiKeyHeader,
    anthropicBaseUrl:
      String(body.anthropicBaseUrl == null ? '' : body.anthropicBaseUrl).trim() || undefined,
    googleBaseUrl:
      String(body.googleBaseUrl == null ? '' : body.googleBaseUrl).trim() || undefined,
    disableStructuredOutput: !!body.disableStructuredOutput,
    openaiUseLegacyMaxTokens: !!body.openaiUseLegacyMaxTokens,
  };
  if (hasNewKey) {
    out.apiKey = apiKeyIn.trim();
  }
  return out;
}

function sanitizeOrgAiForProvider(doc) {
  const p = normalizeProvider(doc.provider);
  const next = { ...doc };
  if (!['openai_compatible', 'azure_openai', 'azure'].includes(p)) {
    delete next.baseURL;
    delete next.openaiApiVersion;
    next.useApiKeyHeader = false;
  }
  if (p !== 'anthropic') {
    delete next.anthropicBaseUrl;
  }
  if (p !== 'google' && p !== 'gemini') {
    delete next.googleBaseUrl;
  }
  if (!['openai', 'openai_compatible', 'azure_openai', 'azure'].includes(p)) {
    next.openaiUseLegacyMaxTokens = false;
  }
  return next;
}

function mergeOrgAiIntoSubscription(existing, validated) {
  const prev =
    existing && typeof existing === 'object'
      ? { ...(typeof existing.toObject === 'function' ? existing.toObject() : existing) }
      : {};
  if (!validated.enabled) {
    return { ...prev, enabled: false };
  }
  const next = { ...prev, ...validated };
  if (!next.apiKey && typeof prev.apiKey === 'string' && prev.apiKey.trim()) {
    next.apiKey = prev.apiKey.trim();
  }
  if (!next.apiKey || !String(next.apiKey).trim()) {
    const err = new Error(
      'API key is required when organisation AI is enabled (enter a key or leave blank to keep the saved key)'
    );
    err.status = 400;
    throw err;
  }
  const p = normalizeProvider(next.provider);
  const needsBaseURL =
    p === 'openai_compatible' || p === 'azure_openai' || p === 'azure';
  if (needsBaseURL) {
    const bu = typeof next.baseURL === 'string' ? next.baseURL.trim() : '';
    if (!bu) {
      const err = new Error(
        'Base URL is required for openai_compatible and Azure OpenAI providers'
      );
      err.status = 400;
      throw err;
    }
  }
  return sanitizeOrgAiForProvider(next);
}

function maskOrgAiForClient(orgAi) {
  if (!orgAi || typeof orgAi !== 'object') {
    return {
      enabled: false,
      provider: '',
      model: '',
      baseURL: '',
      maxTokens: 8192,
      openaiApiVersion: '',
      useApiKeyHeader: false,
      anthropicBaseUrl: '',
      googleBaseUrl: '',
      disableStructuredOutput: false,
      openaiUseLegacyMaxTokens: false,
      apiKeySet: false,
    };
  }
  const key = typeof orgAi.apiKey === 'string' ? orgAi.apiKey : '';
  return {
    enabled: !!orgAi.enabled,
    provider: orgAi.provider || '',
    model: orgAi.model || '',
    baseURL: orgAi.baseURL || '',
    maxTokens: orgAi.maxTokens != null ? orgAi.maxTokens : 8192,
    openaiApiVersion: orgAi.openaiApiVersion || '',
    useApiKeyHeader: !!orgAi.useApiKeyHeader,
    anthropicBaseUrl: orgAi.anthropicBaseUrl || '',
    googleBaseUrl: orgAi.googleBaseUrl || '',
    disableStructuredOutput: !!orgAi.disableStructuredOutput,
    openaiUseLegacyMaxTokens: !!orgAi.openaiUseLegacyMaxTokens,
    apiKeySet: key.trim().length > 0,
  };
}

module.exports = {
  ALLOWED_PROVIDERS,
  normalizeProvider,
  orgAiToRuntimeOverrides,
  validateOrgAiUpdate,
  mergeOrgAiIntoSubscription,
  sanitizeOrgAiForProvider,
  maskOrgAiForClient,
};
