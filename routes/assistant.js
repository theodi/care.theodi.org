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
  getScanContextForMessageId,
  replaceOrgContextPlaceholder,
} = require('../lib/organisationScanContext');

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');

const completeAssessmentRuns = new Map();

// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
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
        const message = await populateMessage(messageId, projectData);
        const orgContext = await resolveOrganisationScanContextAppend(req, messageId);
        const userPrompt = replaceOrgContextPlaceholder(message, orgContext);
        const orgOverrides = await resolveOrganisationAiOverrides(req);
        const response = await getAIReponse(userPrompt, messageId, schema, orgOverrides);
        const parsedResponse = parseModelJsonResponse(response);
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
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            steps: [
                { id: 'intendedConsequences', status: 'pending', count: null },
                { id: 'unintendedConsequences', status: 'pending', count: null },
                { id: 'stakeholders', status: 'pending', count: null },
                { id: 'riskEvaluation', status: 'pending', count: null },
                { id: 'actionPlanning', status: 'pending', count: null },
            ],
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
        })
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

async function runCompleteAssessmentPipeline(req, initialProjectData, merge = true, onProgress) {
    const stepOrder = [
        'intendedConsequences',
        'unintendedConsequences',
        'stakeholders',
        'riskEvaluation',
        'actionPlanning',
    ];
    const orgOverrides = await resolveOrganisationAiOverrides(req);
    const progress = [];
    let projectData = initialProjectData;

    for (const stepId of stepOrder) {
        const step = { id: stepId, status: 'running' };
        progress.push(step);
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
        try {
            const schema = require('../public/data/schemas/partials/' + stepId + '.json');
            projectData.schema = JSON.stringify(schema);
            const message = await populateMessage(stepId, projectData);
            const orgContext = await resolveOrganisationScanContextAppend(req, stepId);
            const userPrompt = replaceOrgContextPlaceholder(message, orgContext);
            const response = await getAIReponse(userPrompt, stepId, schema, orgOverrides);
            const parsedResponse = parseModelJsonResponse(response);
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
  return getScanContextForMessageId(sub && sub.organisationScanContext, messageId);
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

async function getAIReponse(message, messageId, rawSchema, orgOverrides) {
    const rawClone = JSON.parse(JSON.stringify(rawSchema));
    return chatCompletion([{ role: 'user', content: message }], {
        ...orgOverrides,
        structuredResponse: {
            schemaName: `care_${messageId}`,
            rawSchema: rawClone,
        },
    });
}

module.exports = router;