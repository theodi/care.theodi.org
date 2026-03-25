/**
 * Per-stage extra prompt text for organisation members using AI on scan steps.
 * Stage ids match messageTemplates / assistant :messageId.
 */

const SCAN_CONTEXT_STAGE_KEYS = [
  'completeAssessment',
  'intendedConsequences',
  'unintendedConsequences',
  'stakeholders',
];

const SCAN_CONTEXT_STAGE_LABELS = {
  completeAssessment: 'Complete scan (initial assessment)',
  intendedConsequences: 'Intended consequences',
  unintendedConsequences: 'Unintended consequences',
  stakeholders: 'Stakeholders',
};

const MAX_STAGE_CHARS = 12000;

const ALLOWED = new Set(SCAN_CONTEXT_STAGE_KEYS);

function emptyStagesObject() {
  const o = {};
  SCAN_CONTEXT_STAGE_KEYS.forEach((k) => {
    o[k] = '';
  });
  return o;
}

function normalizeStageText(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s.length <= MAX_STAGE_CHARS) return s;
  return s.slice(0, MAX_STAGE_CHARS);
}

/**
 * @param {object} body — e.g. { stages: { completeAssessment: "..." } } or flat keys
 */
function validateAndNormalizeScanContextUpdate(body) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Expected JSON body with a "stages" object or stage keys');
    err.status = 400;
    throw err;
  }
  const src = body.stages && typeof body.stages === 'object' ? body.stages : body;
  const out = {};
  for (const key of SCAN_CONTEXT_STAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (v == null) {
      out[key] = '';
      continue;
    }
    if (typeof v !== 'string') {
      const err = new Error(`Stage "${key}" must be a string`);
      err.status = 400;
      throw err;
    }
    out[key] = normalizeStageText(v);
  }
  if (Object.keys(out).length === 0) {
    const err = new Error('Provide at least one stage key in "stages"');
    err.status = 400;
    throw err;
  }
  return out;
}

function mergeScanContextIntoSubscription(existing, partialNormalized) {
  const prev = maskScanContextForClient(existing);
  const next = { ...prev };
  for (const key of SCAN_CONTEXT_STAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partialNormalized, key)) {
      next[key] = partialNormalized[key];
    }
  }
  return next;
}

function maskScanContextForClient(orgScanContext) {
  const base = emptyStagesObject();
  if (!orgScanContext || typeof orgScanContext !== 'object') {
    return base;
  }
  for (const key of SCAN_CONTEXT_STAGE_KEYS) {
    const raw = orgScanContext[key];
    base[key] = typeof raw === 'string' ? raw : '';
  }
  return base;
}

/** @returns {Record<string, boolean>} */
function scanContextPresenceByStage(orgScanContext) {
  const stages = maskScanContextForClient(orgScanContext);
  const o = {};
  SCAN_CONTEXT_STAGE_KEYS.forEach((k) => {
    o[k] = !!(stages[k] && stages[k].trim());
  });
  return o;
}

function getScanContextForMessageId(orgScanContext, messageId) {
  const id = String(messageId || '');
  if (!ALLOWED.has(id)) return '';
  const stages = maskScanContextForClient(orgScanContext);
  const t = stages[id];
  return typeof t === 'string' ? t.trim() : '';
}

/** Message templates use `{{orgContext}}` where org-specific text should appear (Handlebars-style placeholder). */
const ORG_CONTEXT_PLACEHOLDER = /\{\{orgContext\}\}/g;

function replaceOrgContextPlaceholder(template, contextText) {
  const base = typeof template === 'string' ? template : '';
  const t = typeof contextText === 'string' ? contextText.trim() : '';
  return base.replace(ORG_CONTEXT_PLACEHOLDER, t);
}

module.exports = {
  SCAN_CONTEXT_STAGE_KEYS,
  SCAN_CONTEXT_STAGE_LABELS,
  MAX_STAGE_CHARS,
  emptyStagesObject,
  validateAndNormalizeScanContextUpdate,
  mergeScanContextIntoSubscription,
  maskScanContextForClient,
  scanContextPresenceByStage,
  getScanContextForMessageId,
  replaceOrgContextPlaceholder,
};
