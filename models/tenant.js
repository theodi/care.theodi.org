const mongoose = require('mongoose');

/**
 * Master tenant record: people (OrganisationMembership), durable org settings.
 * Subscription periods link via OrganisationSubscription.tenantId.
 */
const tenantSchema = new mongoose.Schema(
  {
    organisationName: { type: String, required: true },
    emailDomain: { type: String, required: true },
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
    organisationScanContext: {
      completeAssessment: { type: String, default: '' },
      intendedConsequences: { type: String, default: '' },
      unintendedConsequences: { type: String, default: '' },
      stakeholders: { type: String, default: '' },
      riskEvaluation: { type: String, default: '' },
      actionPlanning: { type: String, default: '' },
    },
    organisationScanGuidanceItems: [
      {
        title: { type: String, default: '' },
        content: { type: String, default: '' },
        humanContent: { type: String, default: '' },
        useForAi: { type: Boolean, default: true },
        useForHuman: { type: Boolean, default: false },
        stages: [
          {
            type: String,
            enum: [
              'projectDetails',
              'completeAssessment',
              'intendedConsequences',
              'unintendedConsequences',
              'stakeholders',
              'riskEvaluation',
              'actionPlanning',
              'actionCompletion',
            ],
          },
        ],
      },
    ],
    reportTemplateOriginalName: { type: String, default: '' },
    reportTemplateUploadedAt: { type: Date },
    reportAccentDetectedHex: { type: String, default: '' },
    reportTemplateVersions: [
      {
        id: { type: String, required: true },
        originalName: { type: String, default: 'template.docx' },
        uploadedAt: { type: Date, required: true },
        accentDetectedHex: { type: String, default: '' },
      },
    ],
    /** Machine integration (Zapier, etc.): hashed secrets; plaintext shown once on create. */
    integrationApiKeys: [
      {
        keyHash: { type: String, required: true },
        /** First characters of the token for display in admin UI (not secret). */
        prefix: { type: String, default: '' },
        label: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date },
      },
    ],
  },
  { collection: 'Tenants', timestamps: true }
);

tenantSchema.index({ emailDomain: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
