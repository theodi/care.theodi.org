const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    sharedWith: [{
        user: {
            type: mongoose.Schema.Types.ObjectId
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
            type: String
        }
    }]
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