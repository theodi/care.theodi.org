const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAndNormalizeGuidanceItems,
  resolveGuidanceItems,
  scanContextPresenceByStageForSubscription,
  humanGuidancePresenceByStageForSubscription,
  getScanContextTextForSubscription,
  getHumanGuidanceHtmlForSubscription,
  uncoveredScanStages,
  uncoveredHumanGuidanceStages,
  migrateLegacyScanContextToItems,
  MAX_GUIDANCE_CONTENT_CHARS,
  replaceOrgContextPlaceholder,
  SCAN_CONTEXT_STAGE_KEYS,
  SCAN_CONTEXT_AI_STAGE_KEYS,
  SCAN_CONTEXT_HUMAN_STAGE_KEYS,
} = require('../lib/organisationScanContext');
const { sanitizeGuidanceHtml } = require('../lib/sanitizeGuidanceHtml');

test('validateAndNormalizeGuidanceItems accepts AI items', () => {
  const out = validateAndNormalizeGuidanceItems({
    items: [
      {
        title: '  T  ',
        content: '  body  ',
        stages: ['completeAssessment', 'stakeholders'],
        useForAi: true,
        useForHuman: false,
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'T');
  assert.equal(out[0].content, 'body');
  assert.equal(out[0].useForAi, true);
  assert.equal(out[0].useForHuman, false);
  assert.deepEqual(out[0].stages, ['completeAssessment', 'stakeholders']);
});

test('validateAndNormalizeGuidanceItems accepts human-only items', () => {
  const out = validateAndNormalizeGuidanceItems({
    items: [
      {
        title: 'Help',
        humanContent: '<p>Hello <a href="https://example.com">link</a></p>',
        stages: ['projectDetails'],
        useForAi: false,
        useForHuman: true,
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].content, '');
  assert.match(out[0].humanContent, /Hello/);
  assert.match(out[0].humanContent, /example\.com/);
});

test('validateAndNormalizeGuidanceItems rejects missing stages', () => {
  assert.throws(
    () => validateAndNormalizeGuidanceItems({ items: [{ title: 'a', content: 'b', stages: [] }] }),
    /at least one scan step/
  );
});

test('validateAndNormalizeGuidanceItems rejects empty AI content', () => {
  assert.throws(
    () =>
      validateAndNormalizeGuidanceItems({
        items: [{ title: 'a', content: '   ', stages: ['actionPlanning'], useForAi: true }],
      }),
    /AI guidance text is required/
  );
});

test('validateAndNormalizeGuidanceItems rejects empty human content', () => {
  assert.throws(
    () =>
      validateAndNormalizeGuidanceItems({
        items: [
          {
            title: 'a',
            humanContent: '   ',
            stages: ['projectDetails'],
            useForAi: false,
            useForHuman: true,
          },
        ],
      }),
    /Step guidance content is required/
  );
});

test('validateAndNormalizeGuidanceItems rejects no audience', () => {
  assert.throws(
    () =>
      validateAndNormalizeGuidanceItems({
        items: [
          {
            title: 'a',
            content: 'x',
            stages: ['actionPlanning'],
            useForAi: false,
            useForHuman: false,
          },
        ],
      }),
    /at least one audience/
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
  assert.equal(items[0].useForAi, true);
  assert.equal(items[0].useForHuman, false);
  assert.deepEqual(items[0].stages, ['completeAssessment']);
});

test('scanContextPresenceByStageForSubscription only counts AI audience', () => {
  const sub = {
    organisationScanGuidanceItems: [
      { title: '', content: 'x', stages: ['riskEvaluation'] },
      {
        title: '',
        content: '',
        humanContent: '<p>human</p>',
        useForAi: false,
        useForHuman: true,
        stages: ['actionPlanning'],
      },
    ],
  };
  const p = scanContextPresenceByStageForSubscription(sub);
  assert.equal(p.riskEvaluation, true);
  assert.equal(p.actionPlanning, false);
});

test('humanGuidancePresenceByStageForSubscription counts human audience', () => {
  const sub = {
    organisationScanGuidanceItems: [
      {
        title: 'Org',
        content: '',
        humanContent: '<p>Policy</p>',
        useForAi: false,
        useForHuman: true,
        stages: ['stakeholders'],
      },
    ],
  };
  const p = humanGuidancePresenceByStageForSubscription(sub);
  assert.equal(p.stakeholders, true);
  assert.equal(p.projectDetails, false);
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

test('getHumanGuidanceHtmlForSubscription uses org blocks instead of CARE default', () => {
  const sub = {
    organisationScanGuidanceItems: [
      {
        title: 'Our policy',
        content: '',
        humanContent: '<p>Extra detail</p>',
        useForAi: false,
        useForHuman: true,
        stages: ['intendedConsequences'],
      },
    ],
  };
  const html = getHumanGuidanceHtmlForSubscription(sub, 'intendedConsequences');
  assert.doesNotMatch(html, /care-step-help-default/);
  assert.doesNotMatch(html, /Start by creating a clear list of intended consequences/);
  assert.doesNotMatch(html, /Our policy/);
  assert.match(html, /Extra detail/);
});

test('getHumanGuidanceHtmlForSubscription returns CARE default without org items', () => {
  const html = getHumanGuidanceHtmlForSubscription({}, 'actionCompletion');
  assert.match(html, /Record action completion/);
});

test('uncoveredScanStages lists AI gaps', () => {
  const sub = {
    organisationScanGuidanceItems: [{ title: '', content: 'x', stages: ['completeAssessment'] }],
  };
  const u = uncoveredScanStages(sub);
  assert.ok(u.length > 0);
  assert.ok(!u.includes('completeAssessment'));
  assert.ok(u.includes('actionPlanning'));
});

test('uncoveredHumanGuidanceStages lists human gaps', () => {
  const sub = {
     organisationScanGuidanceItems: [
      {
        title: '',
        content: '',
        humanContent: '<p>x</p>',
        useForAi: false,
        useForHuman: true,
        stages: ['projectDetails'],
      },
    ],
  };
  const u = uncoveredHumanGuidanceStages(sub);
  assert.ok(!u.includes('projectDetails'));
  assert.ok(u.includes('actionCompletion'));
});

test('SCAN_CONTEXT_STAGE_KEYS includes all admin steps', () => {
  assert.equal(SCAN_CONTEXT_STAGE_KEYS.length, 8);
  assert.ok(SCAN_CONTEXT_HUMAN_STAGE_KEYS.includes('projectDetails'));
  assert.ok(SCAN_CONTEXT_AI_STAGE_KEYS.includes('completeAssessment'));
});

test('migrateLegacyScanContextToItems maps riskEvaluation', () => {
  const items = migrateLegacyScanContextToItems({ riskEvaluation: 'r', actionPlanning: 'a' });
  assert.equal(items.length, 2);
});

test('replaceOrgContextPlaceholder substitutes {{orgContext}}', () => {
  const out = replaceOrgContextPlaceholder('Before\n{{orgContext}}\nAfter', 'Org line');
  assert.equal(out, 'Before\nOrg line\nAfter');
});

test('sanitizeGuidanceHtml strips scripts and keeps links', () => {
  const out = sanitizeGuidanceHtml(
    '<p>Hi</p><script>alert(1)</script><a href="https://example.com">x</a>'
  );
  assert.match(out, /Hi/);
  assert.doesNotMatch(out, /script/);
  assert.match(out, /example\.com/);
});
