const mongoose = require('mongoose');
const Project = require('../models/project');
const User = require('../models/user'); // Import the User model

async function getUserProjects(userId) {
    try {
        // Convert userId string to ObjectId
        const userIdObjectId = new mongoose.Types.ObjectId(userId);

        // Find all projects where the user is the owner
        const ownedProjects = await Project.find({ owner: userIdObjectId });

        // Find all projects shared with the user
        const sharedProjects = await Project.find({ sharedWith: userIdObjectId });

        // Fetch owner names for shared projects only
        const sharedProjectsPromises = sharedProjects.map(async project => {
            const owner = await User.findById(project.owner);
            return {
                id: project._id,
                title: project.title,
                owner: owner ? owner.name : "Unknown", // Use owner's name or "Unknown" if not found
                lastModified: project.lastModified
            };
        });
        const filteredSharedProjects = await Promise.all(sharedProjectsPromises);

        // Return an object with two arrays: one for owned projects and one for shared projects
        return {
            ownedProjects: ownedProjects.map(project => ({
                id: project._id,
                title: project.title,
                owner: project.owner,
                lastModified: project.lastModified
            })),
            sharedProjects: filteredSharedProjects
        };
    } catch (error) {
        throw error; // Propagate the error to the caller
    }
}

// Function to calculate completion state for a section
async function getCompletionState(projectId, sectionSchema) {
    try {
        // Find the project by ID
        const project = await Project.findById(projectId);
        // If the project is not found, return "Todo"
        if (!project) {
            return "Todo";
        }

        let allDone = true;
        let someDone = false;
        // Extract data for the section based on the schema
        for (const key in sectionSchema) {
            if (!project[key] || (Array.isArray(project[key]) && project[key].length === 0)) {
                allDone = false;
            } else {
                someDone = true;
                // Check if it's an array of objects
                if (Array.isArray(project[key]) && sectionSchema[key].type === 'array' && sectionSchema[key].items) {
                    const requiredProperties = Object.keys(sectionSchema[key].items.properties || {});
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
        console.error("Error calculating completion state:", error);
        return "Error";
    }
}

module.exports = { getUserProjects, getCompletionState };