const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    sharedWith: [{
        user: {
            type: String
        }
    }],
    lastModified: {
        type: Date,
        default: Date.now // Default value is the current date/time
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
            }
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
    }
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