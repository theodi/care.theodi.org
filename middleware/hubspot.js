const Hubspot = require('../models/hubspot');
const Project = require('../models/project');

const checkLimit = async (req, res, next) => {
    try {
        const user = req.session.passport.user;
        const userId = user.id; // Assuming user ID is available in req.user after authentication

        // 1. Look up the user in the HubSpot table to find if membershipStatus is "Active"
        const hubspotUser = await Hubspot.findOne({ userId });
        if (hubspotUser && hubspotUser.membershipStatus === "Active") {
            // If membershipStatus is active, proceed to the next middleware or route handler
            return next();
        }

        require("dotenv").config({ path: "./config.env" });
        // 2. Read FREE_PROJECT_LIMIT from the config.env
        const freeLimit = parseInt(process.env.FREE_PROJECT_LIMIT);

        // 3. Look up how many existing projects the user has to ensure it is below the limit
        const projectCount = await Project.countDocuments({ owner: userId });
        //console.log(projectCount);
        if (projectCount >= freeLimit) {
            const error = new Error(`You have reached the limit of ${freeLimit} free projects.`);
            error.status = 403;
            throw error;
        }

        // If the user does not have an active membership and has not reached the project limit, proceed to the next middleware or route handler
        next();
    } catch (error) {
        return next(error);
    }
}

module.exports = { checkLimit };