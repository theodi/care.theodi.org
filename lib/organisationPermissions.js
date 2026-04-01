/**
 * Organisation membership capabilities. Full organisation admin (role === 'admin')
 * has every capability. Other licensed users may have delegated flags.
 */

function isOrganisationAdmin(m) {
  return !!(m && m.role === 'admin');
}

function canManageLicenses(m) {
  return !!(m && (m.role === 'admin' || m.licenseAdmin));
}

function canManageAiModel(m) {
  return !!(m && (m.role === 'admin' || m.aiModelAdmin));
}

function canManagePromptScanContext(m) {
  return !!(m && (m.role === 'admin' || m.promptAdmin));
}

function membershipCapabilities(m) {
  return {
    isOrganisationAdmin: isOrganisationAdmin(m),
    canManageLicenses: canManageLicenses(m),
    canManageAiModel: canManageAiModel(m),
    canManagePromptScanContext: canManagePromptScanContext(m),
  };
}

module.exports = {
  isOrganisationAdmin,
  canManageLicenses,
  canManageAiModel,
  canManagePromptScanContext,
  membershipCapabilities,
};
