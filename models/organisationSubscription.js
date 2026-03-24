const mongoose = require('mongoose');

const organisationSubscriptionSchema = new mongoose.Schema(
  {
    organisationName: { type: String, required: true },
    emailDomain: { type: String, required: true },
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

organisationSubscriptionSchema.index({ emailDomain: 1 });

module.exports = mongoose.model('OrganisationSubscription', organisationSubscriptionSchema);
