// routes/projects.js

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const projectController = require('../controllers/project');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const OrganisationSubscription = require('../models/organisationSubscription');
const { exportProjectToDocxTempFile } = require('../lib/projectDocxExport');

// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
}

const OrganisationMembership = require('../models/organisationMembership');
const User = require('../models/user');
const {
  findActiveMembershipsForEmail,
  normalizeMemberEmail,
} = require('../lib/organisationEntitlements');
const {
    loadProject,
    checkProjectAccess,
    checkProjectOwner,
    checkOrgAdminCanTransferProjectOwner,
} = require('../middleware/project');
const { checkLimit } = require('../middleware/hubspot');
const { updateToolStatistics } = require('../controllers/hubspot');
const {
    buildProjectJsonForClient,
    wantsFullAiInteractionHistory,
} = require('../lib/projectClientJson');

// GET route to retrieve a project by ID
router.get('/:id/completeAssessment', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        const project = res.locals.project;

        let page = {
            link: "completeAssessment",
            title: "Use AI Assistant?"
        };

        res.locals.page = page;
        res.locals.layoutScanHeader = true;
        res.render('pages/completeAssessment', { project: project });
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});
// POST append user selections for a prior AI run (audit trail + client sync)
router.post(
    '/:id/ai-runs/:runId/selections',
    ensureAuthenticated,
    checkProjectAccess,
    async (req, res) => {
        const projectId = req.params.id;
        const runId = req.params.runId;
        try {
            const { appendSelectionToRun } = require('../lib/aiProvenance');
            const result = await appendSelectionToRun(projectId, runId, req.body || {});
            if (!result.ok) {
                return res.status(result.code).json({ message: result.message });
            }
            return res.status(201).json({
                message: 'Selection recorded',
                appliedAt: result.appliedAt,
                indices: result.indices,
                items: result.items,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
);

// GET route to retrieve a project by ID
router.get('/:id/riskSummary', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        let project = res.locals.project;
        project = await projectController.addRiskScoreToProject(project);
        const userProjects = [];
        userProjects.push(project);
        let metrics = await projectController.getUserProjectMetrics(userProjects);

        return res.json(metrics);

    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});

// GET route to retrieve shared users of a project
router.get('/:id/sharedUsers', ensureAuthenticated, checkProjectAccess, async (req, res) => {
    const projectId = req.params.id;

    try {
        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Extract shared users from the project
        const sharedUsers = (project.sharedWith || []).map(user => user.user);

        // Return shared users
        res.json({ sharedUsers });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

// POST route to add a new shared user to a project
router.post('/:id/sharedUsers', ensureAuthenticated, checkProjectOwner, async (req, res) => {
    const projectId = req.params.id;
    const { email } = req.body; // Assuming the email is sent in the request body

    try {
        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        if (!project.sharedWith) {
            project.sharedWith = [];
        }
        // Add the new shared user to the project
        project.sharedWith.push({ user: email });

        // Save the project with the updated shared users
        await project.save();

        // Return success message
        res.json({ message: "User added to the project successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE route to remove a shared user from a project
router.delete('/:id/sharedUsers/:userId', ensureAuthenticated, checkProjectOwner, async (req, res) => {
    const projectId = req.params.id;
    const userId = req.params.userId;

    try {
        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Find the index of the shared user in the sharedWith array
        const index = (project.sharedWith || []).findIndex(user => user.user === userId);

        // If the shared user is found, remove it from the array
        if (index !== -1) {
            project.sharedWith.splice(index, 1);
            await project.save();
            res.json({ message: "Shared user removed from the project successfully" });
        } else {
            res.status(404).json({ message: "Shared user not found" });
        }
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

router.patch(
    '/:id/integration-external-id',
    ensureAuthenticated,
    async (req, res, next) => {
        try {
            const email = req.session.passport.user.email;
            const result = await projectController.setProjectIntegrationExternalId(
                email,
                req.params.id,
                req.body || {}
            );
            res.json(result);
        } catch (e) {
            const status = e.status || 500;
            res.status(status).json({ message: e.message || 'Error' });
        }
    }
);

router.patch('/:id/organisation-share', ensureAuthenticated, checkProjectOwner, async (req, res, next) => {
    try {
        const { sharedWithOrganisation } = req.body;
        if (typeof sharedWithOrganisation !== 'boolean') {
            return res.status(400).json({ message: 'sharedWithOrganisation must be a boolean' });
        }
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        const userEmail = req.session.passport.user.email;
        if (sharedWithOrganisation) {
            const memberships = await findActiveMembershipsForEmail(userEmail);
            if (!memberships.length) {
                return res.status(403).json({ message: 'No active organisation membership' });
            }
            const tenantOid = memberships[0].tenantId._id || memberships[0].tenantId;
            project.tenantId = tenantOid;
            project.organisationSubscriptionId = undefined;
            project.sharedWithOrganisation = true;
        } else {
            project.sharedWithOrganisation = false;
        }
        await project.save();
        res.json({
            message: 'Updated',
            sharedWithOrganisation: project.sharedWithOrganisation,
            tenantId: project.tenantId,
            organisationSubscriptionId: project.organisationSubscriptionId,
        });
    } catch (error) {
        next(error);
    }
});

router.patch('/:id/owner', ensureAuthenticated, checkOrgAdminCanTransferProjectOwner, async (req, res, next) => {
    try {
        const { ownerUserId, ownerEmail } = req.body;
        const project = res.locals.projectForOwnerTransfer;
        let targetEmailLower = null;
        let newOwnerId = null;

        if (ownerEmail && String(ownerEmail).trim()) {
            targetEmailLower = normalizeMemberEmail(ownerEmail);
            const targetUser = await User.findOne({
                email: new RegExp(`^${targetEmailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            });
            if (!targetUser) {
                return res.status(400).json({
                    message:
                        'New owner must have a CARE account and use the same email as their organisation membership',
                });
            }
            newOwnerId = targetUser._id;
        } else if (ownerUserId && mongoose.isValidObjectId(ownerUserId)) {
            const targetUser = await User.findById(ownerUserId);
            if (!targetUser) {
                return res.status(400).json({ message: 'User not found' });
            }
            newOwnerId = targetUser._id;
            targetEmailLower = normalizeMemberEmail(targetUser.email);
        } else {
            return res.status(400).json({ message: 'Provide ownerEmail or ownerUserId' });
        }

        if (!targetEmailLower) {
            return res.status(400).json({ message: 'Invalid owner email' });
        }

        let projectTenantId = project.tenantId;
        if (!projectTenantId && project.organisationSubscriptionId) {
            const s = await OrganisationSubscription.findById(project.organisationSubscriptionId)
                .select('tenantId')
                .lean();
            projectTenantId = s && s.tenantId;
        }
        if (!projectTenantId) {
            return res.status(400).json({ message: 'Project is not linked to an organisation tenant' });
        }
        const targetMembership = await OrganisationMembership.findOne({
            tenantId: projectTenantId,
            emailLower: targetEmailLower,
        });
        if (!targetMembership) {
            return res.status(400).json({ message: 'New owner must be a member of the organisation' });
        }
        project.owner = newOwnerId;
        await project.save();
        res.json({ message: 'Owner updated', owner: newOwnerId });
    } catch (error) {
        next(error);
    }
});

// Full AI interaction history (lazy-loaded in the scan UI; avoids huge default GET /project/:id JSON)
router.get(
    '/:id/ai-interaction-history',
    ensureAuthenticated,
    checkProjectAccess,
    async (req, res, next) => {
        try {
            const accept = req.get('Accept') || '';
            if (accept && !accept.includes('application/json')) {
                return res.status(406).json({ message: 'Use Accept: application/json' });
            }
            const proj = await Project.findById(req.params.id).select('aiInteractionHistory').lean();
            if (!proj) {
                return res.status(404).json({ message: 'Project not found' });
            }
            return res.json({ aiInteractionHistory: proj.aiInteractionHistory || [] });
        } catch (error) {
            next(error);
        }
    }
);

// Full detail for one AI run (lazy-loaded when a run row is expanded)
router.get(
    '/:id/ai-interaction-history/:runId',
    ensureAuthenticated,
    checkProjectAccess,
    async (req, res, next) => {
        try {
            const accept = req.get('Accept') || '';
            if (accept && !accept.includes('application/json')) {
                return res.status(406).json({ message: 'Use Accept: application/json' });
            }
            const runId = String(req.params.runId || '');
            if (!runId) {
                return res.status(400).json({ message: 'runId is required' });
            }
            const proj = await Project.findOne(
                { _id: req.params.id, aiInteractionHistory: { $elemMatch: { runId } } },
                { aiInteractionHistory: { $elemMatch: { runId } } }
            ).lean();
            if (!proj || !Array.isArray(proj.aiInteractionHistory) || proj.aiInteractionHistory.length === 0) {
                return res.status(404).json({ message: 'AI run not found' });
            }
            return res.json({ aiInteractionRun: proj.aiInteractionHistory[0] });
        } catch (error) {
            next(error);
        }
    }
);

// GET completion states for each assessment section (for live sidebar refresh)
router.get('/:id/progress', ensureAuthenticated, checkProjectAccess, async (req, res, next) => {
    try {
        const accept = req.get('Accept') || '';
        if (accept && !accept.includes('application/json')) {
            return res.status(406).json({ message: 'Use Accept: application/json' });
        }
        const id = req.params.id;
        const pages = require('../pages.json');
        const updatedPages = await Promise.all(
            pages.map(async (page) => {
                const schemaPath = `../public/data/schemas/partials/${page.link}.json`;
                const schema = require(schemaPath);
                const completionState = await projectController.getCompletionState(
                    id,
                    schema,
                    page.link
                );
                return {
                    link: page.link,
                    title: page.title,
                    completionState,
                };
            })
        );
        return res.json({ pages: updatedPages });
    } catch (error) {
        return next(error);
    }
});

// GET route to retrieve a project by ID
router.get('/:id/:page', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        const project = res.locals.project;

        // Content negotiation based on request Accept header
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            if (wantsFullAiInteractionHistory(req)) {
                return res.json(project.toObject ? project.toObject() : project);
            }
            return res.json(buildProjectJsonForClient(project));
        } else {
            // Check if the page parameter is provided
            const pages = require('../pages.json');
            const pageParam = req.params.page;
            if (pageParam) {
                // Find the corresponding title in the pages array
                const lookup = pages.find(p => p.link === pageParam);
                if (lookup) {
                    page = lookup;
                }
            }

            res.locals.page = page;
            res.locals.layoutScanHeader = true;
            res.render('pages/scan', { project: project });
        }
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});

const { parse } = require('json2csv');

// GET route to retrieve a project by ID
router.get('/:id', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        let project = res.locals.project;

        // Content negotiation based on request Accept header
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            if (wantsFullAiInteractionHistory(req)) {
                return res.json(project.toObject ? project.toObject() : project);
            }
            return res.json(buildProjectJsonForClient(project));
        } else if (acceptHeader === 'text/csv') {
            // Respond with CSV
            const fields = ['consequence', 'outcome', 'impact', 'likelihood', 'role', 'action.description', 'action.date', 'action.stakeholder', 'action.KPI'];
            const opts = { fields };
            const csv = parse(project.unintendedConsequences, opts);

            // Sanitize filename for CSV export
            const sanitizedTitle = project.title
                .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .trim();
            const csvFileName = `${sanitizedTitle}.csv`;
            res.setHeader('Content-Disposition', `attachment; filename="${csvFileName}"`);
            res.setHeader('Content-Type', 'text/csv');
            return res.send(csv);
        } else if (acceptHeader === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            console.log('Starting DOCX generation for project:', project._id);
            try {
                const { tempFilePath, attachmentFileName } = await exportProjectToDocxTempFile(
                    project,
                    req.query
                );
                console.log('buildDocx completed, temp file:', tempFilePath);
                res.set(
                    'Content-Disposition',
                    `attachment; filename="${attachmentFileName}"`
                );
                res.set(
                    'Content-Type',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                res.sendFile(path.resolve(tempFilePath), async (err) => {
                    if (err) {
                        console.error('Error sending file:', err);
                    } else {
                        try {
                            await fs.promises.unlink(tempFilePath);
                        } catch (error) {
                            console.error('Error deleting temporary file:', error);
                        }
                    }
                });
            } catch (docxError) {
                console.error('Error in DOCX generation:', docxError);
                return res.status(500).json({
                    error: 'Failed to generate DOCX file',
                    details: docxError.message,
                });
            }
        } else {
            let page = {
                link: "/finalReport",
                title: "Project evaluation"
            };
            res.locals.page = page;
            res.locals.layoutScanHeader = true;
            res.render('pages/project', { project: project });
        }
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});
// POST route to create a new project
router.post('/', ensureAuthenticated, checkLimit, async (req, res, next) => {
    try {
        // Set owner field to the ID of the authenticated user
        const user = req.session.passport.user;
        const now = new Date();
        req.body.owner = user.id;

        const createPayload = { ...req.body };
        delete createPayload.aiInteractionHistory;
        delete createPayload.aiInteractionHistoryCount;
        delete createPayload.aiInteractionHistoryStepCounts;
        delete createPayload.integrationExternalId;

        // Project-level provenance
        createPayload.createdBy = user.email;
        createPayload.createdAt = now;
        createPayload.lastModifiedBy = user.email;

        const project = new Project(createPayload);
        const savedProject = await project.save();
        updateToolStatistics(user.id);
        res.status(201).json(savedProject);
    } catch (error) {
        next(error);
    }
});

function applyActionCompletionProvenance(existingProject, incomingPayload, actorEmail) {
    if (!existingProject || !incomingPayload) return;
    const prevItems = Array.isArray(existingProject.unintendedConsequences)
        ? existingProject.unintendedConsequences
        : [];
    const nextItems = Array.isArray(incomingPayload.unintendedConsequences)
        ? incomingPayload.unintendedConsequences
        : [];
    const nowIso = new Date().toISOString();

    nextItems.forEach((uc, index) => {
        if (!uc) return;
        const prev = prevItems[index] || {};
        const prevAction = prev.action || {};
        if (!uc.action) uc.action = {};
        const nextAction = uc.action;

        const prevCompleted = String(prevAction.completed || '').trim();
        const nextCompleted = String(nextAction.completed || '').trim();

        // If this risk/action has never had provenance, set createdBy/createdAt.
        if (!uc.createdBy && actorEmail) {
            uc.createdBy = actorEmail;
            uc.createdAt = nowIso;
        }
        if (!uc.lastModifiedBy && actorEmail) {
            uc.lastModifiedBy = actorEmail;
            uc.lastModifiedAt = nowIso;
        }

        if (!nextAction.createdBy && actorEmail) {
            nextAction.createdBy = actorEmail;
            nextAction.createdAt = nowIso;
        }

        // Always bump lastModified on any edit to this action payload.
        if (actorEmail) {
            nextAction.lastModifiedBy = actorEmail;
            nextAction.lastModifiedAt = nowIso;
            uc.lastModifiedBy = actorEmail;
            uc.lastModifiedAt = nowIso;
        }

        // Ensure completion provenance whenever an action is in the Completed state
        // and we have an actor, even if it was completed in a previous version
        // but never had completedBy recorded.
        if (nextCompleted === 'Completed' && actorEmail) {
            if (!nextAction.completedAt || !String(nextAction.completedAt).trim()) {
                nextAction.completedAt = nowIso.slice(0, 10);
            }
            if (!nextAction.completedBy || !String(nextAction.completedBy).trim()) {
                nextAction.completedBy = actorEmail;
            }
        }
    });
}

// PUT route to update an existing project
router.put('/:id', ensureAuthenticated, checkProjectAccess, async (req, res, next) => {
    const id = req.params.id;
    try {
        const existing = await Project.findById(id).lean();
        if (!existing) {
            return res.status(404).json({ message: "Project not found" });
        }

        const payload = { ...req.body };
        delete payload.owner;
        delete payload.organisationSubscriptionId;
        delete payload.tenantId;
        delete payload.sharedWithOrganisation;
        delete payload.integrationExternalId;
        delete payload.aiInteractionHistory;
        delete payload.aiInteractionHistoryCount;
        delete payload.aiInteractionHistoryStepCounts;

        const actorEmail = req.session.passport.user && req.session.passport.user.email;

        // Apply provenance for risks/actions in the incoming payload based on previous state.
        applyActionCompletionProvenance(existing, payload, actorEmail);

        const now = new Date();
        const update = {
            ...payload,
            lastModified: now,
        };
        if (actorEmail) {
            update.lastModifiedBy = actorEmail;
        }

        const updatedProject = await Project.findByIdAndUpdate(id, update, {
            new: true,
            runValidators: true,
        });
        if (!updatedProject) {
            return res.status(404).json({ message: "Project not found" });
        }
        updateToolStatistics(req.session.passport.user.id);
        res.json(updatedProject);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE route to delete a project
router.delete('/:id', ensureAuthenticated, checkProjectOwner, async (req, res, next) => {
    const id = req.params.id;
    // Unset req.session.projectId if it matches the ID to be deleted
    if (req.session.projectId === id) {
        delete req.session.projectId;
    }
    try {
        // Find the project by ID and delete it
        const deletedProject = await Project.findByIdAndDelete(id);

        // Check if the project was found and deleted
        if (!deletedProject) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Return a success message
        res.json({ message: "Project deleted successfully" });
    } catch (error) {
        // Handle errors
        res.status(500).json({ message: "Internal server error" });
    }
});


module.exports = router;