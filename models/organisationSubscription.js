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
    /** Admin-configured AI (merged over server env in /assistant when members use organisation AI). */
    organisationAi: {
      enabled: { type: Boolean, default: false },
      provider: String,
      apiKey: String,
      model: String,
      baseURL: String,
      maxTokens: Number,
      openaiApiVersion: String,
      useApiKeyHeader: { type: Boolean, default: false },
      anthropicBaseUrl: String,
      googleBaseUrl: String,
      disableStructuredOutput: { type: Boolean, default: false },
      openaiUseLegacyMaxTokens: { type: Boolean, default: false },
      reasoningEnabled: { type: Boolean, default: false },
      reasoningLevel: {
        type: String,
        enum: ['minimal', 'standard', 'extensive'],
        default: 'standard',
      },
    },
    /** Optional per-stage text appended to AI user prompts when members opt in. */
    organisationScanContext: {
      completeAssessment: { type: String, default: '' },
      intendedConsequences: { type: String, default: '' },
      unintendedConsequences: { type: String, default: '' },
      stakeholders: { type: String, default: '' },
    },
  },
  { collection: 'OrganisationSubscriptions', timestamps: true }
);

organisationSubscriptionSchema.index({ emailDomain: 1 });

module.exports = mongoose.model('OrganisationSubscription', organisationSubscriptionSchema);
