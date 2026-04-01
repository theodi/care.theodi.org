/**
 * Organisation scan guidance: titled blocks applied to one or more AI-assisted steps.
 * Stage ids match messageTemplates / assistant :messageId.
 */

const SCAN_CONTEXT_STAGE_KEYS = [
  'completeAssessment',
  'intendedConsequences',
  'unintendedConsequences',
  'stakeholders',
  'riskEvaluation',
  'actionPlanning',
];

const SCAN_CONTEXT_STAGE_LABELS = {
  completeAssessment: 'Complete scan (initial assessment)',
  intendedConsequences: 'Intended consequences',
  unintendedConsequences: 'Unintended consequences',
  stakeholders: 'Stakeholders',
  riskEvaluation: 'Risk evaluation',
  actionPlanning: 'Action planning',
};

const MAX_GUIDANCE_CONTENT_CHARS = 12000;
const MAX_GUIDANCE_TITLE_CHARS = 200;

const ALLOWED = new Set(SCAN_CONTEXT_STAGE_KEYS);

const ORG_CONTEXT_PLACEHOLDER = /\{\{orgContext\}\}/g;

function normalizeTitle(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s.length <= MAX_GUIDANCE_TITLE_CHARS) return s;
  return s.slice(0, MAX_GUIDANCE_TITLE_CHARS);
}

function normalizeContent(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s.length <= MAX_GUIDANCE_CONTENT_CHARS) return s;
  return s.slice(0, MAX_GUIDANCE_CONTENT_CHARS);
}

function migrateLegacyScanContextToItems(orgScanContext) {
  const items = [];
  if (!orgScanContext || typeof orgScanContext !== 'object') return items;
  for (const key of SCAN_CONTEXT_STAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(orgScanContext, key)) continue;
    const text = orgScanContext[key];
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) continue;
    items.push({
      title: SCAN_CONTEXT_STAGE_LABELS[key] || key,
      content: t,
      stages: [key],
    });
  }
  return items;
}

/**
 * Normalised items for editor + prompts (legacy flat organisationScanContext merged in when items absent).
 * @param {object|null|undefined} sub — OrganisationSubscription lean doc or model
 * @returns {Array<{ title: string, content: string, stages: string[] }>}
 */
function resolveGuidanceItems(sub) {
  const arr = sub && sub.organisationScanGuidanceItems;
  if (Array.isArray(arr) && arr.length > 0) {
    return normalizeGuidanceItemsArray(arr, { dropEmptyContent: true });
  }
  return migrateLegacyScanContextToItems(sub && sub.organisationScanContext);
}

/**
 * @param {Array<unknown>} rawItems
 * @param {{ dropEmptyContent?: boolean }} opts
 */
function normalizeGuidanceItemsArray(rawItems, opts) {
  const dropEmpty = !!(opts && opts.dropEmptyContent);
  const out = [];
  if (!Array.isArray(rawItems)) return out;
  for (const row of rawItems) {
    if (!row || typeof row !== 'object') continue;
    const title = normalizeTitle(row.title);
    const content = normalizeContent(row.content);
    if (dropEmpty && !content) continue;
    const stagesIn = Array.isArray(row.stages) ? row.stages : [];
    const stages = [];
    const seen = new Set();
    for (const s of stagesIn) {
      const id = String(s || '').trim();
      if (!ALLOWED.has(id) || seen.has(id)) continue;
      seen.add(id);
      stages.push(id);
    }
    if (dropEmpty && stages.length === 0) continue;
    out.push({ title, content, stages });
  }
  return out;
}

/**
 * @param {object} body — { items: [...] }
 * @returns {Array<{ title: string, content: string, stages: string[] }>}
 */
function validateAndNormalizeGuidanceItems(body) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Expected JSON body with an "items" array');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(body.items)) {
    const err = new Error('Body must include an "items" array');
    err.status = 400;
    throw err;
  }
  const out = [];
  let i = 0;
  for (const row of body.items) {
    if (!row || typeof row !== 'object') {
      const err = new Error(`items[${i}] must be an object`);
      err.status = 400;
      throw err;
    }
    const title = normalizeTitle(row.title);
    const content = normalizeContent(row.content);
    const stagesIn = Array.isArray(row.stages) ? row.stages : null;
    if (!stagesIn || stagesIn.length === 0) {
      const err = new Error(`items[${i}]: select at least one scan step`);
      err.status = 400;
      throw err;
    }
    const stages = [];
    const seen = new Set();
    for (const s of stagesIn) {
      const id = String(s || '').trim();
      if (!ALLOWED.has(id)) {
        const err = new Error(`items[${i}]: unknown scan step "${id}"`);
        err.status = 400;
        throw err;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stages.push(id);
    }
    if (stages.length === 0) {
      const err = new Error(`items[${i}]: select at least one scan step`);
      err.status = 400;
      throw err;
    }
    if (!content) {
      const err = new Error(`items[${i}]: guidance text is required`);
      err.status = 400;
      throw err;
    }
    out.push({ title, content, stages });
    i += 1;
  }
  return out;
}

/** Stages that have at least one non-empty guidance block applied. */
function scanContextPresenceByStageForSubscription(sub) {
  const items = resolveGuidanceItems(sub);
  const o = {};
  SCAN_CONTEXT_STAGE_KEYS.forEach((k) => {
    o[k] = false;
  });
  for (const it of items) {
    const content = normalizeContent(it.content);
    if (!content) continue;
    for (const s of it.stages || []) {
      if (ALLOWED.has(s)) o[s] = true;
    }
  }
  return o;
}

/**
 * Plain text appended for {{orgContext}} for this messageId (all matching blocks, in order).
 */
function getScanContextTextForSubscription(sub, messageId) {
  const id = String(messageId || '').trim();
  if (!ALLOWED.has(id)) return '';
  const items = resolveGuidanceItems(sub);
  const parts = [];
  for (const it of items) {
    const stages = Array.isArray(it.stages) ? it.stages : [];
    if (!stages.includes(id)) continue;
    const content = normalizeContent(it.content);
    if (!content) continue;
    const title = normalizeTitle(it.title);
    if (title) parts.push(`${title}\n\n${content}`);
    else parts.push(content);
  }
  return parts.join('\n\n').trim();
}

/** @returns {string[]} stage ids with no guidance */
function uncoveredScanStages(sub) {
  const presence = scanContextPresenceByStageForSubscription(sub);
  return SCAN_CONTEXT_STAGE_KEYS.filter((k) => !presence[k]);
}

function replaceOrgContextPlaceholder(template, contextText) {
  const base = typeof template === 'string' ? template : '';
  const t = typeof contextText === 'string' ? contextText.trim() : '';
  return base.replace(ORG_CONTEXT_PLACEHOLDER, t);
}

module.exports = {
  SCAN_CONTEXT_STAGE_KEYS,
  SCAN_CONTEXT_STAGE_LABELS,
  MAX_GUIDANCE_CONTENT_CHARS,
  MAX_GUIDANCE_TITLE_CHARS,
  /** @deprecated use MAX_GUIDANCE_CONTENT_CHARS */
  MAX_STAGE_CHARS: MAX_GUIDANCE_CONTENT_CHARS,
  ALLOWED_STAGE_IDS: ALLOWED,
  resolveGuidanceItems,
  validateAndNormalizeGuidanceItems,
  normalizeGuidanceItemsArray,
  migrateLegacyScanContextToItems,
  scanContextPresenceByStageForSubscription,
  uncoveredScanStages,
  getScanContextTextForSubscription,
  replaceOrgContextPlaceholder,
  ORG_CONTEXT_PLACEHOLDER,
};
