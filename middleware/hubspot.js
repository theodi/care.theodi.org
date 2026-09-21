const Hubspot = require('../models/hubspot');
const Project = require('../models/project');
const { userHasActiveOrgEntitlementByEmail } = require('../lib/organisationEntitlements');
const { requireUserFromSession } = require('../lib/sessionUserId');

const checkLimit = async (req, res, next) => {
    try {
        const dbUser = await requireUserFromSession(req);
        const userId = dbUser._id;
        const userEmail = dbUser.email;

        const hubspotUser = await Hubspot.findOne({ userId });
        if (hubspotUser && hubspotUser.membershipStatus === "Active") {
            return next();
        }

        if (userEmail && (await userHasActiveOrgEntitlementByEmail(userEmail))) {
            return next();
        }

        require("dotenv").config({ path: "./config.env" });
        const freeLimit = parseInt(process.env.FREE_PROJECT_LIMIT);

        const projectCount = await Project.countDocuments({ owner: userId });
        if (projectCount >= freeLimit) {
            const error = new Error(`You have reached the limit of ${freeLimit} free projects.`);
            error.status = 403;
            throw error;
        }

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
        const dbUser = await requireUserFromSession(req);
        const hubspotUser = await Hubspot.findOne({ userId: dbUser._id });
        if (hubspotUser && hubspotUser.membershipStatus === 'Active') {
            return next();
        }
        if (dbUser.email && (await userHasActiveOrgEntitlementByEmail(dbUser.email))) {
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
