/**
 * AI interaction provenance: build records and persist append-only history on Project.
 */

const { loadConfig } = require('../services/aiChat');
const Project = require('../models/project');

const MAX_AI_HISTORY_RUNS = 200;

/**
 * @param {object} cfg — merged runtime config (may include apiKey)
 * @returns {object}
 */
function sanitizeModelConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    return {};
  }
  const {
    apiKey: _omit,
    streamObserver: _so,
    structuredResponse: _sr,
    ...rest
  } = cfg;
  const out = { ...rest };
  delete out.apiKey;
  return out;
}

/**
 * Effective config as sent to chatCompletion (env + org overrides).
 * @param {Record<string, unknown>} orgOverrides
 */
function getEffectiveModelConfig(orgOverrides) {
  const base = loadConfig();
  return { ...base, ...(orgOverrides && typeof orgOverrides === 'object' ? orgOverrides : {}) };
}

/**
 * @param {string} raw
 */
function aiSourceFromQuery(raw) {
  const src = String(raw || '')
    .toLowerCase()
    .replace(/-/g, '_');
  if (src === 'built_in' || src === 'builtin' || src === 'default_env') {
    return 'built_in';
  }
  return 'organisation';
}

/**
 * @param {string} stepId
 * @param {object} normalized — output of normalizeParsedResponseForStep
 * @returns {unknown[]}
 */
function suggestionsArrayFromStepResult(stepId, normalized) {
  if (!normalized || typeof normalized !== 'object') {
    return [];
  }
  if (stepId === 'intendedConsequences') {
    return Array.isArray(normalized.intendedConsequences) ? normalized.intendedConsequences : [];
  }
  if (stepId === 'unintendedConsequences') {
    return Array.isArray(normalized.unintendedConsequences)
      ? normalized.unintendedConsequences
      : [];
  }
  if (stepId === 'stakeholders') {
    return Array.isArray(normalized.stakeholders) ? normalized.stakeholders : [];
  }
  if (stepId === 'riskEvaluation' || stepId === 'actionPlanning') {
    return Array.isArray(normalized.unintendedConsequences)
      ? normalized.unintendedConsequences
      : [];
  }
  return [];
}

/**
 * @param {object} opts
 */
function buildAiInteractionRecord(opts) {
  const {
    runId,
    projectId,
    stepId,
    pipelineRunId,
    startedAt,
    completedAt,
    aiSource,
    model,
    includeExistingStepData,
    includeOrganisationContext,
    promptFull,
    rawResponseText,
    normalizedResult,
    reasoning,
    status,
    error,
  } = opts;

  const suggestions = suggestionsArrayFromStepResult(stepId, normalizedResult);

  return {
    runId: String(runId),
    projectId: projectId != null ? String(projectId) : undefined,
    stepId: String(stepId),
    pipelineRunId: pipelineRunId != null ? String(pipelineRunId) : undefined,
    startedAt: startedAt || new Date().toISOString(),
    completedAt: completedAt || new Date().toISOString(),
    aiSource: aiSource === 'built_in' ? 'built_in' : 'organisation',
    model: model && typeof model === 'object' ? model : {},
    includeExistingStepData: !!includeExistingStepData,
    includeOrganisationContext: !!includeOrganisationContext,
    promptFull: typeof promptFull === 'string' ? promptFull : '',
    rawResponseText: typeof rawResponseText === 'string' ? rawResponseText : '',
    normalizedResult:
      normalizedResult && typeof normalizedResult === 'object' ? normalizedResult : {},
    suggestions,
    reasoning: typeof reasoning === 'string' ? reasoning : '',
    status: status === 'failed' ? 'failed' : 'completed',
    error: error != null ? String(error) : undefined,
    selections: [],
  };
}

/**
 * @param {string} projectId
 * @param {ReturnType<typeof buildAiInteractionRecord>} record
 */
async function appendAiInteractionRun(projectId, record) {
  const doc = { ...record };
  delete doc.projectId;
  await Project.findByIdAndUpdate(
    projectId,
    {
      $push: {
        aiInteractionHistory: {
          $each: [doc],
          $slice: -MAX_AI_HISTORY_RUNS,
        },
      },
    },
    { new: false }
  );
}

/**
 * @param {string} projectId
 * @param {string} runId
 * @param {{ indices: number[], items: unknown[] }} body
 */
async function appendSelectionToRun(projectId, runId, body) {
  const indices = Array.isArray(body.indices) ? body.indices.map((n) => Number(n)) : [];
  const items = Array.isArray(body.items) ? body.items : [];
  const appliedAt = new Date().toISOString();

  const project = await Project.findById(projectId).lean();
  if (!project) {
    return { ok: false, code: 404, message: 'Project not found' };
  }
  const history = project.aiInteractionHistory || [];
  const entry = history.find((h) => h && String(h.runId) === String(runId));
  if (!entry) {
    return { ok: false, code: 404, message: 'AI run not found' };
  }
  const maxIdx = (entry.suggestions || []).length - 1;
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i > maxIdx) {
      return { ok: false, code: 400, message: `Invalid suggestion index: ${i}` };
    }
  }

  await Project.updateOne(
    { _id: projectId, aiInteractionHistory: { $elemMatch: { runId: String(runId) } } },
    {
      $push: {
        'aiInteractionHistory.$.selections': {
          appliedAt,
          indices,
          items,
        },
      },
    }
  );

  return { ok: true, appliedAt, indices, items };
}

module.exports = {
  sanitizeModelConfig,
  getEffectiveModelConfig,
  aiSourceFromQuery,
  suggestionsArrayFromStepResult,
  buildAiInteractionRecord,
  appendAiInteractionRun,
  appendSelectionToRun,
  MAX_AI_HISTORY_RUNS,
};
