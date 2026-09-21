const mongoose = require('mongoose');
const OrganisationSubscription = require('../models/organisationSubscription');

/**
 * Build Mongo query for projects visible to tenant integration API
 * (shared with organisation / tenant, including legacy subscription id).
 */
async function buildTenantSharedProjectsFilter(tenantId) {
  const tid =
    tenantId instanceof mongoose.Types.ObjectId
      ? tenantId
      : new mongoose.Types.ObjectId(String(tenantId));
  const subsForTenant = await OrganisationSubscription.find({ tenantId: tid }).select('_id').lean();
  const legacySubscriptionIds = subsForTenant.map((s) => s._id);
  return {
    sharedWithOrganisation: true,
    $or: [
      { tenantId: tid },
      ...(legacySubscriptionIds.length ? [{ organisationSubscriptionId: { $in: legacySubscriptionIds } }] : []),
    ],
  };
}

module.exports = { buildTenantSharedProjectsFilter };
