const Hubspot = require('../models/hubspot');
const Project = require('../models/project');
const { userHasActiveOrgEntitlementByEmail } = require('../lib/organisationEntitlements');

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

        if (user.email && (await userHasActiveOrgEntitlementByEmail(user.email))) {
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
};

/**
 * AI assistant routes: same entitlement as unlimited projects — active ODI membership (HubSpot)
 * or an active organisation subscription seat.
 */
const requireAiEntitlement = async (req, res, next) => {
    try {
        const user = req.session.passport.user;
        if (!user || !user.id) {
            const err = new Error('Unauthorized');
            err.status = 401;
            throw err;
        }
        const hubspotUser = await Hubspot.findOne({ userId: user.id });
        if (hubspotUser && hubspotUser.membershipStatus === 'Active') {
            return next();
        }
        if (user.email && (await userHasActiveOrgEntitlementByEmail(user.email))) {
            return next();
        }
        return res.status(403).json({
            message:
                'AI features require ODI membership or an active organisation subscription.',
        });
    } catch (error) {
        return next(error);
    }
};

module.exports = { checkLimit, requireAiEntitlement };