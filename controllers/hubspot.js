const mongoose = require('mongoose');
const Hubspot = require('../models/hubspot');
const User = require('../models/user');
const hubspot = require('@hubspot/api-client');
const projectController = require('../controllers/project');

require("dotenv").config({ path: "../config.env" });
const hubspotKey = process.env.HUBSPOT_API_KEY;

const hubspotClient = new hubspot.Client({ accessToken: hubspotKey })

async function getHubspotUser(userId, email) {
    try {
        const contactSearchRequest = {
            filterGroups: [
                {
                    filters: [
                        {
                            propertyName: "email",
                            operator: "EQ",
                            value: email
                        }
                    ]
                }
            ],
            properties: ["email", "firstname", "lastname", "associatedcompanyid", "odi_membership__active_or_lapsed__", "odi_member_partner_type"]
        };

        const contactResponse = await hubspotClient.crm.contacts.searchApi.doSearch(contactSearchRequest);

        if (!contactResponse || !contactResponse.results || contactResponse.results.length === 0) {
            await Hubspot.findOneAndUpdate(
                { userId },
                { $unset: { hubSpotId: "" } }
            );
            console.warn("No Hubspot contact found for email; cleared any stale hubSpotId:", email);
            return;
        }

        const companyId = contactResponse.results[0].properties.associatedcompanyid;
        const hubSpotId = contactResponse.results[0].id;
        let membershipStatus = contactResponse.results[0].properties.odi_membership__active_or_lapsed__;
        let membershipType = contactResponse.results[0].properties.odi_member_partner_type;
        let companyMembership = false;

        // If companyId is valid, fetch company details
        if (companyId) {
            try {
                const companySearchRequest = {
                    filterGroups: [
                        {
                            filters: [
                                {
                                    propertyName: "hs_object_id",
                                    operator: "EQ",
                                    value: companyId
                                }
                            ]
                        }
                    ],
                    properties: ["name", "odi_membership_status__active_or_lapsed__", "member_partner_type_org_"]
                };
                const companyResponse = await hubspotClient.crm.companies.searchApi.doSearch(companySearchRequest);

                if (companyResponse && companyResponse.results && companyResponse.results.length > 0) {
                    if (companyResponse.results[0].properties.odi_membership_status__active_or_lapsed__ === "Active") {
                        companyMembership = true;
                        membershipStatus = "Active";
                        membershipType = companyResponse.results[0].properties.member_partner_type_org_;
                    }
                }
            } catch (companyError) {
                console.warn("Error fetching company details:", companyError);
                // Continue without company details if there's an error fetching them
            }
        }

        // Check if a record with the hubSpotId already exists
        let existingRecord = await Hubspot.findOne({ hubSpotId });

        if (existingRecord) {
            // Update the existing record
            existingRecord.userId = userId;
            existingRecord.companyMembership = companyMembership;
            existingRecord.membershipStatus = membershipStatus;
            existingRecord.membershipType = membershipType;

            await existingRecord.save();
        } else {
            // Create a new record
            const newRecord = new Hubspot({
                userId,
                hubSpotId,
                companyMembership,
                membershipStatus,
                membershipType
            });

            await newRecord.save();
        }
    } catch (error) {
        console.error("Error in getHubspotUser:", error);
    }
}

async function getHubspotProfile(userId) {
    try {
        // Find the user record in the Hubspot table with the provided userId
        const hubspotProfile = await Hubspot.findOne({ userId });
        return hubspotProfile;
    } catch (error) {
        console.error("Error in getHubspotProfile:", error);
        return null;
    }
}

async function updateToolStatistics(userId) {
    let hubSpotId = null;
    try {
        // Get the user profile from the user table (firstLogin, lastLogin)
        const user = await User.findById(userId);

        // Format dates into DD/MM/YYYY format
        const formatDate = date => {
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${year}-${month}-${day}`;
        };

        const firstLogin = formatDate(user.firstLogin);
        const lastLogin = formatDate(new Date());

        // Get the hubspot profile
        const hubspotProfile = await getHubspotProfile(userId);
        hubSpotId = hubspotProfile ? hubspotProfile.hubSpotId : null;

        // Get the projects data
        const userProjects = await projectController.getUserProjects(userId);
        const projects = userProjects.ownedProjects.projects;
        // Calculate statistics
        const totalAssessments = projects.length;
        const completedAssessments = projects.filter(project => project.status === 'done').length;

        // Prepare the data to be patched to Hubspot
        const patchData = {
            properties: {
                completed_assessments: completedAssessments,
                first_login__care_: firstLogin,
                last_login__care_: lastLogin,
                login_count__care_: user.loginCount,
                total_assessments: totalAssessments
            }
        };

        if (hubSpotId) {
            await hubspotClient.crm.contacts.basicApi.update(hubSpotId, patchData);
        } else {
            console.warn("Hubspot profile not found for user with ID:", userId);
        }
    } catch (error) {
        console.error("Error in updateToolStatistics:", error);
        if (error.code === 404 && hubSpotId) {
            try {
                await Hubspot.findOneAndUpdate(
                    { userId },
                    { $unset: { hubSpotId: "" } }
                );
                console.warn("Cleared stale hubSpotId after HubSpot 404 for user:", userId);
            } catch (clearErr) {
                console.warn("Could not clear stale HubSpot id:", clearErr);
            }
        }
    }
}

async function updateCareAccountStatus(userId, status) {
    let hubSpotId = null;
    try {
        const allowedStatuses = new Set(["active", "deleted"]);
        if (!allowedStatuses.has(status)) {
            console.warn("Invalid care account status for HubSpot update:", status);
            return;
        }

        const hubspotProfile = await getHubspotProfile(userId);
        hubSpotId = hubspotProfile ? hubspotProfile.hubSpotId : null;

        if (!hubSpotId) {
            // Recover when local Hubspot mapping is missing by syncing from user email.
            const user = await User.findById(userId).select('email');
            if (user && user.email) {
                await getHubspotUser(userId, user.email);
                const refreshedHubspotProfile = await getHubspotProfile(userId);
                hubSpotId = refreshedHubspotProfile ? refreshedHubspotProfile.hubSpotId : null;
            }
        }

        if (!hubSpotId) {
            console.warn("Hubspot contact not found for care_account_status update, user ID:", userId);
            return;
        }

        const patchData = {
            properties: {
                care_account_status: status
            }
        };

        await hubspotClient.crm.contacts.basicApi.update(hubSpotId, patchData);
    } catch (error) {
        console.error("Error in updateCareAccountStatus:", error);
        if (error.code === 404 && hubSpotId) {
            try {
                await Hubspot.findOneAndUpdate(
                    { userId },
                    { $unset: { hubSpotId: "" } }
                );
                console.warn("Cleared stale hubSpotId after HubSpot 404 for user:", userId);
            } catch (clearErr) {
                console.warn("Could not clear stale HubSpot id:", clearErr);
            }
        }
    }
}


module.exports = { getHubspotUser, getHubspotProfile, updateToolStatistics, updateCareAccountStatus };