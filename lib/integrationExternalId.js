const MAX_LEN = 256;

/**
 * Normalise integration external id from client/API body.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function normalizeIntegrationExternalId(input) {
  if (input === null || input === undefined || input === '') {
    return { ok: true, value: '' };
  }
  const s = String(input).trim();
  if (s.length > MAX_LEN) {
    return { ok: false, error: `integrationExternalId must be at most ${MAX_LEN} characters` };
  }
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    return { ok: false, error: 'integrationExternalId contains invalid characters' };
  }
  return { ok: true, value: s };
}

module.exports = {
  normalizeIntegrationExternalId,
  MAX_INTEGRATION_EXTERNAL_ID_LENGTH: MAX_LEN,
};
