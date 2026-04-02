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
    /**
     * Legacy flat per-step strings (migrated automatically when reading if guidance items are empty).
     * Cleared when saving the new guidance list.
     */
    organisationScanContext: {
      completeAssessment: { type: String, default: '' },
      intendedConsequences: { type: String, default: '' },
      unintendedConsequences: { type: String, default: '' },
      stakeholders: { type: String, default: '' },
      riskEvaluation: { type: String, default: '' },
      actionPlanning: { type: String, default: '' },
    },
    /** Titled guidance blocks, each applied to one or more scan steps (preferred over organisationScanContext). */
    organisationScanGuidanceItems: [
      {
        title: { type: String, default: '' },
        content: { type: String, default: '' },
        stages: [
          {
            type: String,
            enum: [
              'completeAssessment',
              'intendedConsequences',
              'unintendedConsequences',
              'stakeholders',
              'riskEvaluation',
              'actionPlanning',
            ],
          },
        ],
      },
    ],
    /** Custom Word export template (validated {{patch}} placeholders); file on disk under uploads/org-report-templates/{id}.docx */
    reportTemplateOriginalName: { type: String, default: '' },
    reportTemplateUploadedAt: { type: Date },
    /** Last auto-detected accent from uploaded template (Heading 1 / theme); exports re-parse the file. */
    reportAccentDetectedHex: { type: String, default: '' },
  },
  { collection: 'OrganisationSubscriptions', timestamps: true }
);

organisationSubscriptionSchema.index({ emailDomain: 1 });

module.exports = mongoose.model('OrganisationSubscription', organisationSubscriptionSchema);
