const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_DOCX_PATCH_KEYS,
  OPTIONAL_DOCX_PATCH_KEYS,
  KNOWN_DOCX_PATCH_KEYS,
} = require('../lib/reportTemplatePlaceholders');

describe('reportTemplatePlaceholders', () => {
  it('keeps optional keys out of required validation', () => {
    const optional = [
      'footertitle',
      'footerdate',
      'riskBandSplitChart',
      'riskMatrixChart',
      'riskCountsSummary',
      'topRisks',
    ];
    for (const key of optional) {
      assert.equal(OPTIONAL_DOCX_PATCH_KEYS.includes(key), true, key);
      assert.equal(REQUIRED_DOCX_PATCH_KEYS.includes(key), false, key);
      assert.equal(KNOWN_DOCX_PATCH_KEYS.includes(key), true, key);
    }
  });

  it('does not list the same key as required and optional', () => {
    const overlap = REQUIRED_DOCX_PATCH_KEYS.filter((k) => OPTIONAL_DOCX_PATCH_KEYS.includes(k));
    assert.deepEqual(overlap, []);
  });
});
