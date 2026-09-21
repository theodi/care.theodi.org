const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIntegrationExternalId, MAX_INTEGRATION_EXTERNAL_ID_LENGTH } = require('../lib/integrationExternalId');

describe('integrationExternalId', () => {
  it('trims and accepts normal strings', () => {
    assert.deepEqual(normalizeIntegrationExternalId('  abc  '), { ok: true, value: 'abc' });
  });

  it('maps null/undefined/empty to clear', () => {
    assert.deepEqual(normalizeIntegrationExternalId(null), { ok: true, value: '' });
    assert.deepEqual(normalizeIntegrationExternalId(''), { ok: true, value: '' });
  });

  it('rejects over max length', () => {
    const long = 'x'.repeat(MAX_INTEGRATION_EXTERNAL_ID_LENGTH + 1);
    const r = normalizeIntegrationExternalId(long);
    assert.equal(r.ok, false);
    assert.match(r.error, /at most/);
  });

  it('rejects control characters', () => {
    const r = normalizeIntegrationExternalId('a\nb');
    assert.equal(r.ok, false);
  });
});
