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
    role: { type: String, enum: ['admin', 'member'], required: true },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'OrganisationMemberships', timestamps: true }
);

organisationMembershipSchema.index({ subscriptionId: 1, emailLower: 1 }, { unique: true });

module.exports = mongoose.model('OrganisationMembership', organisationMembershipSchema);
