/**
 * Organisation scan guidance: titled blocks applied to AI prompts and/or human Step guidance.
 * Stage ids match messageTemplates / assistant :messageId where applicable.
 */

const { sanitizeGuidanceHtml } = require('./sanitizeGuidanceHtml');
const { getCareStepHelpDefault } = require('./careStepHelpDefaults');

const SCAN_CONTEXT_AI_STAGE_KEYS = [
  'completeAssessment',
  'intendedConsequences',
  'unintendedConsequences',
  'stakeholders',
  'riskEvaluation',
  'actionPlanning',
];

const SCAN_CONTEXT_HUMAN_STAGE_KEYS = [
  'projectDetails',
  'intendedConsequences',
  'unintendedConsequences',
  'stakeholders',
  'riskEvaluation',
  'actionPlanning',
  'actionCompletion',
];

/** Ordered union for admin UI and validation. */
const SCAN_CONTEXT_STAGE_KEYS = [
  'projectDetails',
  'completeAssessment',
  'intendedConsequences',
  'unintendedConsequences',
  'stakeholders',
  'riskEvaluation',
  'actionPlanning',
  'actionCompletion',
];

const SCAN_CONTEXT_STAGE_LABELS = {
  projectDetails: 'Project details',
  completeAssessment: 'Complete scan (initial assessment)',
  intendedConsequences: 'Intended consequences',
  unintendedConsequences: 'Unintended consequences',
  stakeholders: 'Stakeholders',
  riskEvaluation: 'Risk evaluation',
  actionPlanning: 'Action planning',
  actionCompletion: 'Action completion',
};

const MAX_GUIDANCE_CONTENT_CHARS = 12000;
const MAX_GUIDANCE_TITLE_CHARS = 200;

const ALLOWED = new Set(SCAN_CONTEXT_STAGE_KEYS);
const ALLOWED_AI = new Set(SCAN_CONTEXT_AI_STAGE_KEYS);
const ALLOWED_HUMAN = new Set(SCAN_CONTEXT_HUMAN_STAGE_KEYS);

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

function normalizeHumanContent(raw) {
  const sanitized = sanitizeGuidanceHtml(raw);
  if (sanitized.length <= MAX_GUIDANCE_CONTENT_CHARS) return sanitized;
  return sanitized.slice(0, MAX_GUIDANCE_CONTENT_CHARS);
}

function normalizeAudiences(row) {
  const useForAi = row.useForAi !== false;
  const useForHuman = !!row.useForHuman;
  return { useForAi, useForHuman };
}

function itemHasAiContent(it) {
  return !!(it && it.useForAi !== false && normalizeContent(it.content));
}

function itemHasHumanContent(it) {
  return !!(it && it.useForHuman && normalizeHumanContent(it.humanContent));
}

function migrateLegacyScanContextToItems(orgScanContext) {
  const items = [];
  if (!orgScanContext || typeof orgScanContext !== 'object') return items;
  for (const key of SCAN_CONTEXT_AI_STAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(orgScanContext, key)) continue;
    const text = orgScanContext[key];
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) continue;
    items.push({
      title: SCAN_CONTEXT_STAGE_LABELS[key] || key,
      content: t,
      humanContent: '',
      useForAi: true,
      useForHuman: false,
      stages: [key],
    });
  }
  return items;
}

function normalizeGuidanceRow(row, opts) {
  const dropEmpty = !!(opts && opts.dropEmptyContent);
  if (!row || typeof row !== 'object') return null;

  const title = normalizeTitle(row.title);
  const { useForAi, useForHuman } = normalizeAudiences(row);
  const content = useForAi ? normalizeContent(row.content) : '';
  const humanContent = useForHuman ? normalizeHumanContent(row.humanContent) : '';

  if (!useForAi && !useForHuman) {
    if (dropEmpty) return null;
  }
  if (useForAi && !content && dropEmpty && !useForHuman) return null;
  if (useForHuman && !humanContent && dropEmpty && !useForAi) return null;
  if (dropEmpty && !content && !humanContent) return null;

  const stagesIn = Array.isArray(row.stages) ? row.stages : [];
  const stages = [];
  const seen = new Set();
  for (const s of stagesIn) {
    const id = String(s || '').trim();
    if (!ALLOWED.has(id) || seen.has(id)) continue;
    seen.add(id);
    stages.push(id);
  }
  if (dropEmpty && stages.length === 0) return null;

  return {
    title,
    content,
    humanContent,
    useForAi,
    useForHuman,
    stages,
  };
}

/**
 * Normalised items for editor + prompts (legacy flat organisationScanContext merged in when items absent).
 * @param {object|null|undefined} sub — OrganisationSubscription lean doc or model
 * @returns {Array<{ title: string, content: string, humanContent: string, useForAi: boolean, useForHuman: boolean, stages: string[] }>}
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
  const out = [];
  if (!Array.isArray(rawItems)) return out;
  for (const row of rawItems) {
    const normalized = normalizeGuidanceRow(row, opts);
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * @param {object} body — { items: [...] }
 * @returns {Array<{ title: string, content: string, humanContent: string, useForAi: boolean, useForHuman: boolean, stages: string[] }>}
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
    const { useForAi, useForHuman } = normalizeAudiences(row);
    if (!useForAi && !useForHuman) {
      const err = new Error(`items[${i}]: select at least one audience (AI assistant or Step guidance)`);
      err.status = 400;
      throw err;
    }
    const content = useForAi ? normalizeContent(row.content) : '';
    const humanContent = useForHuman ? normalizeHumanContent(row.humanContent) : '';
    if (useForAi && !content) {
      const err = new Error(`items[${i}]: AI guidance text is required when "AI assistant" is selected`);
      err.status = 400;
      throw err;
    }
    if (useForHuman && !humanContent) {
      const err = new Error(`items[${i}]: Step guidance content is required when "Step guidance" is selected`);
      err.status = 400;
      throw err;
    }
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
    out.push({ title, content, humanContent, useForAi, useForHuman, stages });
    i += 1;
  }
  return out;
}

/** AI stages that have at least one guidance block for the assistant. */
function scanContextPresenceByStageForSubscription(sub) {
  const items = resolveGuidanceItems(sub);
  const o = {};
  SCAN_CONTEXT_AI_STAGE_KEYS.forEach((k) => {
    o[k] = false;
  });
  for (const it of items) {
    if (!itemHasAiContent(it)) continue;
    for (const s of it.stages || []) {
      if (ALLOWED_AI.has(s)) o[s] = true;
    }
  }
  return o;
}

/** Human step guidance stages with at least one org block. */
function humanGuidancePresenceByStageForSubscription(sub) {
  const items = resolveGuidanceItems(sub);
  const o = {};
  SCAN_CONTEXT_HUMAN_STAGE_KEYS.forEach((k) => {
    o[k] = false;
  });
  for (const it of items) {
    if (!itemHasHumanContent(it)) continue;
    for (const s of it.stages || []) {
      if (ALLOWED_HUMAN.has(s)) o[s] = true;
    }
  }
  return o;
}

/**
 * Plain text appended for {{orgContext}} for this messageId (all matching blocks, in order).
 */
function getScanContextTextForSubscription(sub, messageId) {
  const id = String(messageId || '').trim();
  if (!ALLOWED_AI.has(id)) return '';
  const items = resolveGuidanceItems(sub);
  const parts = [];
  for (const it of items) {
    if (!itemHasAiContent(it)) continue;
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

/**
 * Composed HTML for the Step guidance modal.
 * Org human guidance replaces the CARE default when any org block applies to the step.
 * @param {object|null|undefined} sub
 * @param {string} stepId
 * @returns {string}
 */
function getHumanGuidanceHtmlForSubscription(sub, stepId) {
  const id = String(stepId || '').trim();
  if (!ALLOWED_HUMAN.has(id)) return '';

  const defaultHtml = getCareStepHelpDefault(id);
  const items = resolveGuidanceItems(sub);
  const orgParts = [];
  for (const it of items) {
    if (!itemHasHumanContent(it)) continue;
    const stages = Array.isArray(it.stages) ? it.stages : [];
    if (!stages.includes(id)) continue;
    const humanContent = normalizeHumanContent(it.humanContent);
    if (!humanContent) continue;
    orgParts.push(`<div class="care-step-help-org-block">${humanContent}</div>`);
  }

  if (!defaultHtml && orgParts.length === 0) return '';

  let html = '<div class="infobox care-step-help-body">';
  if (orgParts.length === 0 && defaultHtml) {
    html += `<div class="care-step-help-default">${defaultHtml}</div>`;
  }
  for (const part of orgParts) html += part;
  html += '</div>';
  return html;
}

/** @returns {string[]} AI stage ids with no guidance */
function uncoveredScanStages(sub) {
  const presence = scanContextPresenceByStageForSubscription(sub);
  return SCAN_CONTEXT_AI_STAGE_KEYS.filter((k) => !presence[k]);
}

/** @returns {string[]} human step ids with no org guidance (CARE default may still apply). */
function uncoveredHumanGuidanceStages(sub) {
  const presence = humanGuidancePresenceByStageForSubscription(sub);
  return SCAN_CONTEXT_HUMAN_STAGE_KEYS.filter((k) => !presence[k]);
}

function replaceOrgContextPlaceholder(template, contextText) {
  const base = typeof template === 'string' ? template : '';
  const t = typeof contextText === 'string' ? contextText.trim() : '';
  return base.replace(ORG_CONTEXT_PLACEHOLDER, t);
}

module.exports = {
  SCAN_CONTEXT_AI_STAGE_KEYS,
  SCAN_CONTEXT_HUMAN_STAGE_KEYS,
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
  humanGuidancePresenceByStageForSubscription,
  uncoveredScanStages,
  uncoveredHumanGuidanceStages,
  getScanContextTextForSubscription,
  getHumanGuidanceHtmlForSubscription,
  replaceOrgContextPlaceholder,
  ORG_CONTEXT_PLACEHOLDER,
};
