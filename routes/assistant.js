const fs = require('fs').promises;
const path = require('path');

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const User = require('../models/user');
const OrganisationSubscription = require('../models/organisationSubscription');

const { chatCompletion } = require('../services/aiChat');
const { parseModelJsonResponse } = require('../services/parseAIJson');
const { findMembershipForEmail } = require('../lib/organisationEntitlements');
const { orgAiToRuntimeOverrides } = require('../lib/organisationAiConfig');
const {
  getScanContextTextForSubscription,
  replaceOrgContextPlaceholder,
} = require('../lib/organisationScanContext');

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');
const {
    buildAiInteractionRecord,
    appendAiInteractionRun,
    getEffectiveModelConfig,
    sanitizeModelConfig,
    aiSourceFromQuery,
} = require('../lib/aiProvenance');

const completeAssessmentRuns = new Map();
const assistantStepRuns = new Map();
const COMPLETE_ASSESSMENT_STEP_ORDER = [
    'intendedConsequences',
    'unintendedConsequences',
    'stakeholders',
    'riskEvaluation',
    'actionPlanning',
];

// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
}

function includeExistingStepDataRequested(req) {
    const q = req.query && req.query.includeExisting;
    if (q == null || q === '') {
        // Default: include existing step data in prompts.
        return true;
    }
    const s = String(q).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

function buildExistingStepContext(messageId, projectData) {
    const sections = [];
    const existingIntended = Array.isArray(projectData.intendedConsequences)
        ? projectData.intendedConsequences
        : [];
    const existingUnintended = Array.isArray(projectData.unintendedConsequences)
        ? projectData.unintendedConsequences
        : [];
    const existingStakeholders = Array.isArray(projectData.stakeholders)
        ? projectData.stakeholders
        : [];

    if (messageId === 'intendedConsequences') {
        if (existingIntended.length > 0) {
            sections.push(
                'Existing intended consequences already recorded for this project (JSON):\n' +
                JSON.stringify(existingIntended, null, 2) +
                '\n\nWhen suggesting new intended consequences, avoid repeating or lightly rephrasing any of these. Focus on additional, distinct ideas only.'
            );
        }
    } else if (messageId === 'unintendedConsequences') {
        if (existingUnintended.length > 0) {
            sections.push(
                'Existing unintended consequences already recorded for this project (JSON):\n' +
                JSON.stringify(existingUnintended, null, 2) +
                '\n\nWhen suggesting new unintended consequences, avoid repeating or lightly rephrasing any of these. Focus on additional, distinct outcomes only.'
            );
        }
        if (existingIntended.length > 0) {
            sections.push(
                'For context, here are the existing intended consequences for this project (JSON):\n' +
                JSON.stringify(existingIntended, null, 2)
            );
        }
    } else if (messageId === 'stakeholders') {
        if (existingStakeholders.length > 0) {
            sections.push(
                'Existing stakeholders already recorded for this project (JSON):\n' +
                JSON.stringify(existingStakeholders, null, 2) +
                '\n\nWhen suggesting additional stakeholders, avoid repeating or lightly rephrasing any of these. Focus on additional, distinct stakeholders only.'
            );
        }
    }

    if (sections.length === 0) {
        return '';
    }

    return (
        '\n\n---\n\n' +
        'The following JSON shows existing data that has already been collected for this step. Do not duplicate it; only suggest new, distinct items:\n\n' +
        sections.join('\n\n') +
        '\n'
    );
}

function appendExistingStepContext(message, messageId, projectData, includeExisting) {
    if (!includeExisting || !projectData || !messageId) {
        return message;
    }
    const extra = buildExistingStepContext(messageId, projectData);
    if (!extra) {
        return message;
    }
    return `${message}\n\n${extra}`;
}

function normalizeParsedResponseForStep(messageId, parsedResponse) {
    const payload = parsedResponse && typeof parsedResponse === 'object' ? parsedResponse : {};
    if (messageId === 'intendedConsequences') {
        const src = Array.isArray(payload.intendedConsequences) ? payload.intendedConsequences : [];
        return {
            intendedConsequences: src
                .map((item) => (item && typeof item === 'object' ? item.consequence : item))
                .filter((v) => typeof v === 'string' && v.trim() !== '')
                .map((consequence) => ({ consequence: consequence.trim() })),
        };
    }
    if (messageId === 'unintendedConsequences') {
        const src = Array.isArray(payload.unintendedConsequences) ? payload.unintendedConsequences : [];
        return {
            unintendedConsequences: src
                .map((item) => (item && typeof item === 'object' ? item.consequence : item))
                .filter((v) => typeof v === 'string' && v.trim() !== '')
                .map((consequence) => ({ consequence: consequence.trim() })),
        };
    }
    if (messageId === 'stakeholders') {
        const src = Array.isArray(payload.stakeholders) ? payload.stakeholders : [];
        return {
            stakeholders: src
                .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const stakeholder = typeof item.stakeholder === 'string' ? item.stakeholder.trim() : '';
                    const type = typeof item.type === 'string' ? item.type.trim() : '';
                    if (!stakeholder) return null;
                    return { stakeholder, type };
                })
                .filter(Boolean),
        };
    }
    return payload;
}

router.get('/:id/:messageId', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        let projectData = res.locals.project;
        const messageId = req.params.messageId;
        // Get the merge query parameter from the URL
        const merge = req.query.merge === 'true'; // Convert to boolean

        if (messageId === "completeAssessment") {
            const summary = await runCompleteAssessmentPipeline(req, projectData, merge);
            return res.json(summary);
        }

        const schema = require('../public/data/schemas/partials/'+messageId+'.json');
        projectData.schema = JSON.stringify(schema);
        const includeExisting = includeExistingStepDataRequested(req);
        const baseMessage = await populateMessage(messageId, projectData);
        const message = appendExistingStepContext(baseMessage, messageId, projectData, includeExisting);
        const orgContext = await resolveOrganisationScanContextAppend(req, messageId);
        const userPrompt = replaceOrgContextPlaceholder(message, orgContext);
        const orgOverrides = await resolveOrganisationAiOverrides(req);
        const response = await getAIReponse(userPrompt, messageId, schema, orgOverrides);
        const parsedResponse = normalizeParsedResponseForStep(messageId, parseModelJsonResponse(response));
        return res.json(parsedResponse);
    } catch (error) {
        console.error(error);
        // Handle errors
        res.status(500).json({ message: "Internal server error" });
    }
});

router.post('/:id/completeAssessment/start', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res) => {
    try {
        const projectData = res.locals.project;
        const merge = !(req.body && req.body.merge === false);
        const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const state = {
            runId,
            projectId: String(projectData._id),
            merge,
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            steps: COMPLETE_ASSESSMENT_STEP_ORDER.map((id) => ({ id, status: 'pending', count: null })),
            counts: {
                intendedConsequencesCount: (projectData.intendedConsequences || []).length,
                unintendedConsequencesCount: (projectData.unintendedConsequences || []).length,
                stakeholdersCount: (projectData.stakeholders || []).length,
            },
            error: null,
        };
        completeAssessmentRuns.set(runId, state);

        runCompleteAssessmentPipeline(req, projectData, merge, (progress) => {
            const current = completeAssessmentRuns.get(runId);
            if (!current) return;
            current.steps = progress.steps;
            current.counts = progress.counts;
            if (progress.error) {
                current.error = progress.error;
            }
        }, { pipelineRunId: runId })
            .then((summary) => {
                const current = completeAssessmentRuns.get(runId);
                if (!current) return;
                current.status = summary.status || 'completed';
                current.finishedAt = new Date().toISOString();
                current.steps = summary.steps;
                current.counts = {
                    intendedConsequencesCount: summary.intendedConsequencesCount,
                    unintendedConsequencesCount: summary.unintendedConsequencesCount,
                    stakeholdersCount: summary.stakeholdersCount,
                };
            })
            .catch((error) => {
                const current = completeAssessmentRuns.get(runId);
                if (!current) return;
                current.status = 'failed';
                current.finishedAt = new Date().toISOString();
                current.error = error && error.message ? error.message : 'Pipeline failed';
            });

        return res.json({
            runId,
            status: state.status,
            steps: state.steps,
            counts: state.counts,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/:id/completeAssessment/status/:runId', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res) => {
    const state = completeAssessmentRuns.get(req.params.runId);
    if (!state || state.projectId !== String(req.params.id)) {
        return res.status(404).json({ message: 'Run not found' });
    }
    return res.json({
        runId: state.runId,
        status: state.status,
        steps: state.steps,
        counts: state.counts,
        error: state.error,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
    });
});

router.post('/:id/completeAssessment/retry/:runId/:stepId', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res) => {
    try {
        const state = completeAssessmentRuns.get(req.params.runId);
        if (!state || state.projectId !== String(req.params.id)) {
            return res.status(404).json({ message: 'Run not found' });
        }
        if (state.status === 'running') {
            return res.status(409).json({ message: 'Run is already in progress' });
        }

        const stepId = req.params.stepId;
        const startIndex = COMPLETE_ASSESSMENT_STEP_ORDER.indexOf(stepId);
        if (startIndex === -1) {
            return res.status(400).json({ message: 'Invalid stepId' });
        }

        const currentSteps = Array.isArray(state.steps) && state.steps.length
            ? state.steps.map((s) => ({ ...s }))
            : COMPLETE_ASSESSMENT_STEP_ORDER.map((id) => ({ id, status: 'pending', count: null }));

        for (let i = startIndex; i < COMPLETE_ASSESSMENT_STEP_ORDER.length; i += 1) {
            const id = COMPLETE_ASSESSMENT_STEP_ORDER[i];
            const step = currentSteps.find((s) => s.id === id);
            if (step) {
                step.status = 'pending';
                step.count = null;
                delete step.error;
                delete step.thinking;
            }
        }

        state.status = 'running';
        state.error = null;
        state.finishedAt = null;
        state.steps = currentSteps;

        const projectData = res.locals.project;
        runCompleteAssessmentPipeline(
            req,
            projectData,
            state.merge !== false,
            (progress) => {
                const current = completeAssessmentRuns.get(req.params.runId);
                if (!current) return;
                current.steps = progress.steps;
                current.counts = progress.counts;
                if (progress.error) {
                    current.error = progress.error;
                }
            },
            { startIndex, progressSteps: currentSteps, pipelineRunId: req.params.runId }
        )
            .then((summary) => {
                const current = completeAssessmentRuns.get(req.params.runId);
                if (!current) return;
                current.status = summary.status || 'completed';
                current.finishedAt = new Date().toISOString();
                current.steps = summary.steps;
                current.counts = {
                    intendedConsequencesCount: summary.intendedConsequencesCount,
                    unintendedConsequencesCount: summary.unintendedConsequencesCount,
                    stakeholdersCount: summary.stakeholdersCount,
                };
            })
            .catch((error) => {
                const current = completeAssessmentRuns.get(req.params.runId);
                if (!current) return;
                current.status = 'failed';
                current.finishedAt = new Date().toISOString();
                current.error = error && error.message ? error.message : 'Retry failed';
            });

        return res.json({
            runId: state.runId,
            status: state.status,
            steps: state.steps,
            counts: state.counts,
            error: state.error,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/:id/:messageId/start', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res) => {
    try {
        const projectData = res.locals.project;
        const messageId = req.params.messageId;
        if (!messageId || messageId === 'completeAssessment') {
            return res.status(400).json({ message: 'Invalid messageId for single-step run' });
        }

        const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const state = {
            runId,
            projectId: String(projectData._id),
            messageId,
            status: 'running',
            thinking: '',
            result: null,
            error: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
        };
        assistantStepRuns.set(runId, state);

        runAssistantSingleStep(
            req,
            projectData,
            messageId,
            (delta) => {
                const current = assistantStepRuns.get(runId);
                if (!current) return;
                current.thinking += delta;
            },
            { runId, startedAt: state.startedAt }
        )
            .then((result) => {
                const current = assistantStepRuns.get(runId);
                if (!current) return;
                current.status = 'completed';
                current.result = result;
                current.finishedAt = new Date().toISOString();
            })
            .catch((error) => {
                const current = assistantStepRuns.get(runId);
                if (!current) return;
                current.status = 'failed';
                current.error = error && error.message ? error.message : 'Run failed';
                current.finishedAt = new Date().toISOString();
            });

        return res.json({
            runId: state.runId,
            status: state.status,
            messageId: state.messageId,
            thinking: state.thinking,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/:id/:messageId/status/:runId', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res) => {
    const state = assistantStepRuns.get(req.params.runId);
    if (!state || state.projectId !== String(req.params.id) || state.messageId !== req.params.messageId) {
        return res.status(404).json({ message: 'Run not found' });
    }
    return res.json({
        runId: state.runId,
        status: state.status,
        messageId: state.messageId,
        thinking: state.thinking,
        result: state.result,
        error: state.error,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
    });
});

function mergeOrOverwriteArray(existing, incoming, merge) {
    const base = Array.isArray(existing) ? existing : [];
    const add = Array.isArray(incoming) ? incoming : [];
    return merge ? [...base, ...add] : add;
}

async function applyStepResult(projectData, stepId, parsedResponse, merge) {
    if (stepId === 'intendedConsequences') {
        projectData.intendedConsequences = mergeOrOverwriteArray(
            projectData.intendedConsequences,
            parsedResponse.intendedConsequences,
            merge
        );
    } else if (stepId === 'unintendedConsequences') {
        projectData.unintendedConsequences = mergeOrOverwriteArray(
            projectData.unintendedConsequences,
            parsedResponse.unintendedConsequences,
            merge
        );
    } else if (stepId === 'stakeholders') {
        projectData.stakeholders = mergeOrOverwriteArray(
            projectData.stakeholders,
            parsedResponse.stakeholders,
            merge
        );
    } else if (stepId === 'riskEvaluation' || stepId === 'actionPlanning') {
        // These steps refine existing unintended consequences.
        projectData.unintendedConsequences = mergeOrOverwriteArray(
            projectData.unintendedConsequences,
            parsedResponse.unintendedConsequences,
            false
        );
    }

    await Project.findByIdAndUpdate(projectData._id, {
        intendedConsequences: projectData.intendedConsequences || [],
        unintendedConsequences: projectData.unintendedConsequences || [],
        stakeholders: projectData.stakeholders || [],
    });
}

function stepCountFor(stepId, latest) {
    if (stepId === 'intendedConsequences') return (latest.intendedConsequences || []).length;
    if (stepId === 'stakeholders') return (latest.stakeholders || []).length;
    return (latest.unintendedConsequences || []).length;
}

async function persistAiInteractionRecord(req, projectData, stepId, detail) {
    const {
        runId,
        pipelineRunId,
        startedAt,
        userPrompt,
        orgOverrides,
        orgContextString,
        rawResponseText,
        reasoning,
        normalizedResult,
        status,
        error,
    } = detail;
    const includeExisting = includeExistingStepDataRequested(req);
    const includeOrgCtx =
        includeOrgContextRequested(req) &&
        !!(orgContextString && String(orgContextString).trim());
    const effective = getEffectiveModelConfig(orgOverrides);
    const modelSnapshot = sanitizeModelConfig(effective);
    const aiSource = aiSourceFromQuery(req.query && req.query.aiSource);
    const record = buildAiInteractionRecord({
        runId,
        projectId: String(projectData._id),
        stepId,
        pipelineRunId,
        startedAt,
        completedAt: new Date().toISOString(),
        aiSource,
        model: modelSnapshot,
        includeExistingStepData: includeExisting,
        includeOrganisationContext: includeOrgCtx,
        promptFull: userPrompt,
        rawResponseText: rawResponseText || '',
        normalizedResult: normalizedResult && typeof normalizedResult === 'object' ? normalizedResult : {},
        reasoning: reasoning || '',
        status: status === 'failed' ? 'failed' : 'completed',
        error,
    });
    try {
        await appendAiInteractionRun(String(projectData._id), record);
    } catch (e) {
        console.error('[assistant] Failed to persist AI provenance:', e);
    }
}

async function runCompleteAssessmentPipeline(req, initialProjectData, merge = true, onProgress, options = {}) {
    const stepOrder = COMPLETE_ASSESSMENT_STEP_ORDER;
    const orgOverrides = await resolveOrganisationAiOverrides(req);
    const pipelineRunId = options.pipelineRunId || null;
    const progress = Array.isArray(options.progressSteps) && options.progressSteps.length
        ? options.progressSteps.map((s) => ({ ...s }))
        : stepOrder.map((id) => ({ id, status: 'pending', count: null }));
    const startIndex = Number.isInteger(options.startIndex) ? options.startIndex : 0;
    let projectData = initialProjectData;

    for (let i = startIndex; i < stepOrder.length; i += 1) {
        const stepId = stepOrder[i];
        let step = progress.find((s) => s.id === stepId);
        if (!step) {
            step = { id: stepId, status: 'pending', count: null };
            progress.push(step);
        }
        step.status = 'running';
        delete step.error;
        step.thinking = '';
        if (typeof onProgress === 'function') {
            onProgress({
                steps: progress.map((s) => ({ ...s })),
                counts: {
                    intendedConsequencesCount: (projectData.intendedConsequences || []).length,
                    unintendedConsequencesCount: (projectData.unintendedConsequences || []).length,
                    stakeholdersCount: (projectData.stakeholders || []).length,
                },
            });
        }
        const stepRunId = pipelineRunId ? `${pipelineRunId}:${stepId}` : `${Date.now()}_${stepId}`;
        const stepStartedAt = new Date().toISOString();
        let pipelineUserPrompt = '';
        let pipelineOrgContext = '';
        let rawResponseText = '';
        try {
            const schema = require('../public/data/schemas/partials/' + stepId + '.json');
            projectData.schema = JSON.stringify(schema);
            const includeExisting = includeExistingStepDataRequested(req);
            const baseMessage = await populateMessage(stepId, projectData);
            const message = appendExistingStepContext(baseMessage, stepId, projectData, includeExisting);
            pipelineOrgContext = await resolveOrganisationScanContextAppend(req, stepId);
            pipelineUserPrompt = replaceOrgContextPlaceholder(message, pipelineOrgContext);
            const response = await getAIReponse(
                pipelineUserPrompt,
                stepId,
                schema,
                orgOverrides,
                (evt) => {
                    if (!evt || evt.type !== 'thinking_delta' || !evt.text) return;
                    step.thinking = (step.thinking || '') + evt.text;
                    if (typeof onProgress === 'function') {
                        onProgress({
                            steps: progress.map((s) => ({ ...s })),
                            counts: {
                                intendedConsequencesCount: (projectData.intendedConsequences || []).length,
                                unintendedConsequencesCount: (projectData.unintendedConsequences || []).length,
                                stakeholdersCount: (projectData.stakeholders || []).length,
                            },
                        });
                    }
                }
            );
            rawResponseText = typeof response === 'string' ? response : '';
            const parsedResponse = normalizeParsedResponseForStep(stepId, parseModelJsonResponse(response));
            await persistAiInteractionRecord(req, projectData, stepId, {
                runId: stepRunId,
                pipelineRunId,
                startedAt: stepStartedAt,
                userPrompt: pipelineUserPrompt,
                orgOverrides,
                orgContextString: pipelineOrgContext,
                rawResponseText,
                reasoning: step.thinking || '',
                normalizedResult: parsedResponse,
                status: 'completed',
            });
            await applyStepResult(projectData, stepId, parsedResponse, merge);
            step.status = 'done';

            // Re-load to ensure next step includes fully persisted latest context.
            projectData = await Project.findById(projectData._id);
            step.count = stepCountFor(stepId, projectData);
            if (typeof onProgress === 'function') {
                onProgress({
                    steps: progress.map((s) => ({ ...s })),
                    counts: {
                        intendedConsequencesCount: (projectData.intendedConsequences || []).length,
                        unintendedConsequencesCount: (projectData.unintendedConsequences || []).length,
                        stakeholdersCount: (projectData.stakeholders || []).length,
                    },
                });
            }
        } catch (error) {
            step.status = 'failed';
            step.error = error && error.message ? error.message : 'Step failed';
            await persistAiInteractionRecord(req, projectData, stepId, {
                runId: stepRunId,
                pipelineRunId,
                startedAt: stepStartedAt,
                userPrompt: pipelineUserPrompt,
                orgOverrides,
                orgContextString: pipelineOrgContext,
                rawResponseText,
                reasoning: step.thinking || '',
                normalizedResult: {},
                status: 'failed',
                error: step.error,
            });
            if (typeof onProgress === 'function') {
                onProgress({
                    steps: progress.map((s) => ({ ...s })),
                    counts: {
                        intendedConsequencesCount: (projectData.intendedConsequences || []).length,
                        unintendedConsequencesCount: (projectData.unintendedConsequences || []).length,
                        stakeholdersCount: (projectData.stakeholders || []).length,
                    },
                    error: step.error,
                });
            }
            break;
        }
    }

    const latest = await Project.findById(initialProjectData._id);
    const intendedConsequencesCount = (latest.intendedConsequences || []).length;
    const unintendedConsequencesCount = (latest.unintendedConsequences || []).length;
    const stakeholdersCount = (latest.stakeholders || []).length;

    return {
        mode: 'pipeline',
        status: progress.some((s) => s.status === 'failed') ? 'failed' : 'completed',
        steps: progress,
        intendedConsequencesCount,
        unintendedConsequencesCount,
        stakeholdersCount,
    };
}

async function runAssistantSingleStep(req, projectData, messageId, onThinkingDelta, provenanceMeta = {}) {
    const schema = require('../public/data/schemas/partials/' + messageId + '.json');
    projectData.schema = JSON.stringify(schema);
    const includeExisting = includeExistingStepDataRequested(req);
    const baseMessage = await populateMessage(messageId, projectData);
    const message = appendExistingStepContext(baseMessage, messageId, projectData, includeExisting);
    const orgContext = await resolveOrganisationScanContextAppend(req, messageId);
    const userPrompt = replaceOrgContextPlaceholder(message, orgContext);
    const orgOverrides = await resolveOrganisationAiOverrides(req);
    let reasoning = '';
    let rawResponseText = '';
    try {
        const response = await getAIReponse(
            userPrompt,
            messageId,
            schema,
            orgOverrides,
            (evt) => {
                if (!evt || evt.type !== 'thinking_delta' || !evt.text) return;
                reasoning += evt.text;
                if (typeof onThinkingDelta === 'function') {
                    onThinkingDelta(evt.text);
                }
            }
        );
        rawResponseText = typeof response === 'string' ? response : '';
        const normalized = normalizeParsedResponseForStep(messageId, parseModelJsonResponse(response));
        await persistAiInteractionRecord(req, projectData, messageId, {
            runId: provenanceMeta.runId,
            pipelineRunId: provenanceMeta.pipelineRunId,
            startedAt: provenanceMeta.startedAt,
            userPrompt,
            orgOverrides,
            orgContextString: orgContext,
            rawResponseText,
            reasoning,
            normalizedResult: normalized,
            status: 'completed',
        });
        return normalized;
    } catch (err) {
        await persistAiInteractionRecord(req, projectData, messageId, {
            runId: provenanceMeta.runId,
            pipelineRunId: provenanceMeta.pipelineRunId,
            startedAt: provenanceMeta.startedAt,
            userPrompt,
            orgOverrides,
            orgContextString: orgContext,
            rawResponseText,
            reasoning,
            normalizedResult: {},
            status: 'failed',
            error: err && err.message ? err.message : 'Run failed',
        });
        throw err;
    }
}

async function completeAssessment(parsedResponse, projectData, merge = true) {
    // Merge the parsed data into the existing project data if merge is true
    if (merge) {
        // Merge the parsed data into the existing project data
        projectData.intendedConsequences = [
            ...(projectData.intendedConsequences || []),
            ...(parsedResponse.intendedConsequences || [])
        ];
        projectData.unintendedConsequences = [
            ...(projectData.unintendedConsequences || []),
            ...(parsedResponse.unintendedConsequences || [])
        ];
        projectData.stakeholders = [
            ...(projectData.stakeholders || []),
            ...(parsedResponse.stakeholders || [])
        ];
    } else {
        // Overwrite the existing project data with the parsed data
        projectData.intendedConsequences = parsedResponse.intendedConsequences || [];
        projectData.unintendedConsequences = parsedResponse.unintendedConsequences || [];
        projectData.stakeholders = parsedResponse.stakeholders || [];
    }
    // Save the updated project data to the database
    await Project.findByIdAndUpdate(projectData._id, projectData);

    // Calculate the counts
    const intendedConsequencesCount = projectData.intendedConsequences.length;
    const unintendedConsequencesCount = projectData.unintendedConsequences.length;
    const stakeholdersCount = projectData.stakeholders.length;

    // Return the counts as a JSON object
    return {
        intendedConsequencesCount,
        unintendedConsequencesCount,
        stakeholdersCount
    };
}

async function populateMessage(messageId, data) {
    const filePath = path.join(__dirname, '../public/data/messageTemplates/', messageId + '.txt');
    const message = await fs.readFile(filePath, 'utf8');
    if (!message) {
      console.error(`Message with ID '${messageId}' not found.`);
      return null;
    }

    let populatedText = message;

    // Convert Mongoose object to plain JavaScript object
    const plainData = data.toObject();

    // Replace placeholders with actual data
    for (const key in plainData) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        let value = plainData[key];
        if (typeof value === 'object') {
            // If the value is a JSON object, stringify it
            value = JSON.stringify(value);
        }
        populatedText = populatedText.replace(regex, value);
    }
    for (const key in data) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        populatedText = populatedText.replace(regex, data[key]);
    }

    return populatedText;
}

/**
 * When aiSource=built_in (or builtin), use only server env config.
 * Otherwise use organisation AI overrides if the user has a configured org; else env only.
 */
function includeOrgContextRequested(req) {
  const q = req.query && req.query.includeOrgContext;
  if (q == null || q === '') return false;
  const s = String(q).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

async function resolveOrganisationScanContextAppend(req, messageId) {
  if (!includeOrgContextRequested(req)) return '';
  const passportUser = req.session.passport && req.session.passport.user;
  const userId = passportUser && passportUser.id;
  if (!userId) return '';
  const user = await User.findById(userId);
  if (!user || !user.email) return '';
  const m = await findMembershipForEmail(user.email);
  if (!m || !m.subscriptionId) return '';
  const subId = m.subscriptionId._id || m.subscriptionId;
  const sub = await OrganisationSubscription.findById(subId);
  return getScanContextTextForSubscription(sub, messageId);
}

async function resolveOrganisationAiOverrides(req) {
    const raw = (req.query && req.query.aiSource) || '';
    const src = String(raw).toLowerCase().replace(/-/g, '_');
    if (src === 'built_in' || src === 'builtin' || src === 'default_env') {
        return {};
    }
    const passportUser = req.session.passport && req.session.passport.user;
    const userId = passportUser && passportUser.id;
    if (!userId) return {};
    const user = await User.findById(userId);
    if (!user || !user.email) return {};
    const m = await findMembershipForEmail(user.email);
    if (!m || !m.subscriptionId) return {};
    const subId = m.subscriptionId._id || m.subscriptionId;
    const sub = await OrganisationSubscription.findById(subId);
    const ov = orgAiToRuntimeOverrides(sub && sub.organisationAi);
    return ov || {};
}

async function getAIReponse(message, messageId, rawSchema, orgOverrides, streamObserver) {
    const rawClone = JSON.parse(JSON.stringify(rawSchema));
    const streamingForAnthropic =
      orgOverrides &&
      orgOverrides.provider === 'anthropic' &&
      typeof orgOverrides.anthropicThinkingBudget === 'number' &&
      orgOverrides.anthropicThinkingBudget > 0 &&
      typeof streamObserver === 'function';
    return chatCompletion([{ role: 'user', content: message }], {
        ...orgOverrides,
        streamObserver: streamingForAnthropic ? streamObserver : undefined,
        structuredResponse: {
            schemaName: `care_${messageId}`,
            rawSchema: rawClone,
        },
    });
}

module.exports = router;