const pages = require('../pages.json');

const ASSISTANT_STEP_KEYS = new Set(pages.map((p) => p.link));
const COMPLETE_ASSESSMENT = 'completeAssessment';

function isAllowedAssistantMessageId(messageId) {
  if (typeof messageId !== 'string' || !messageId) {
    return false;
  }
  if (messageId === COMPLETE_ASSESSMENT) {
    return true;
  }
  return ASSISTANT_STEP_KEYS.has(messageId);
}

function assertAllowedAssistantMessageId(messageId) {
  if (!isAllowedAssistantMessageId(messageId)) {
    const err = new Error('Invalid messageId');
    err.status = 400;
    throw err;
  }
}

module.exports = {
  ASSISTANT_STEP_KEYS,
  COMPLETE_ASSESSMENT,
  isAllowedAssistantMessageId,
  assertAllowedAssistantMessageId,
};
