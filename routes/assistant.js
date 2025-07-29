const fs = require('fs').promises;
const path = require('path');

const express = require('express');
const router = express.Router();
const Project = require('../models/project');

const OpenAI = require("openai");
const { zodTextFormat } = require("openai/helpers/zod");
const { z } = require('zod');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const { loadProject, checkProjectAccess, checkProjectOwner } = require('../middleware/project');

// Zod schemas for structured responses
const ActionSchema = z.object({
  description: z.string().min(1, "Action description is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  stakeholder: z.string().min(1, "Stakeholder is required"),
  KPI: z.string().min(1, "KPI is required")
});

const UnintendedConsequenceSchema = z.object({
  consequence: z.string().min(1, "Consequence description is required"),
  outcome: z.enum(["", "Positive", "Negative"]),
  impact: z.enum(["", "High", "Medium", "Low"]),
  likelihood: z.enum(["", "High", "Medium", "Low"]),
  role: z.enum(["", "Act", "Influence", "Monitor"]),
  action: ActionSchema
});

const IntendedConsequenceSchema = z.object({
  consequence: z.string().min(1, "Consequence description is required")
});

const StakeholderSchema = z.object({
  stakeholder: z.string().min(1, "Stakeholder name is required"),
  type: z.enum(["", "Internal", "External"])
});

const CompleteAssessmentSchema = z.object({
  intendedConsequences: z.array(IntendedConsequenceSchema).min(1, "At least one intended consequence is required"),
  unintendedConsequences: z.array(UnintendedConsequenceSchema).min(1, "At least one unintended consequence is required"),
  stakeholders: z.array(StakeholderSchema).min(1, "At least one stakeholder is required")
});

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
        
        // Get the appropriate schema based on messageId
        const zodSchema = getSchemaForMessageId(messageId);
        
        const message = await populateMessage(messageId, projectData);
        const response = await getAIResponse(message, messageId, zodSchema);
        
        // Validate the response using Zod
        const validatedResponse = validateResponse(response, messageId);

        // Check if the messageId is "completeAssessment"
        if (messageId === "completeAssessment") {
            // Call the completeAssessment function
            const summary = await completeAssessment(validatedResponse, projectData, merge);
            res.json(summary)
        } else {
            // If it's not completeAssessment, send the validated response back to the client
            res.json(validatedResponse);
        }
    } catch (error) {
        console.error('Error in assistant route:', error);
        
        // Handle validation errors specifically
        if (error.name === 'ZodError') {
            return res.status(400).json({ 
                message: "AI response validation failed", 
                errors: error.errors,
                details: "The AI response did not match the expected schema format"
            });
        }
        
        // Handle other errors
        res.status(500).json({ message: "Internal server error" });
    }
});

function getSchemaForMessageId(messageId) {
    const schemas = {
        'completeAssessment': CompleteAssessmentSchema,
        'intendedConsequences': z.object({
            intendedConsequences: z.array(IntendedConsequenceSchema)
        }),
        'unintendedConsequences': z.object({
            unintendedConsequences: z.array(UnintendedConsequenceSchema)
        }),
        'stakeholders': z.object({
            stakeholders: z.array(StakeholderSchema)
        })
    };
    
    return schemas[messageId] || CompleteAssessmentSchema;
}

function validateResponse(response, messageId) {
    const schema = getSchemaForMessageId(messageId);
    return schema.parse(response);
}

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

async function getAIResponse(message, messageId, schema) {
    const response = await openai.responses.parse({
        model: "gpt-4o-mini",
        input: [
            { role: "user", content: message }
        ],
        text: {
            format: zodTextFormat(schema, "assessment_data"),
        },
    });

    return response.output_parsed;
}

module.exports = router;