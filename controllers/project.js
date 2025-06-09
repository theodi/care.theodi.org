const mongoose = require('mongoose');
const Project = require('../models/project');
const User = require('../models/user'); // Import the User model

async function getUserProjects(userId) {
    try {
        // Convert userId string to ObjectId
        const userIdObjectId = new mongoose.Types.ObjectId(userId);
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const userEmail = user.email;

        // Find all projects where the user is the owner
        const ownedProjects = await Project.find({ owner: userIdObjectId });
        for (const project of ownedProjects) {
            // Update the project object in place with risk scores
            addRiskScoreToProject(project);
            const temp = [];
            temp.push(project);
            const tempMetrics = await getUserProjectMetrics(temp);
            project.riskCounts = tempMetrics.riskCounts;
        }

        // Find all projects shared with the user
        const sharedProjects = await Project.find({ "sharedWith.user": userEmail });

        const schemaPath = `../public/data/schemas/project.json`;
        const schema = require(schemaPath);

        // Fetch owner names for shared projects only
        const sharedProjectsPromises = sharedProjects.map(async project => {
            const owner = await User.findById(project.owner);
            const status = await getCompletionState(project._id,schema);
            return {
                id: project._id,
                title: project.title,
                owner: owner ? owner.name : "Unknown", // Use owner's name or "Unknown" if not found
                lastModified: project.lastModified,
                status: status
            };
        });
        const filteredSharedProjects = await Promise.all(sharedProjectsPromises);

        const ownedProjectsPromises = ownedProjects.map(async project => {
            const status = await getCompletionState(project._id,schema);
            return {
                id: project._id,
                title: project.title,
                owner: project.owner,
                lastModified: project.lastModified,
                riskCounts: project.riskCounts,
                status: status
            };
        });
        const ownedProjectsStatus = await Promise.all(ownedProjectsPromises);

        const metrics = await getUserProjectMetrics(ownedProjects);

        return {
            ownedProjects: {
                projects: ownedProjectsStatus,
                riskCounts: metrics.riskCounts,
                averages: metrics.averages,
                topRisks: metrics.topRisks
            },
            sharedProjects: filteredSharedProjects
        };
    } catch (error) {
        throw error; // Propagate the error to the caller
    }
}

async function getUserProjectMetrics(userProjects) {
    let riskCounts = {
        "unclassified": 0,
        "high": 0,
        "medium": 0,
        "low": 0
    };

    let totalLikelihood = 0;
    let totalImpact = 0;
    let totalRiskScore = 0;
    let totalUnintendedConsequences = 0;

    let topRisks = [];

    for (const project of userProjects) {
        // Update the project object in place with risk scores

        // Iterate over unintended consequences of the project
        for (const unintendedConsequence of project.unintendedConsequences) {
            if (!unintendedConsequence || unintendedConsequence.outcome === "Positive") {
                continue; // Skip positive unintended consequences
            }
            // Increment the corresponding risk count category based on the risk score
            if (unintendedConsequence.riskScore === null) {
                riskCounts.unclassified++;
            } else if (unintendedConsequence.riskScore >= 6) {
                riskCounts.high++;
            } else if (unintendedConsequence.riskScore >= 3) {
                riskCounts.medium++;
            } else {
                riskCounts.low++;
            }

            // Calculate total likelihood, impact, and risk score
            if (unintendedConsequence.likelihood && unintendedConsequence.impact) {
                totalLikelihood += getRiskValue(unintendedConsequence.likelihood);
                totalImpact += getRiskValue(unintendedConsequence.impact);
                totalRiskScore += unintendedConsequence.riskScore;
                totalUnintendedConsequences++;
            }

            // Add the unintended consequence to the top risks array
            if (unintendedConsequence.riskScore !== null) {
                topRisks.push({
                    projectId: project._id,
                    consequence: unintendedConsequence.consequence,
                    score: unintendedConsequence.riskScore,
                    level: getScoreText(unintendedConsequence.riskScore/3)
                });
            }
        }
    }

    // Sort the top risks by risk score in descending order
    topRisks.sort((a, b) => b.score - a.score);

    // Get the top 5 risks
    const top5Risks = topRisks.slice(0, 5);

    // Calculate averages
    const averageLikelihood = (totalLikelihood / totalUnintendedConsequences).toFixed(2);
    const averageImpact = (totalImpact / totalUnintendedConsequences).toFixed(2);
    const averageRiskScore = (totalRiskScore / totalUnintendedConsequences).toFixed(2);

    // Return risk counts, averages, and top 5 risks as a data object
    return {
        riskCounts: riskCounts,
        averages: {
            likelihood: averageLikelihood,
            impact: averageImpact,
            riskScore: averageRiskScore
        },
        topRisks: top5Risks
    };
}

function getRiskValue(textValue) {
    switch (textValue) {
        case 'High':
            return 3;
        case 'Medium':
            return 2;
        case 'Low':
            return 1;
        default:
            return 0;
    }
}

function getScoreText(score) {
    if (score < 1) {
        return 'Low';
    } else if (score < 2) {
        return 'Medium';
    } else {
        return 'High';
    }
}

async function addRiskScoreToProject(project) {
    for (const unintendedConsequence of project.unintendedConsequences) {
        // Check if both impact and likelihood are defined
        if (!unintendedConsequence || unintendedConsequence.outcome === "Positive") {
            continue; // Skip positive outcomes entirely
        }
        if (unintendedConsequence.likelihood && unintendedConsequence.impact) {
            // Calculate risk score for the unintended consequence
            let riskScore = 1; // Default risk score
            switch (unintendedConsequence.likelihood) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown likelihood
                    break;
            }
            switch (unintendedConsequence.impact) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown impact
                    break;
            }
            // Add risk score to the unintended consequence
            unintendedConsequence.riskScore = riskScore;
        } else {
            unintendedConsequence.riskScore = null;
        }
    }
    return project;
}


// Function to calculate completion state for a section
async function getCompletionState(projectId, schema) {
    try {
        // Find the project by ID
        const project = await Project.findById(projectId);
        // If the project is not found, return "Todo"
        if (!project) {
            return "Todo";
        }

        let allDone = true;
        let someDone = false;
        const properties = schema.properties;
        // Extract data for the section based on the schema
        for (const key in properties) {
            if (!project[key] || (Array.isArray(project[key]) && project[key].length === 0)) {
                allDone = false;
            } else {
                someDone = true;
                // Check if it's an array of objects
                if (Array.isArray(project[key]) && properties[key].type === 'array' && properties[key].items) {
                    const requiredProperties = Object.keys(properties[key].items.properties || {});
                    for (const item of project[key]) {
                        const missingProperties = requiredProperties.filter(prop => !item[prop]);
                        if (missingProperties.length > 0) {
                            allDone = false;
                            break; // No need to check further, one item is incomplete
                        }
                    }
                }
            }
        }
        if (allDone) {
            return "done";
        }
        if (someDone) {
            return "inProgress";
        }
        return "todo";
    } catch (error) {
        return "inProgress";
    }
}

async function getProjectOwner(project) {
    try {
        // Validate that the project object has an owner field
        if (!project || !project.owner) {
            throw new Error("Invalid project object or missing owner field");
        }

        // Find the owner user by ID
        const owner = await User.findById(project.owner);
        if (!owner) {
            throw new Error("Owner not found");
        }

        // Return owner details
        return {
            id: owner._id,
            name: owner.name,
            email: owner.email
        };
    } catch (error) {
        console.error("Error retrieving project owner:", error);
        throw error; // Propagate the error to the caller
    }
}

module.exports = { getUserProjects, getCompletionState, getUserProjectMetrics, addRiskScoreToProject, getProjectOwner };