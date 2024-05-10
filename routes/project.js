// routes/projects.js

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const projectController = require('../controllers/project');
const mongoose = require('mongoose');

// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
}

// Middleware to check project access
async function checkProjectAccess(req, res, next) {
    try {
        const projectId = req.params.id;
        const userId = req.session.passport.user.id;

        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Check if the user is the owner of the project
        if (project.owner.equals(userId)) {
            return next(); // User is the owner, allow access
        }

        // Check if the project is shared with the user
        const sharedWithUser = project.sharedWith.find(user => user.equals(userId));
        if (sharedWithUser) {
            return next(); // Project is shared with the user, allow access
        }

        // If neither the owner nor shared with the user, deny access
        return res.status(403).json({ message: "Unauthorized access" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error" });
    }
}

// Middleware to check if the user is the owner of the project
async function checkProjectOwner(req, res, next) {
    try {
        const projectId = req.params.id;
        const userId = req.session.passport.user.id;

        // Find the project by ID
        const project = await Project.findById(projectId);

        // Check if the project exists
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Check if the user is the owner of the project
        if (project.owner.equals(userId)) {
            return next(); // User is the owner, allow access
        }

        // If the user is not the owner, deny access
        return res.status(403).json({ message: "Unauthorized access" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error" });
    }
}

// GET route to retrieve a project by ID
router.get('/:id', ensureAuthenticated, checkProjectAccess, async (req, res, next) => {
    const id = req.params.id;
    try {
        const userId = req.session.passport.user.id;

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

        // Content negotiation based on request Accept header
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            // Respond with JSON
            return res.json(project);
        } else {
            // Respond with HTML (rendering scan.ejs)
            res.locals.pageTitle = "Project details";
            res.render('pages/scan', { project: project });
        }
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});

// POST route to create a new project
router.post('/', ensureAuthenticated, async (req, res) => {
    try {
        // Set owner field to the ID of the authenticated user
        const user = req.session.passport.user;
        req.body.owner = user.id; // Assuming user ID is available in req.user after authentication

        const project = new Project(req.body);
        const savedProject = await project.save();
        res.status(201).json(savedProject);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT route to update an existing project
router.put('/:id', ensureAuthenticated, checkProjectAccess, async (req, res) => {
    const id = req.params.id;
    try {
        const updatedProject = await Project.findByIdAndUpdate(id, req.body, { new: false });
        if (!updatedProject) {
            return res.status(404).json({ message: "Project not found" });
        }
        res.json(updatedProject);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE route to delete a project
router.delete('/:id', ensureAuthenticated, checkProjectOwner, async (req, res) => {
    const id = req.params.id;
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