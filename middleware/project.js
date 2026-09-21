const Project = require('../models/project'); // Import your Project model
const projectController = require('../controllers/project');
const OrganisationMembership = require('../models/organisationMembership');
const OrganisationSubscription = require('../models/organisationSubscription');
const {
  findActiveMembershipsForEmail,
  normalizeMemberEmail,
  isSubscriptionActive,
  getActiveSubscriptionForTenantId,
} = require('../lib/organisationEntitlements');
const { requireUserFromSession, getSessionEmail } = require('../lib/sessionUserId');

const pages = require('../pages.json');

const loadProject = async (req, res, next) => {
    res.locals.pages = pages;
    if (req.path.startsWith('/subscriptions') || req.path.startsWith('/organisation')) {
        return next();
    }
    if (req.params.id) {
        if (req.params.id !== req.session.projectId) {
            req.session.projectId = req.params.id;
        }
    }
    if (req.session.projectId) {
        const id = req.session.projectId;
        try {
            const dbUser = await requireUserFromSession(req);
            const project = await Project.findById(id);

            if (!project) {
                const error = new Error("Project not found");
                error.status = 404;
                throw error;
            }

            if (!project.owner.equals(dbUser._id)) {
                project.sharedWith = undefined;
            }

            res.locals.project = project;

            const updatedPages = await Promise.all(pages.map(async (page) => {
                const schemaPath = `../public/data/schemas/partials/${page.link}.json`;
                const schema = require(schemaPath);
                const completionState = await projectController.getCompletionState(id, schema, page.link);
                return { ...page, completionState };
            }));

            res.locals.pages = updatedPages;

        } catch (error) {
            return next(error);
        }
    }
    next();
};

async function resolveProjectTenantId(project) {
    if (project.tenantId) return project.tenantId;
    if (project.organisationSubscriptionId) {
        const sub = await OrganisationSubscription.findById(project.organisationSubscriptionId)
            .select('tenantId')
            .lean();
        return sub && sub.tenantId;
    }
    return null;
}

const checkProjectAccess = async (req, res, next) => {
    try {
        const projectId = req.params.id;
        const dbUser = await requireUserFromSession(req);
        const userEmail = dbUser.email;

        const project = await Project.findById(projectId);

        if (!project) {
            const error = new Error("Project not found");
            error.status = 404;
            throw error;
        }

        if (project.owner.equals(dbUser._id)) {
            return next();
        }

        const sharedWithUser = (project.sharedWith || []).find(user => user.user === userEmail);
        if (sharedWithUser) {
            return next();
        }

        if (project.sharedWithOrganisation) {
            const projectTenantId = await resolveProjectTenantId(project);
            if (projectTenantId) {
                const memberships = await findActiveMembershipsForEmail(userEmail);
                const inOrg = memberships.some(
                    (m) =>
                        m.tenantId &&
                        (m.tenantId._id || m.tenantId).toString() === projectTenantId.toString()
                );
                if (inOrg) {
                    return next();
                }
            }
        }

        const error = new Error("Unauthorized access");
        error.status = 403;
        throw error;
    } catch (error) {
        return next(error);
    }
};

const checkProjectOwner = async(req, res, next) => {
    try {
        const projectId = req.params.id;
        const dbUser = await requireUserFromSession(req);

        const project = await Project.findById(projectId);

        if (!project) {
            const error = new Error("Project not found");
            error.status = 404;
            throw error;
        }

        if (project.owner.equals(dbUser._id)) {
            return next();
        }

        const error = new Error("Unauthorized access");
        error.status = 403;
        throw error;
    } catch (error) {
        return next(error);
    }
};

const checkOrgAdminCanTransferProjectOwner = async (req, res, next) => {
    try {
        const projectId = req.params.id;

        const project = await Project.findById(projectId);
        if (!project) {
            const error = new Error("Project not found");
            error.status = 404;
            throw error;
        }
        if (!project.sharedWithOrganisation) {
            const error = new Error("Owner transfer is only available for organisation-shared evaluations");
            error.status = 400;
            throw error;
        }
        const tenantId = await resolveProjectTenantId(project);
        if (!tenantId) {
            const error = new Error("Organisation tenant not linked to this evaluation");
            error.status = 400;
            throw error;
        }
        const activeSub = await getActiveSubscriptionForTenantId(tenantId);
        if (!activeSub || !isSubscriptionActive(activeSub)) {
            const error = new Error("Organisation subscription is not active");
            error.status = 403;
            throw error;
        }
        const userEmail = getSessionEmail(req);
        const emailLower = normalizeMemberEmail(userEmail);
        const adminMembership = await OrganisationMembership.findOne({
            tenantId,
            emailLower,
            role: 'admin',
        });
        if (!adminMembership) {
            const error = new Error("Unauthorized access");
            error.status = 403;
            throw error;
        }
        res.locals.projectForOwnerTransfer = project;
        next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    loadProject,
    checkProjectAccess,
    checkProjectOwner,
    checkOrgAdminCanTransferProjectOwner,
};
