const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAndNormalizeScanContextUpdate,
  mergeScanContextIntoSubscription,
  maskScanContextForClient,
  scanContextPresenceByStage,
  getScanContextForMessageId,
  MAX_STAGE_CHARS,
  replaceOrgContextPlaceholder,
} = require('../lib/organisationScanContext');

test('validateAndNormalizeScanContextUpdate accepts stages wrapper', () => {
  const out = validateAndNormalizeScanContextUpdate({
    stages: { completeAssessment: '  hello  ', intendedConsequences: '' },
  });
  assert.equal(out.completeAssessment, 'hello');
  assert.equal(out.intendedConsequences, '');
  assert.equal(Object.keys(out).length, 2);
});

test('validateAndNormalizeScanContextUpdate rejects non-string stage value', () => {
  assert.throws(
    () => validateAndNormalizeScanContextUpdate({ stages: { stakeholders: 1 } }),
    /must be a string/
  );
});

test('validateAndNormalizeScanContextUpdate rejects empty body keys', () => {
  assert.throws(
    () => validateAndNormalizeScanContextUpdate({ stages: {} }),
    /at least one stage key/
  );
});

test('mergeScanContextIntoSubscription preserves unspecified keys', () => {
  const existing = { completeAssessment: 'a', intendedConsequences: 'b' };
  const merged = mergeScanContextIntoSubscription(existing, { stakeholders: 'c' });
  assert.equal(merged.completeAssessment, 'a');
  assert.equal(merged.intendedConsequences, 'b');
  assert.equal(merged.stakeholders, 'c');
});

test('maskScanContextForClient fills missing keys', () => {
  const m = maskScanContextForClient({ completeAssessment: 'x' });
  assert.equal(m.completeAssessment, 'x');
  assert.equal(m.intendedConsequences, '');
});

test('scanContextPresenceByStage is true only for non-empty trimmed text', () => {
  const p = scanContextPresenceByStage({ completeAssessment: ' hi ', intendedConsequences: '   ' });
  assert.equal(p.completeAssessment, true);
  assert.equal(p.intendedConsequences, false);
});

test('getScanContextForMessageId ignores unknown message id', () => {
  assert.equal(getScanContextForMessageId({ stakeholders: 'z' }, 'projectDetails'), '');
});

test('normalize truncates to MAX_STAGE_CHARS', () => {
  const long = 'x'.repeat(MAX_STAGE_CHARS + 50);
  const out = validateAndNormalizeScanContextUpdate({
    stages: { completeAssessment: long },
  });
  assert.equal(out.completeAssessment.length, MAX_STAGE_CHARS);
});

test('replaceOrgContextPlaceholder substitutes {{orgContext}}', () => {
  const out = replaceOrgContextPlaceholder('Before\n{{orgContext}}\nAfter', 'Org line');
  assert.equal(out, 'Before\nOrg line\nAfter');
});

test('replaceOrgContextPlaceholder replaces all occurrences and clears when empty', () => {
  assert.equal(replaceOrgContextPlaceholder('{{orgContext}}', 'x'), 'x');
  assert.equal(replaceOrgContextPlaceholder('A {{orgContext}} B {{orgContext}}', 'z'), 'A z B z');
  assert.equal(replaceOrgContextPlaceholder('Hi {{orgContext}}', ''), 'Hi ');
  assert.equal(replaceOrgContextPlaceholder('Hi {{orgContext}}', '   '), 'Hi ');
});
