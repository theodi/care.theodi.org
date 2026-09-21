const test = require('node:test');
const assert = require('node:assert/strict');
const {
  completionStateFromUnintendedConsequences,
  unintendedConsequenceItemCompleteForStage,
} = require('../controllers/project');

const baseItem = {
  consequence: 'Something happens',
  outcome: 'Negative',
  impact: '',
  likelihood: '',
  role: '',
  action: {},
};

test('unintended consequences step: only consequence and outcome required', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('unintendedConsequences', {
      ...baseItem,
      impact: '',
      likelihood: '',
    }),
    true
  );
});

test('risk evaluation: negative requires impact and likelihood', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('riskEvaluation', {
      ...baseItem,
      impact: 'High',
      likelihood: 'Low',
    }),
    true
  );
  assert.equal(
    unintendedConsequenceItemCompleteForStage('riskEvaluation', {
      ...baseItem,
      impact: '',
      likelihood: 'Low',
    }),
    false
  );
});

test('risk evaluation: positive outcomes skip impact (hidden rows)', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('riskEvaluation', {
      ...baseItem,
      outcome: 'Positive',
      impact: '',
      likelihood: '',
    }),
    true
  );
});

test('completionStateFromUnintendedConsequences returns done when all items match stage', () => {
  const items = [
    { consequence: 'A', outcome: 'Positive',
      impact: '', likelihood: '' },
    { consequence: 'B', outcome: 'Negative',
      impact: 'High', likelihood: 'Medium' },
  ];
  assert.equal(completionStateFromUnintendedConsequences(items, 'riskEvaluation'), 'done');
});

test('action completion: planned action requires completion state', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('actionCompletion', {
      ...baseItem,
      impact: 'High',
      likelihood: 'Low',
      role: 'Act',
      action: {
        description: 'Do the thing',
        stakeholder: 'Owner',
        date: '2026-04-16',
        KPI: 'Metric',
        completed: '',
      },
    }),
    false
  );
});

test('action completion: completed action requires a completion comment', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('actionCompletion', {
      ...baseItem,
      impact: 'High',
      likelihood: 'Low',
      role: 'Act',
      action: {
        description: 'Do the thing',
        stakeholder: 'Owner',
        date: '2026-04-16',
        KPI: 'Metric',
        completed: 'Completed',
        completionComment: '',
      },
    }),
    false
  );
  assert.equal(
    unintendedConsequenceItemCompleteForStage('actionCompletion', {
      ...baseItem,
      impact: 'High',
      likelihood: 'Low',
      role: 'Act',
      action: {
        description: 'Do the thing',
        stakeholder: 'Owner',
        date: '2026-04-16',
        KPI: 'Metric',
        completed: 'Completed',
        completionComment: 'Resolved and verified',
      },
    }),
    true
  );
});

test('action completion: risks without planned actions are treated as complete for that stage', () => {
  assert.equal(
    unintendedConsequenceItemCompleteForStage('actionCompletion', {
      ...baseItem,
      impact: 'High',
      likelihood: 'Low',
      role: '',
      action: {},
    }),
    true
  );
});
