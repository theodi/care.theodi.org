const Project = require('../models/project'); // Import your Project model
const projectController = require('../controllers/project');

const pages = require('../pages.json');

const loadProject = async (req, res, next) => {
    res.locals.pages = pages;
    if (req.params.id) {
        if (req.params.id !== req.session.projectId) {
            req.session.projectId = req.params.id;
        }
    }
    if (req.session.projectId) {
        const id = req.session.projectId;
        const userId = req.session.passport.user.id;
        try {
            // Find the project by ID
            const project = await Project.findById(id);

            // If the project is not found, throw a 404 error
            if (!project) {
                const error = new Error("Project not found");
                error.status = 404;
                throw error;
            }

            // If the user is not the owner, remove the sharedWith property
            if (!project.owner.equals(userId)) {
                project.sharedWith = undefined;
            }

            // Set project to res.locals
            res.locals.project = project;

            // Fetch completion state for each page
            const updatedPages = await Promise.all(pages.map(async (page) => {
                const schemaPath = `../public/data/schemas/partials/${page.link}.json`;
                const schema = require(schemaPath);
                const completionState = await projectController.getCompletionState(id, schema); // Assuming the project ID is passed to the completion state function
                return { ...page, completionState };
            }));

            res.locals.pages = updatedPages;

        } catch (error) {
            return next(error); // Pass error to the error handling middleware
        }
    }
    next(); // Call the next middleware function in the chain
};

// Middleware to check project access
const checkProjectAccess = async (req, res, next) => {
    try {
        const projectId = req.params.id;
        const userId = req.session.passport.user.id;
        const userEmail = req.session.passport.user.email;

        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            const error = new Error("Project not found");
            error.status = 404;
            throw error;
        }

        // Check if the user is the owner of the project
        if (project.owner.equals(userId)) {
            return next(); // User is the owner, allow access
        }

        // Check if the project is shared with the user
        const sharedWithUser = project.sharedWith.find(user => user.user === userEmail);
        if (sharedWithUser) {
            return next(); // Project is shared with the user, allow access
        }

        // If neither the owner nor shared with the user, deny access
        const error = new Error("Unauthorized access");
        error.status = 403;
        throw error;
    } catch (error) {
        return next(error);
    }
}

// Middleware to check if the user is the owner of the project
const checkProjectOwner = async(req, res, next) => {
    try {
        const projectId = req.params.id;
        const userId = req.session.passport.user.id;

        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            const error = new Error("Project not found");
            error.status = 404;
            throw error;
        }

        // Check if the user is the owner of the project
        if (project.owner.equals(userId)) {
            return next(); // User is the owner, allow access
        }

        // If the user is not the owner, deny access
        const error = new Error("Unauthorized access");
        error.status = 403;
        throw error;
    } catch (error) {
        return next(error);
    }
}

module.exports = { loadProject, checkProjectAccess, checkProjectOwner };
