// Open AI

const express = require('express');
const router = express.Router();
const Project = require('../models/project');
const messageData = require('../public/data/aiTemplates.json');

const OpenAI = require("openai");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
        const schema = require('../schemas/partials_ai/'+messageId+'.json');
        projectData.schema = JSON.stringify(schema);
        const message = await populateMessage(messageId, projectData);;
        const response = await getAIReponse(message);

        // Parse the AI response JSON string
        const parsedResponse = JSON.parse(response);

        // Check if the messageId is "completeAssessment"
        if (messageId === "completeAssessment") {
            // Call the completeAssessment function
            await completeAssessment(parsedResponse, projectData);
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
    const message = messageData.messages[messageId];
    if (!message) {
      console.error(`Message with ID '${messageId}' not found.`);
      return null;
    }

    let populatedText = message.message;

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

async function getAIReponse(message) {
    const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: message }],
        model: "gpt-4o",
    });
    return completion.choices[0].message.content;
}

module.exports = router;