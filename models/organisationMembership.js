const mongoose = require('mongoose');

const organisationMembershipSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrganisationSubscription',
      required: true,
    },
    /** Normalised full address (lowercase trim); identity is email, not User — no CARE account required */
    emailLower: { type: String, required: true },
    /** Full organisation admin (all capabilities). Mutually exclusive with delegated flags in practice. */
    role: { type: String, enum: ['admin', 'member'], required: true },
    /** Delegated: manage licensed users (seats), except cannot remove organisation admins or the last org admin. */
    licenseAdmin: { type: Boolean, default: false },
    /** Delegated: organisation AI model / provider configuration. */
    aiModelAdmin: { type: Boolean, default: false },
    /** Delegated: extra scan-step prompt guidance (organisation scan context). */
    promptAdmin: { type: Boolean, default: false },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'OrganisationMemberships', timestamps: true }
);

organisationMembershipSchema.index({ subscriptionId: 1, emailLower: 1 }, { unique: true });

module.exports = mongoose.model('OrganisationMembership', organisationMembershipSchema);
