/**
 * Human-readable AI vendor + model for privacy / about pages.
 * Optional env overrides for deployments using custom endpoints:
 *   AI_PUBLIC_VENDOR_NAME — e.g. "Acme Corp AI gateway"
 *   AI_PUBLIC_VENDOR_PRIVACY_URL — https://...
 */

const { loadConfig } = require('./aiChat');

const DEFAULT_PRIVACY_URLS = {
  openai: 'https://openai.com/policies/privacy-policy/',
  anthropic: 'https://www.anthropic.com/legal/privacy',
  google: 'https://policies.google.com/privacy',
  azure: 'https://privacy.microsoft.com/privacy',
};

function providerDisplayName(provider) {
  const p = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  switch (p) {
    case 'openai':
      return 'OpenAI';
    case 'openai_compatible':
      return 'an OpenAI-compatible AI service';
    case 'azure_openai':
    case 'azure':
      return 'Microsoft Azure OpenAI Service';
    case 'anthropic':
      return 'Anthropic';
    case 'google':
    case 'gemini':
      return 'Google (Gemini)';
    default:
      return 'a third-party AI provider';
  }
}

function defaultPrivacyUrl(provider) {
  const p = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (p === 'openai' || p === 'openai_compatible') {
    return DEFAULT_PRIVACY_URLS.openai;
  }
  if (p === 'azure_openai' || p === 'azure') {
    return DEFAULT_PRIVACY_URLS.azure;
  }
  if (p === 'anthropic') {
    return DEFAULT_PRIVACY_URLS.anthropic;
  }
  if (p === 'google' || p === 'gemini') {
    return DEFAULT_PRIVACY_URLS.google;
  }
  return null;
}

/**
 * @returns {{
 *   providerKey: string,
 *   providerDisplay: string,
 *   model: string,
 *   privacyPolicyUrl: string | null,
 *   usesLikelyCustomEndpoint: boolean
 * }}
 */
function getAiPrivacyDisclosure() {
  const cfg = loadConfig();
  const envName = process.env.AI_PUBLIC_VENDOR_NAME?.trim();
  const envUrl = process.env.AI_PUBLIC_VENDOR_PRIVACY_URL?.trim();

  const providerDisplay = envName || providerDisplayName(cfg.provider);
  const privacyPolicyUrl = envUrl || defaultPrivacyUrl(cfg.provider);
  const usesLikelyCustomEndpoint =
    Boolean(cfg.baseURL) &&
    (cfg.provider === 'openai_compatible' ||
      cfg.provider === 'azure_openai' ||
      cfg.provider === 'azure');

  return {
    providerKey: cfg.provider,
    providerDisplay,
    model: cfg.model || '',
    privacyPolicyUrl: privacyPolicyUrl || null,
    usesLikelyCustomEndpoint,
  };
}

module.exports = {
  getAiPrivacyDisclosure,
  providerDisplayName,
  defaultPrivacyUrl,
};
