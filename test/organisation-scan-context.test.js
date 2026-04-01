const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAndNormalizeGuidanceItems,
  resolveGuidanceItems,
  scanContextPresenceByStageForSubscription,
  getScanContextTextForSubscription,
  uncoveredScanStages,
  migrateLegacyScanContextToItems,
  MAX_GUIDANCE_CONTENT_CHARS,
  replaceOrgContextPlaceholder,
  SCAN_CONTEXT_STAGE_KEYS,
} = require('../lib/organisationScanContext');

test('validateAndNormalizeGuidanceItems accepts items', () => {
  const out = validateAndNormalizeGuidanceItems({
    items: [
      { title: '  T  ', content: '  body  ', stages: ['completeAssessment', 'stakeholders'] },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'T');
  assert.equal(out[0].content, 'body');
  assert.deepEqual(out[0].stages, ['completeAssessment', 'stakeholders']);
});

test('validateAndNormalizeGuidanceItems rejects missing stages', () => {
  assert.throws(
    () => validateAndNormalizeGuidanceItems({ items: [{ title: 'a', content: 'b', stages: [] }] }),
    /at least one scan step/
  );
});

test('validateAndNormalizeGuidanceItems rejects empty content', () => {
  assert.throws(
    () =>
      validateAndNormalizeGuidanceItems({
        items: [{ title: 'a', content: '   ', stages: ['actionPlanning'] }],
      }),
    /guidance text is required/
  );
});

test('validateAndNormalizeGuidanceItems dedupes stages', () => {
  const out = validateAndNormalizeGuidanceItems({
    items: [{ title: '', content: 'x', stages: ['riskEvaluation', 'riskEvaluation'] }],
  });
  assert.deepEqual(out[0].stages, ['riskEvaluation']);
});

test('validateAndNormalizeGuidanceItems truncates long content', () => {
  const long = 'x'.repeat(MAX_GUIDANCE_CONTENT_CHARS + 50);
  const out = validateAndNormalizeGuidanceItems({
    items: [{ title: '', content: long, stages: ['intendedConsequences'] }],
  });
  assert.equal(out[0].content.length, MAX_GUIDANCE_CONTENT_CHARS);
});

test('resolveGuidanceItems prefers organisationScanGuidanceItems over legacy', () => {
  const sub = {
    organisationScanGuidanceItems: [{ title: 'A', content: 'new', stages: ['actionPlanning'] }],
    organisationScanContext: { completeAssessment: 'legacy' },
  };
  const items = resolveGuidanceItems(sub);
  assert.equal(items.length, 1);
  assert.equal(items[0].content, 'new');
});

test('resolveGuidanceItems migrates legacy flat context', () => {
  const sub = {
    organisationScanContext: { completeAssessment: ' hi ', stakeholders: '' },
  };
  const items = resolveGuidanceItems(sub);
  assert.equal(items.length, 1);
  assert.equal(items[0].content, 'hi');
  assert.deepEqual(items[0].stages, ['completeAssessment']);
});

test('scanContextPresenceByStageForSubscription includes riskEvaluation and actionPlanning', () => {
  const sub = {
    organisationScanGuidanceItems: [
      { title: '', content: 'x', stages: ['riskEvaluation'] },
      { title: '', content: 'y', stages: ['actionPlanning'] },
    ],
  };
  const p = scanContextPresenceByStageForSubscription(sub);
  assert.equal(p.riskEvaluation, true);
  assert.equal(p.actionPlanning, true);
  assert.equal(p.completeAssessment, false);
});

test('getScanContextTextForSubscription joins blocks with title', () => {
  const sub = {
    organisationScanGuidanceItems: [
      { title: 'One', content: 'A', stages: ['stakeholders'] },
      { title: '', content: 'B', stages: ['stakeholders'] },
    ],
  };
  const t = getScanContextTextForSubscription(sub, 'stakeholders');
  assert.match(t, /One/);
  assert.match(t, /A/);
  assert.match(t, /B/);
});

test('getScanContextTextForSubscription ignores unknown message id', () => {
  assert.equal(getScanContextTextForSubscription({}, 'projectDetails'), '');
});

test('uncoveredScanStages lists gaps', () => {
  const sub = {
    organisationScanGuidanceItems: [{ title: '', content: 'x', stages: ['completeAssessment'] }],
  };
  const u = uncoveredScanStages(sub);
  assert.ok(u.length > 0);
  assert.ok(!u.includes('completeAssessment'));
  assert.ok(u.includes('actionPlanning'));
});

test('SCAN_CONTEXT_STAGE_KEYS includes six steps', () => {
  assert.equal(SCAN_CONTEXT_STAGE_KEYS.length, 6);
});

test('migrateLegacyScanContextToItems maps riskEvaluation', () => {
  const items = migrateLegacyScanContextToItems({ riskEvaluation: 'r', actionPlanning: 'a' });
  assert.equal(items.length, 2);
});

test('replaceOrgContextPlaceholder substitutes {{orgContext}}', () => {
  const out = replaceOrgContextPlaceholder('Before\n{{orgContext}}\nAfter', 'Org line');
  assert.equal(out, 'Before\nOrg line\nAfter');
});
