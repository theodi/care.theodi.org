const mongoose = require('mongoose');

const aiSelectionSchema = new mongoose.Schema(
    {
        appliedAt: { type: String },
        indices: [{ type: Number }],
        items: [mongoose.Schema.Types.Mixed],
    },
    { _id: false }
);

const aiInteractionHistorySchema = new mongoose.Schema(
    {
        runId: { type: String, required: true },
        stepId: { type: String, required: true },
        pipelineRunId: { type: String },
        startedAt: { type: String },
        completedAt: { type: String },
        aiSource: { type: String, enum: ['organisation', 'built_in'] },
        model: { type: mongoose.Schema.Types.Mixed },
        includeExistingStepData: { type: Boolean },
        includeOrganisationContext: { type: Boolean },
        promptFull: { type: String },
        rawResponseText: { type: String },
        normalizedResult: { type: mongoose.Schema.Types.Mixed },
        suggestions: [mongoose.Schema.Types.Mixed],
        reasoning: { type: String },
        status: { type: String, enum: ['completed', 'failed'] },
        error: { type: String },
        selections: [aiSelectionSchema],
    },
    { _id: false }
);

const projectSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    /** Email of the user who created this evaluation. */
    createdBy: {
        type: String,
    },
    /** When this evaluation was first created. */
    createdAt: {
        type: Date,
        default: Date.now,
    },
    sharedWith: [{
        user: {
            type: String
        }
    }],
    /** When this evaluation was last modified (any field). */
    lastModified: {
        type: Date,
        default: Date.now // Default value is the current date/time
    },
    /** Email of the user who last modified this evaluation. */
    lastModifiedBy: {
        type: String,
    },
    title: {
        type: String,
        required: true
    },
    objectives: {
        type: String
    },
    dataUsed: {
        type: String
    },
    stakeholders: [{
        stakeholder: {
            type: String
        },
        type: {
            type: String,
            enum: ['Internal', 'External'],
            default: '' // Default value is an empty string
        }
    }],
    intendedConsequences: [{
        consequence: {
            type: String,
            required: true
        }
    }],
    unintendedConsequences: [{
        consequence: {
            type: String,
            required: true
        },
        outcome: {
            type: String,
            enum: ['Positive', 'Negative']
        },
        impact: {
            type: String,
            enum: ['High', 'Medium', 'Low']
        },
        likelihood: {
            type: String,
            enum: ['High', 'Medium', 'Low']
        },
        riskScore: {
            type: Number
        },
        role: {
            type: String,
            enum: ['Act', 'Influence', 'Monitor']
        },
        /** Provenance for this risk row (stored as plain strings/dates). */
        createdBy: {
            type: String,
        },
        createdAt: {
            type: String,
        },
        lastModifiedBy: {
            type: String,
        },
        lastModifiedAt: {
            type: String,
        },
        action: {
            description: {
                type: String
            },
            date: {
                type: String
            },
            stakeholder: {
                type: String
            },
            KPI: {
                type: String
            },
            completed: {
                type: String,
                enum: ['', 'Completed', 'Not completed'],
                default: ''
            },
            completedAt: {
                type: String
            },
            completionComment: {
                type: String
            },
            /** Provenance for this action and its completion. */
            createdBy: {
                type: String,
            },
            createdAt: {
                type: String,
            },
            lastModifiedBy: {
                type: String,
            },
            lastModifiedAt: {
                type: String,
            },
            completedBy: {
                type: String,
            },
        }
    }],
    riskCounts: {
        unclassified: {
            type: Number
        },
        high: {
            type: Number
        },
        medium: {
            type: Number
        },
        low: {
            type: Number
        }
    },
    /** Tenant (master) for org-wide sharing; survives subscription renewals. */
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
    },
    /** @deprecated Prefer tenantId; set only until DB migration runs. */
    organisationSubscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OrganisationSubscription',
    },
    sharedWithOrganisation: {
        type: Boolean,
        default: false,
    },
    /** Customer reference for PM / middleware (set by org admins or project managers); exposed on integration API. */
    integrationExternalId: {
        type: String,
        trim: true,
        maxlength: 256,
        default: undefined,
    },
    /** Append-only AI audit trail; only server should $push (not via generic PUT). */
    aiInteractionHistory: {
        type: [aiInteractionHistorySchema],
        default: undefined,
    },
}, {
    collection: 'Projects' // Specify the collection name
});

// Middleware to update lastModified before saving the project
projectSchema.pre('save', function(next) {
    this.lastModified = new Date(); // Update lastModified to the current date/time
    next();
});

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;