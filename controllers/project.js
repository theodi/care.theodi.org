const mongoose = require('mongoose');
const Project = require('../models/project');
const User = require('../models/user'); // Import the User model
const OrganisationSubscription = require('../models/organisationSubscription');
const { findActiveMembershipsForEmail } = require('../lib/organisationEntitlements');
const { buildTenantSharedProjectsFilter } = require('../lib/integrationApiQuery');
const { canManageOrganisationProjectIntegrations } = require('../lib/organisationPermissions');
const { normalizeIntegrationExternalId } = require('../lib/integrationExternalId');

async function getUserProjects(userId) {
    try {
        // Convert userId string to ObjectId
        const userIdObjectId = new mongoose.Types.ObjectId(userId);
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const userEmail = user.email;

        // Find all projects where the user is the owner
        const ownedProjects = await Project.find({ owner: userIdObjectId });
        for (const project of ownedProjects) {
            // Update the project object in place with risk scores
            addRiskScoreToProject(project);
            const temp = [];
            temp.push(project);
            const tempMetrics = await getUserProjectMetrics(temp);
            project.riskCounts = tempMetrics.riskCounts;
        }

        // Find all projects shared with the user
        const sharedProjects = await Project.find({ "sharedWith.user": userEmail });

        const activeMemberships = await findActiveMembershipsForEmail(userEmail);
        const tenantIds = activeMemberships
            .map((m) => m.tenantId && (m.tenantId._id || m.tenantId))
            .filter(Boolean);
        let organisationProjectDocs = [];
        if (tenantIds.length > 0) {
            const subsForTenants = await OrganisationSubscription.find({
                tenantId: { $in: tenantIds },
            })
                .select('_id')
                .lean();
            const legacySubscriptionIds = subsForTenants.map((s) => s._id);
            organisationProjectDocs = await Project.find({
                sharedWithOrganisation: true,
                $or: [
                    { tenantId: { $in: tenantIds } },
                    ...(legacySubscriptionIds.length
                        ? [{ organisationSubscriptionId: { $in: legacySubscriptionIds } }]
                        : []),
                ],
            });
        }

        for (const project of organisationProjectDocs) {
            addRiskScoreToProject(project);
        }
        const organisationMetrics = await getUserProjectMetrics(organisationProjectDocs);

        const schemaPath = `../public/data/schemas/project.json`;
        const schema = require(schemaPath);

        // Fetch owner names for shared projects only
        const sharedProjectsPromises = sharedProjects.map(async project => {
            const owner = await User.findById(project.owner);
            const status = await getCompletionState(project._id,schema);
            return {
                id: project._id,
                title: project.title,
                owner: owner ? owner.name : "Unknown", // Use owner's name or "Unknown" if not found
                lastModified: project.lastModified,
                status: status
            };
        });
        const filteredSharedProjects = await Promise.all(sharedProjectsPromises);

        const organisationProjectsPromises = organisationProjectDocs.map(async (project) => {
            const owner = await User.findById(project.owner);
            const status = await getCompletionState(project._id, schema);
            const ownerId = project.owner;
            return {
                id: project._id,
                title: project.title,
                owner: owner ? owner.name : 'Unknown',
                lastModified: project.lastModified,
                status,
                organisation: true,
                ownedByCurrentUser: ownerId && ownerId.equals(userIdObjectId),
                integrationExternalId:
                    project.integrationExternalId != null && String(project.integrationExternalId).trim() !== ''
                        ? String(project.integrationExternalId).trim()
                        : '',
            };
        });
        const organisationProjectsList = await Promise.all(organisationProjectsPromises);

        const ownedProjectsPromises = ownedProjects.map(async project => {
            const status = await getCompletionState(project._id,schema);
            const sharedWith = project.sharedWith || [];
            return {
                id: project._id,
                title: project.title,
                owner: project.owner,
                lastModified: project.lastModified,
                riskCounts: project.riskCounts,
                status: status,
                sharedWithOrganisation: !!project.sharedWithOrganisation,
                sharedWithCount: sharedWith.length,
            };
        });
        const ownedProjectsStatus = await Promise.all(ownedProjectsPromises);

        const metrics = await getUserProjectMetrics(ownedProjects);
        const unified = await buildUnifiedDashboardData({
            userIdObjectId,
            ownedProjects,
            sharedProjects,
            organisationProjectDocs,
            schema,
        });

        return {
            ownedProjects: {
                projects: ownedProjectsStatus,
                riskCounts: metrics.riskCounts,
                averages: metrics.averages,
                topRisks: metrics.topRisks
            },
            sharedProjects: filteredSharedProjects,
            organisationProjects: {
                projects: organisationProjectsList,
                riskCounts: organisationMetrics.riskCounts,
                averages: organisationMetrics.averages,
                topRisks: organisationMetrics.topRisks,
            },
            assessments: unified.assessments,
            allRisks: unified.allRisks,
            dashboard: unified.dashboard,
        };
    } catch (error) {
        throw error; // Propagate the error to the caller
    }
}

async function getUserProjectMetrics(userProjects) {
    let riskCounts = {
        "unclassified": 0,
        "high": 0,
        "medium": 0,
        "low": 0
    };

    let totalLikelihood = 0;
    let totalImpact = 0;
    let totalRiskScore = 0;
    let totalUnintendedConsequences = 0;

    let topRisks = [];

    for (const project of userProjects) {
        // Update the project object in place with risk scores

        // Iterate over unintended consequences of the project
        for (const unintendedConsequence of project.unintendedConsequences) {
            if (!unintendedConsequence || unintendedConsequence.outcome === "Positive") {
                continue; // Skip positive unintended consequences
            }
            // Increment the corresponding risk count category based on the risk score
            if (unintendedConsequence.riskScore === null) {
                riskCounts.unclassified++;
            } else if (unintendedConsequence.riskScore >= 7) {
                riskCounts.high++;
            } else if (unintendedConsequence.riskScore >= 3) {
                riskCounts.medium++;
            } else {
                riskCounts.low++;
            }

            // Calculate total likelihood, impact, and risk score
            if (unintendedConsequence.likelihood && unintendedConsequence.impact) {
                totalLikelihood += getRiskValue(unintendedConsequence.likelihood);
                totalImpact += getRiskValue(unintendedConsequence.impact);
                totalRiskScore += unintendedConsequence.riskScore;
                totalUnintendedConsequences++;
            }

            // Add the unintended consequence to the top risks array
            if (unintendedConsequence.riskScore !== null) {
                topRisks.push({
                    projectId: project._id,
                    evaluationTitle: project.title || '',
                    consequence: unintendedConsequence.consequence,
                    score: unintendedConsequence.riskScore,
                    level: getBandFromScore(unintendedConsequence.riskScore)
                });
            }
        }
    }

    // Sort the top risks by risk score in descending order
    topRisks.sort((a, b) => b.score - a.score);

    // Get the top 5 risks
    const top5Risks = topRisks.slice(0, 5);

    // Calculate averages (avoid NaN when there are no scored consequences)
    const averageLikelihood = totalUnintendedConsequences > 0
        ? (totalLikelihood / totalUnintendedConsequences).toFixed(2)
        : '0.00';
    const averageImpact = totalUnintendedConsequences > 0
        ? (totalImpact / totalUnintendedConsequences).toFixed(2)
        : '0.00';
    const averageRiskScore = totalUnintendedConsequences > 0
        ? (totalRiskScore / totalUnintendedConsequences).toFixed(2)
        : '0.00';

    // Return risk counts, averages, and top 5 risks as a data object
    return {
        riskCounts: riskCounts,
        averages: {
            likelihood: averageLikelihood,
            impact: averageImpact,
            riskScore: averageRiskScore
        },
        topRisks: top5Risks
    };
}

function getRiskValue(textValue) {
    switch (textValue) {
        case 'High':
            return 3;
        case 'Medium':
            return 2;
        case 'Low':
            return 1;
        default:
            return 0;
    }
}

function getScoreText(score) {
    if (score < 3) {
        return 'Low';
    } else if (score < 7) {
        return 'Medium';
    } else {
        return 'High';
    }
}

function getBandFromScore(score) {
    if (score == null || Number.isNaN(score)) return 'Unclassified';
    if (score >= 7) return 'High';
    if (score >= 3) return 'Medium';
    return 'Low';
}

function normalizeLikelihoodImpact(value) {
    if (!value) return '';
    const t = String(value).trim().toLowerCase();
    if (t === 'high') return 'High';
    if (t === 'medium') return 'Medium';
    if (t === 'low') return 'Low';
    return '';
}

function parseOptionalDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function initMatrixCounts() {
    return {
        High: { High: 0, Medium: 0, Low: 0 },
        Medium: { High: 0, Medium: 0, Low: 0 },
        Low: { High: 0, Medium: 0, Low: 0 },
    };
}

function averageScore(items) {
    if (!items.length) return 0;
    const total = items.reduce((acc, it) => acc + (it.residualScore || 0), 0);
    return total / items.length;
}

function serializeTrendWindow(current, previous) {
    const currentHigh = current.filter((r) => r.residualBand === 'High').length;
    const previousHigh = previous.filter((r) => r.residualBand === 'High').length;
    const currentAvg = averageScore(current);
    const previousAvg = averageScore(previous);
    return {
        highResidualCount: currentHigh,
        highResidualDelta: currentHigh - previousHigh,
        averageResidual: currentAvg.toFixed(2),
        averageResidualDelta: (currentAvg - previousAvg).toFixed(2),
    };
}

async function buildUnifiedDashboardData({
    userIdObjectId,
    ownedProjects,
    sharedProjects,
    organisationProjectDocs,
    schema,
}) {
    const byId = new Map();
    const projectScopeTags = new Map();
    const ownerIds = new Set();
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const thirtyAgo = new Date(now.getTime() - 30 * dayMs);
    const sixtyAgo = new Date(now.getTime() - 60 * dayMs);
    const ninetyAgo = new Date(now.getTime() - 90 * dayMs);
    const oneEightyAgo = new Date(now.getTime() - 180 * dayMs);

    function ensureProject(doc) {
        if (!doc || !doc._id) return null;
        const id = String(doc._id);
        if (!byId.has(id)) byId.set(id, doc);
        if (!projectScopeTags.has(id)) projectScopeTags.set(id, new Set());
        return id;
    }

    function addScope(doc, scope) {
        const id = ensureProject(doc);
        if (!id) return;
        projectScopeTags.get(id).add(scope);
        if (doc.owner) ownerIds.add(String(doc.owner));
    }

    ownedProjects.forEach((p) => addScope(p, 'My'));
    organisationProjectDocs.forEach((p) => addScope(p, 'Organisation'));
    sharedProjects.forEach((p) => addScope(p, 'Shared with me'));

    const ownerDocs = await User.find({ _id: { $in: Array.from(ownerIds) } })
        .select('_id name')
        .lean();
    const ownerById = new Map(ownerDocs.map((u) => [String(u._id), u.name || 'Unknown']));

    const assessments = [];
    const allRisks = [];
    const matrixCounts = initMatrixCounts();
    const riskCounts = { unclassified: 0, high: 0, medium: 0, low: 0 };
    let withOwner = 0;
    let withTargetDate = 0;
    let overdueActions = 0;

    for (const [pid, project] of byId.entries()) {
        addRiskScoreToProject(project);
        const status = await getCompletionState(project._id, schema);
        const tags = Array.from(projectScopeTags.get(pid) || []).sort();
        const ownerId = project.owner ? String(project.owner) : '';
        const sharedWith = Array.isArray(project.sharedWith) ? project.sharedWith : [];
        const ownerName = ownerById.get(ownerId) || 'Unknown';
        const projectRiskCounts = {
            unclassified: 0,
            high: 0,
            medium: 0,
            low: 0,
        };

        const items = Array.isArray(project.unintendedConsequences)
            ? project.unintendedConsequences
            : [];

        items.forEach((uc, idx) => {
            if (!uc || uc.outcome === 'Positive') return;
            const likelihood = normalizeLikelihoodImpact(uc.likelihood);
            const impact = normalizeLikelihoodImpact(uc.impact);
            const likelihoodValue = getRiskValue(likelihood);
            const impactValue = getRiskValue(impact);
            const inherentScore =
                likelihoodValue && impactValue
                    ? Number(uc.riskScore || likelihoodValue * impactValue)
                    : null;
            const residualScore = inherentScore;
            const inherentBand = getBandFromScore(inherentScore);
            const residualBand = getBandFromScore(residualScore);
            const targetDate = parseOptionalDate(uc.action && uc.action.date);
            const targetDateIso = targetDate ? targetDate.toISOString() : null;
            const overdue = !!(targetDate && targetDate < now);
            const hasOwner = !!(uc.role && String(uc.role).trim() !== '');
            const actionCompleted = !!(
                uc.action &&
                String(uc.action.completed || '').trim() === 'Completed'
            );
            const actionNotCompleted = !!(
                uc.action &&
                String(uc.action.completed || '').trim() === 'Not completed'
            );

            if (inherentScore == null) {
                projectRiskCounts.unclassified++;
                riskCounts.unclassified++;
            } else if (inherentBand === 'High') {
                projectRiskCounts.high++;
                riskCounts.high++;
            } else if (inherentBand === 'Medium') {
                projectRiskCounts.medium++;
                riskCounts.medium++;
            } else {
                projectRiskCounts.low++;
                riskCounts.low++;
            }

            if (likelihood && impact) {
                matrixCounts[impact][likelihood] += 1;
            }
            if (hasOwner) withOwner++;
            if (targetDate) withTargetDate++;
            if (overdue) overdueActions++;

            allRisks.push({
                riskId: `${pid}:${idx}`,
                projectId: pid,
                evaluationTitle: project.title || '',
                consequence: uc.consequence || '',
                likelihood,
                impact,
                likelihoodValue,
                impactValue,
                inherentScore,
                inherentBand,
                residualScore,
                residualBand,
                level: residualBand,
                scopeTags: tags.slice(),
                lastModified: project.lastModified,
                actionRole: uc.role || '',
                actionDescription: uc.action && uc.action.description ? String(uc.action.description) : '',
                actionDueDate: targetDateIso,
                actionOverdue: overdue,
                actionCompleted,
                actionNotCompleted,
                actionCompletedAt:
                    uc.action && uc.action.completedAt ? String(uc.action.completedAt) : '',
                actionCompletionComment:
                    uc.action && uc.action.completionComment ? String(uc.action.completionComment) : '',
                viewHref: `/project/${encodeURIComponent(pid)}/actionCompletion`,
            });
        });

        assessments.push({
            id: pid,
            title: project.title,
            owner: ownerName,
            ownerId,
            lastModified: project.lastModified,
            status,
            riskCounts: projectRiskCounts,
            sharedWithOrganisation: !!project.sharedWithOrganisation,
            sharedWithCount: sharedWith.length,
            ownedByCurrentUser: ownerId === String(userIdObjectId),
            sharedWithCurrentUser: tags.includes('Shared with me'),
            scopeTags: tags,
            integrationExternalId:
                project.integrationExternalId != null && String(project.integrationExternalId).trim() !== ''
                    ? String(project.integrationExternalId).trim()
                    : '',
            maxResidualScore: allRisks
                .filter((r) => r.projectId === pid && r.residualScore != null)
                .reduce((m, r) => Math.max(m, r.residualScore), 0),
        });
    }

    allRisks.sort((a, b) => {
        const ra = a.residualScore == null ? -1 : a.residualScore;
        const rb = b.residualScore == null ? -1 : b.residualScore;
        if (rb !== ra) return rb - ra;
        const ia = a.inherentScore == null ? -1 : a.inherentScore;
        const ib = b.inherentScore == null ? -1 : b.inherentScore;
        if (ib !== ia) return ib - ia;
        return String(a.evaluationTitle || '').localeCompare(String(b.evaluationTitle || ''));
    });

    assessments.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const recent30 = allRisks.filter((r) => {
        const d = parseOptionalDate(r.lastModified);
        return d && d >= thirtyAgo;
    });
    const previous30 = allRisks.filter((r) => {
        const d = parseOptionalDate(r.lastModified);
        return d && d < thirtyAgo && d >= sixtyAgo;
    });
    const recent90 = allRisks.filter((r) => {
        const d = parseOptionalDate(r.lastModified);
        return d && d >= ninetyAgo;
    });
    const previous90 = allRisks.filter((r) => {
        const d = parseOptionalDate(r.lastModified);
        return d && d < ninetyAgo && d >= oneEightyAgo;
    });

    const totalRisks = allRisks.length;
    const dashboard = {
        matrixCounts,
        riskCounts,
        treatmentProgress: {
            totalRisks,
            withOwner,
            withOwnerPct: totalRisks ? ((withOwner / totalRisks) * 100).toFixed(1) : '0.0',
            withTargetDate,
            withTargetDatePct: totalRisks ? ((withTargetDate / totalRisks) * 100).toFixed(1) : '0.0',
            overdueActions,
            overdueActionsPct: totalRisks ? ((overdueActions / totalRisks) * 100).toFixed(1) : '0.0',
        },
        trend: {
            days30: serializeTrendWindow(recent30, previous30),
            days90: serializeTrendWindow(recent90, previous90),
        },
    };

    return { assessments, allRisks, dashboard };
}

async function addRiskScoreToProject(project) {
    for (const unintendedConsequence of project.unintendedConsequences) {
        // Check if both impact and likelihood are defined
        if (!unintendedConsequence || unintendedConsequence.outcome === "Positive") {
            continue; // Skip positive outcomes entirely
        }
        if (unintendedConsequence.likelihood && unintendedConsequence.impact) {
            // Calculate risk score for the unintended consequence
            let riskScore = 1; // Default risk score
            switch (unintendedConsequence.likelihood) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown likelihood
                    break;
            }
            switch (unintendedConsequence.impact) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown impact
                    break;
            }
            // Add risk score to the unintended consequence
            unintendedConsequence.riskScore = riskScore;
        } else {
            unintendedConsequence.riskScore = null;
        }
    }
    return project;
}


/**
 * Whether a value counts as filled for sidebar completion (empty string is incomplete).
 * @param {unknown} v
 * @returns {boolean}
 */
function hasValue(v) {
    if (v == null) return false;
    return String(v).trim() !== '';
}

/**
 * Unintended-consequences data is shared across several steps; the form only collects a
 * subset of fields per step. Hidden fields stay empty until later pages, so the generic
 * schema check (which required every property on every item) never marked those steps
 * complete, and positive outcomes hidden on risk/action pages still blocked completion.
 *
 * @param {string} stage
 * @param {object | null | undefined} item
 * @returns {boolean}
 */
function unintendedConsequenceItemCompleteForStage(stage, item) {
    if (!item || !hasValue(item.consequence) || !hasValue(item.outcome)) {
        return false;
    }
    if (stage === 'unintendedConsequences') {
        return true;
    }
    if (item.outcome === 'Positive') {
        return true;
    }
    if (stage === 'riskEvaluation') {
        return hasValue(item.impact) && hasValue(item.likelihood);
    }
    if (stage === 'actionPlanning') {
        const a = item.action || {};
        return (
            hasValue(item.impact) &&
            hasValue(item.likelihood) &&
            hasValue(item.role) &&
            hasValue(a.description) &&
            hasValue(a.stakeholder) &&
            hasValue(a.date) &&
            hasValue(a.KPI)
        );
    }
    if (stage === 'actionCompletion') {
        const a = item.action || {};
        const hasPlannedAction =
            hasValue(item.impact) &&
            hasValue(item.likelihood) &&
            hasValue(item.role) &&
            hasValue(a.description) &&
            hasValue(a.stakeholder) &&
            hasValue(a.date) &&
            hasValue(a.KPI);
        if (!hasPlannedAction) {
            return true;
        }
        if (!hasValue(a.completed)) {
            return false;
        }
        if (String(a.completed) === 'Completed') {
            return hasValue(a.completionComment);
        }
        return true;
    }
    return false;
}

/**
 * @param {Array<{ consequence?: string, outcome?: string }>} items
 * @param {string} stage
 * @returns {'done'|'inProgress'|'todo'}
 */
function completionStateFromUnintendedConsequences(items, stage) {
    if (!Array.isArray(items) || items.length === 0) {
        return 'todo';
    }
    let allDone = true;
    let someDone = false;
    for (const item of items) {
        const ok = unintendedConsequenceItemCompleteForStage(stage, item);
        if (ok) {
            someDone = true;
        } else {
            allDone = false;
        }
    }
    if (allDone) {
        return 'done';
    }
    if (someDone) {
        return 'inProgress';
    }
    return 'todo';
}

// Function to calculate completion state for a section
async function getCompletionState(projectId, schema, pageLink) {
    try {
        // Find the project by ID
        const project = await Project.findById(projectId);
        // If the project is not found, return "Todo"
        if (!project) {
            return "Todo";
        }

        let allDone = true;
        let someDone = false;
        const properties = schema.properties;

        if (
            pageLink &&
            ['unintendedConsequences', 'riskEvaluation', 'actionPlanning', 'actionCompletion'].includes(pageLink) &&
            properties &&
            properties.unintendedConsequences
        ) {
            return completionStateFromUnintendedConsequences(project.unintendedConsequences, pageLink);
        }

        // Extract data for the section based on the schema
        for (const key in properties) {
            if (!project[key] || (Array.isArray(project[key]) && project[key].length === 0)) {
                allDone = false;
            } else {
                someDone = true;
                // Check if it's an array of objects
                if (Array.isArray(project[key]) && properties[key].type === 'array' && properties[key].items) {
                    const requiredProperties = Object.keys(properties[key].items.properties || {});
                    for (const item of project[key]) {
                        const missingProperties = requiredProperties.filter(prop => !item[prop]);
                        if (missingProperties.length > 0) {
                            allDone = false;
                            break; // No need to check further, one item is incomplete
                        }
                    }
                }
            }
        }
        if (allDone) {
            return "done";
        }
        if (someDone) {
            return "inProgress";
        }
        return "todo";
    } catch (error) {
        return "inProgress";
    }
}

async function getProjectOwner(project) {
    try {
        // Validate that the project object has an owner field
        if (!project || !project.owner) {
            throw new Error("Invalid project object or missing owner field");
        }

        // Find the owner user by ID
        const owner = await User.findById(project.owner);
        if (!owner) {
            throw new Error("Owner not found");
        }

        // Return owner details
        return {
            id: owner._id,
            name: owner.name,
            email: owner.email
        };
    } catch (error) {
        console.error("Error retrieving project owner:", error);
        throw error; // Propagate the error to the caller
    }
}

async function userMaySetOrganisationIntegrationExternalId(userEmail, project) {
    if (!project || !project.sharedWithOrganisation) return false;
    const memberships = await findActiveMembershipsForEmail(userEmail);
    for (const m of memberships) {
        if (!canManageOrganisationProjectIntegrations(m)) continue;
        const tenantOid = m.tenantId && (m.tenantId._id || m.tenantId);
        if (!tenantOid) continue;
        const filter = await buildTenantSharedProjectsFilter(tenantOid);
        const hit = await Project.findOne({ _id: project._id, ...filter }).select('_id').lean();
        if (hit) return true;
    }
    return false;
}

/**
 * Set integrationExternalId for an org-shared project (project managers / org admins).
 * @param {string} userEmail
 * @param {string} projectId
 * @param {{ integrationExternalId?: string | null }} body
 */
async function setProjectIntegrationExternalId(userEmail, projectId, body) {
    if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'integrationExternalId')) {
        const e = new Error(
            'Body must include integrationExternalId (string; use empty string or null to clear)'
        );
        e.status = 400;
        throw e;
    }
    const norm = normalizeIntegrationExternalId(body.integrationExternalId);
    if (!norm.ok) {
        const e = new Error(norm.error);
        e.status = 400;
        throw e;
    }
    if (!mongoose.isValidObjectId(projectId)) {
        const e = new Error('Invalid project id');
        e.status = 400;
        throw e;
    }
    const project = await Project.findById(projectId);
    if (!project) {
        const e = new Error('Project not found');
        e.status = 404;
        throw e;
    }
    const allowed = await userMaySetOrganisationIntegrationExternalId(userEmail, project);
    if (!allowed) {
        const e = new Error(
            'You do not have permission to set this reference, or the evaluation is not shared with your organisation'
        );
        e.status = 403;
        throw e;
    }
    const oid = project._id;
    if (!norm.value) {
        await Project.updateOne({ _id: oid }, { $unset: { integrationExternalId: 1 } });
    } else {
        await Project.updateOne({ _id: oid }, { $set: { integrationExternalId: norm.value } });
    }
    const fresh = await Project.findById(oid).select('integrationExternalId').lean();
    const out =
        fresh && fresh.integrationExternalId != null ? String(fresh.integrationExternalId) : '';
    return { integrationExternalId: out };
}

module.exports = {
    getUserProjects,
    getCompletionState,
    getUserProjectMetrics,
    addRiskScoreToProject,
    getProjectOwner,
    setProjectIntegrationExternalId,
    /** @internal exposed for tests */
    completionStateFromUnintendedConsequences,
    unintendedConsequenceItemCompleteForStage,
};