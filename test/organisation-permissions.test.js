const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isOrganisationAdmin,
  canManageLicenses,
  canManageAiModel,
  canManagePromptScanContext,
  canManageReportTemplate,
  membershipCapabilities,
} = require('../lib/organisationPermissions');

describe('organisationPermissions', () => {
  const orgAdmin = { role: 'admin' };
  const plainMember = { role: 'member' };
  const licenseOnly = { role: 'member', licenseAdmin: true };
  const aiOnly = { role: 'member', aiModelAdmin: true };
  const promptOnly = { role: 'member', promptAdmin: true };
  const reportOnly = { role: 'member', reportAdmin: true };

  it('treats role admin as full access', () => {
    assert.equal(isOrganisationAdmin(orgAdmin), true);
    assert.equal(canManageLicenses(orgAdmin), true);
    assert.equal(canManageAiModel(orgAdmin), true);
    assert.equal(canManagePromptScanContext(orgAdmin), true);
    assert.equal(canManageReportTemplate(orgAdmin), true);
  });

  it('grants only delegated capabilities to members with flags', () => {
    assert.equal(isOrganisationAdmin(plainMember), false);
    assert.equal(canManageLicenses(plainMember), false);
    assert.equal(canManageLicenses(licenseOnly), true);
    assert.equal(canManageAiModel(aiOnly), true);
    assert.equal(canManagePromptScanContext(promptOnly), true);
    assert.equal(canManageAiModel(licenseOnly), false);
    assert.equal(canManageReportTemplate(reportOnly), true);
    assert.equal(canManageReportTemplate(licenseOnly), false);
  });

  it('membershipCapabilities returns a consistent object', () => {
    assert.deepEqual(membershipCapabilities(licenseOnly), {
      isOrganisationAdmin: false,
      canManageLicenses: true,
      canManageAiModel: false,
      canManagePromptScanContext: false,
      canManageReportTemplate: false,
    });
  });
});
