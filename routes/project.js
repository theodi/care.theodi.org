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

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');

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
        res.render('pages/completeAssessment', { project: project });
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});

// GET route to retrieve a project by ID
router.get('/:id/:page?', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        const project = res.locals.project;

        // Content negotiation based on request Accept header
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            // Respond with JSON
            return res.json(project);
        } else {
            // Respond with HTML (rendering scan.ejs)
            let page = {
                link: "projectDetails",
                title: "Project details"
            };
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