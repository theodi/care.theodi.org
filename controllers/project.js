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

module.exports = { getUserProjects };