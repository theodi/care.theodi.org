// routes/projects.js

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const projectController = require('../controllers/project');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { buildDocx } = require('../lib/docxBuilder'); // Import the buildDocx function
const docx = require('docx');

// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
}

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');
const { checkLimit } = require('../middleware/hubspot');
const { updateToolStatistics } = require('../controllers/hubspot');

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
        const sharedUsers = project.sharedWith.map(user => user.user);

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
        const index = project.sharedWith.findIndex(user => user.user === userId);

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

// GET route to retrieve a project by ID
router.get('/:id/:page', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        // Find the project by ID
        const project = res.locals.project;

        // Content negotiation based on request Accept header
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            // Respond with JSON (filter it according to the schema?)
            return res.json(project);
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
            // Respond with JSON (filter it according to the schema?)
            return res.json(project);
        } else if (acceptHeader === 'text/csv') {
            // Respond with CSV
            const fields = ['consequence', 'outcome', 'impact', 'likelihood', 'role', 'action.description', 'action.date', 'action.stakeholder', 'action.KPI'];
            const opts = { fields };
            const csv = parse(project.unintendedConsequences, opts);

            res.setHeader('Content-Disposition', `attachment; filename=${project.title.replace(/\s+/g, '_').trim()}.csv`);
            res.setHeader('Content-Type', 'text/csv');
            return res.send(csv);
        } else if (acceptHeader === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // Respond with DOCX
            project = await projectController.addRiskScoreToProject(project);
            const userProjects = [];
            userProjects.push(project);
            let metrics = await projectController.getUserProjectMetrics(userProjects);
            const tempFilePath = await buildDocx(project,metrics);
            const fileName = `${project.title.replace(/\s+/g, '_').trim()}.docx`;
            //const buffer = await docx.Packer.toBuffer(doc);
            res.set('Content-Disposition', `attachment; filename="${fileName}"`);
            res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.sendFile(path.resolve(tempFilePath), async (err) => {
                if (err) {
                    console.error("Error sending file:", err);
                } else {
                    // Cleanup temporary file after sending
                    try {
                        await fs.promises.unlink(tempFilePath);
                    } catch (error) {
                        console.error("Error deleting temporary file:", error);
                    }
                }
            });
        } else {
            let page = {
                link: "/finalReport",
                title: "Project evaluation"
            };
            res.locals.page = page;
            res.render('pages/project', { project: project });
        }
    } catch (error) {
        next(error); // Pass error to error handling middleware
    }
});
// POST route to create a new project
router.post('/', ensureAuthenticated, checkLimit, async (req, res) => {
    try {
        // Set owner field to the ID of the authenticated user
        const user = req.session.passport.user;
        req.body.owner = user.id; // Assuming user ID is available in req.user after authentication

        const project = new Project(req.body);
        const savedProject = await project.save();
        if (req.session.authMethod !== 'local') {
            updateToolStatistics(req.session.passport.user.id);
        }
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
        if (req.session.authMethod !== 'local') {
            updateToolStatistics(req.session.passport.user.id);
        }
        res.json(updatedProject);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE route to delete a project
router.delete('/:id', ensureAuthenticated, checkProjectOwner, async (req, res) => {
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