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
            } else if (unintendedConsequence.riskScore >= 6) {
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
                    level: getScoreText(unintendedConsequence.riskScore/3)
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
    if (score < 1) {
        return 'Low';
    } else if (score < 2) {
        return 'Medium';
    } else {
        return 'High';
    }
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
            ['unintendedConsequences', 'riskEvaluation', 'actionPlanning'].includes(pageLink) &&
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