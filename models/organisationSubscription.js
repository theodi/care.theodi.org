const mongoose = require('mongoose');

/** Commercial period for a tenant (seats, plan, dates). Tenant-scoped settings live on Tenant. */
const organisationSubscriptionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    planTier: { type: String, enum: ['silver', 'gold'], required: true },
    seatLimit: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hubspotCompanyId: String,
    hubspotDealId: String,
    lastHubSpotSyncAt: Date,
  },
  { collection: 'OrganisationSubscriptions', timestamps: true }
);

organisationSubscriptionSchema.index({ tenantId: 1 });
organisationSubscriptionSchema.index({ tenantId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('OrganisationSubscription', organisationSubscriptionSchema);
