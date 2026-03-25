const fs = require('fs').promises;
const path = require('path');

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const User = require('../models/user');
const OrganisationSubscription = require('../models/organisationSubscription');

const { chatCompletion } = require('../services/aiChat');
const { parseModelJsonResponse } = require('../services/parseAIJson');
const { findMembershipForEmail } = require('../lib/organisationEntitlements');
const { orgAiToRuntimeOverrides } = require('../lib/organisationAiConfig');
const {
  getScanContextForMessageId,
  replaceOrgContextPlaceholder,
} = require('../lib/organisationScanContext');

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');


// Middleware to ensure user is authenticated
async function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/login'); // Redirect to login page if not authenticated
}

router.get('/:id/:messageId', ensureAuthenticated, checkProjectAccess, loadProject, async (req, res, next) => {
    try {
        const projectData = res.locals.project;
        const messageId = req.params.messageId;
        // Get the merge query parameter from the URL
        const merge = req.query.merge === 'true'; // Convert to boolean
        const schema = require('../public/data/schemas/partials/'+messageId+'.json');
        projectData.schema = JSON.stringify(schema);
        const message = await populateMessage(messageId, projectData);
        const orgContext = await resolveOrganisationScanContextAppend(req, messageId);
        const userPrompt = replaceOrgContextPlaceholder(message, orgContext);
        const orgOverrides = await resolveOrganisationAiOverrides(req);
        const response = await getAIReponse(userPrompt, messageId, schema, orgOverrides);
        const parsedResponse = parseModelJsonResponse(response);

        // Check if the messageId is "completeAssessment"
        if (messageId === "completeAssessment") {
            // Call the completeAssessment function
            const summary = await completeAssessment(parsedResponse, projectData, merge);
            res.json(summary)
        } else {
            // If it's not completeAssessment, send the parsedResponse back to the client
            res.json(parsedResponse);
        }
    } catch (error) {
        console.error(error);
        // Handle errors
        res.status(500).json({ message: "Internal server error" });
    }
});

async function completeAssessment(parsedResponse, projectData, merge = true) {
    // Merge the parsed data into the existing project data if merge is true
    if (merge) {
        // Merge the parsed data into the existing project data
        projectData.intendedConsequences = [
            ...(projectData.intendedConsequences || []),
            ...(parsedResponse.intendedConsequences || [])
        ];
        projectData.unintendedConsequences = [
            ...(projectData.unintendedConsequences || []),
            ...(parsedResponse.unintendedConsequences || [])
        ];
        projectData.stakeholders = [
            ...(projectData.stakeholders || []),
            ...(parsedResponse.stakeholders || [])
        ];
    } else {
        // Overwrite the existing project data with the parsed data
        projectData.intendedConsequences = parsedResponse.intendedConsequences || [];
        projectData.unintendedConsequences = parsedResponse.unintendedConsequences || [];
        projectData.stakeholders = parsedResponse.stakeholders || [];
    }
    // Save the updated project data to the database
    await Project.findByIdAndUpdate(projectData._id, projectData);

    // Calculate the counts
    const intendedConsequencesCount = projectData.intendedConsequences.length;
    const unintendedConsequencesCount = projectData.unintendedConsequences.length;
    const stakeholdersCount = projectData.stakeholders.length;

    // Return the counts as a JSON object
    return {
        intendedConsequencesCount,
        unintendedConsequencesCount,
        stakeholdersCount
    };
}

async function populateMessage(messageId, data) {
    const filePath = path.join(__dirname, '../public/data/messageTemplates/', messageId + '.txt');
    const message = await fs.readFile(filePath, 'utf8');
    if (!message) {
      console.error(`Message with ID '${messageId}' not found.`);
      return null;
    }

    let populatedText = message;

    // Convert Mongoose object to plain JavaScript object
    const plainData = data.toObject();

    // Replace placeholders with actual data
    for (const key in plainData) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        let value = plainData[key];
        if (typeof value === 'object') {
            // If the value is a JSON object, stringify it
            value = JSON.stringify(value);
        }
        populatedText = populatedText.replace(regex, value);
    }
    for (const key in data) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        populatedText = populatedText.replace(regex, data[key]);
    }

    return populatedText;
}

/**
 * When aiSource=built_in (or builtin), use only server env config.
 * Otherwise use organisation AI overrides if the user has a configured org; else env only.
 */
function includeOrgContextRequested(req) {
  const q = req.query && req.query.includeOrgContext;
  if (q == null || q === '') return false;
  const s = String(q).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

async function resolveOrganisationScanContextAppend(req, messageId) {
  if (!includeOrgContextRequested(req)) return '';
  const passportUser = req.session.passport && req.session.passport.user;
  const userId = passportUser && passportUser.id;
  if (!userId) return '';
  const user = await User.findById(userId);
  if (!user || !user.email) return '';
  const m = await findMembershipForEmail(user.email);
  if (!m || !m.subscriptionId) return '';
  const subId = m.subscriptionId._id || m.subscriptionId;
  const sub = await OrganisationSubscription.findById(subId);
  return getScanContextForMessageId(sub && sub.organisationScanContext, messageId);
}

async function resolveOrganisationAiOverrides(req) {
    const raw = (req.query && req.query.aiSource) || '';
    const src = String(raw).toLowerCase().replace(/-/g, '_');
    if (src === 'built_in' || src === 'builtin' || src === 'default_env') {
        return {};
    }
    const passportUser = req.session.passport && req.session.passport.user;
    const userId = passportUser && passportUser.id;
    if (!userId) return {};
    const user = await User.findById(userId);
    if (!user || !user.email) return {};
    const m = await findMembershipForEmail(user.email);
    if (!m || !m.subscriptionId) return {};
    const subId = m.subscriptionId._id || m.subscriptionId;
    const sub = await OrganisationSubscription.findById(subId);
    const ov = orgAiToRuntimeOverrides(sub && sub.organisationAi);
    return ov || {};
}

async function getAIReponse(message, messageId, rawSchema, orgOverrides) {
    const rawClone = JSON.parse(JSON.stringify(rawSchema));
    return chatCompletion([{ role: 'user', content: message }], {
        ...orgOverrides,
        structuredResponse: {
            schemaName: `care_${messageId}`,
            rawSchema: rawClone,
        },
    });
}

module.exports = router;