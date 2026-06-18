const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedAssistantMessageId,
  assertAllowedAssistantMessageId,
} = require('../lib/assistantStepKeys');

describe('assistantStepKeys', () => {
  it('allows known scan steps and completeAssessment', () => {
    assert.equal(isAllowedAssistantMessageId('projectDetails'), true);
    assert.equal(isAllowedAssistantMessageId('completeAssessment'), true);
  });

  it('rejects traversal and empty ids', () => {
    assert.equal(isAllowedAssistantMessageId('../../../package'), false);
    assert.equal(isAllowedAssistantMessageId(''), false);
  });

  it('throws 400 for invalid message ids', () => {
    assert.throws(() => assertAllowedAssistantMessageId('../../../package'), (err) => {
      assert.equal(err.status, 400);
      return true;
    });
  });
});
