const mongoose = require('mongoose');
const OrganisationMembership = require('../models/organisationMembership');
const Tenant = require('../models/tenant');
const User = require('../models/user');
const {
  normalizeEmailDomain,
  normalizeMemberEmail,
  emailMatchesDomain,
  isSubscriptionActive,
  countMembers,
  findActiveMembershipsForEmail,
  findMembershipForEmail,
} = require('../lib/organisationEntitlements');
const {
  isOrganisationAdmin,
  canManageLicenses,
  canManageAiModel,
  canManagePromptScanContext,
  canManageReportTemplate,
  membershipCapabilities,
} = require('../lib/organisationPermissions');
const {
  validateOrgAiUpdate,
  mergeOrgAiIntoSubscription,
  maskOrgAiForClient,
  orgAiToRuntimeOverrides,
} = require('../lib/organisationAiConfig');
const {
  SCAN_CONTEXT_STAGE_LABELS,
  SCAN_CONTEXT_STAGE_KEYS,
  validateAndNormalizeGuidanceItems,
  resolveGuidanceItems,
  scanContextPresenceByStageForSubscription,
  getScanContextTextForSubscription,
  uncoveredScanStages,
} = require('../lib/organisationScanContext');
const { chatCompletion } = require('../services/aiChat');
const { parseModelJsonResponse } = require('../services/parseAIJson');
const {
  validateDocxTemplateBuffer,
  extractAccentHexFromDocxBuffer,
} = require('../lib/reportTemplateValidation');
const {
  saveOrgReportTemplate,
  deleteOrgReportTemplate,
  orgTemplateFileExists,
  effectiveAccentHexFromTenant,
} = require('../lib/orgReportTemplateStorage');
const { generateIntegrationApiKey } = require('../lib/tenantIntegrationKeys');

async function enrichMemberRows(members) {
  const lookups = members.map(async (m) => {
    const u = await User.findOne({
      email: new RegExp(`^${m.emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
    return {
      membershipId: m._id.toString(),
      emailLower: m.emailLower,
      email: u ? u.email : m.emailLower,
      name: u ? u.name : null,
      hasAccount: !!u,
      role: m.role,
      licenseAdmin: !!m.licenseAdmin,
      aiModelAdmin: !!m.aiModelAdmin,
      promptAdmin: !!m.promptAdmin,
      reportAdmin: !!m.reportAdmin,
      projectManager: !!m.projectManager,
    };
  });
  return Promise.all(lookups);
}

async function getOrganisationContext(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  const activeMemberships = await findActiveMembershipsForEmail(user.email);
  const membership = activeMemberships[0];
  if (!membership || !membership.tenantId || !membership.activeSubscription) {
    return null;
  }
  const sub = membership.activeSubscription;
  const tenant = membership.tenantId;
  const tenantOid = tenant._id || tenant;
  const active = isSubscriptionActive(sub);
  const memberDocs = await OrganisationMembership.find({ tenantId: tenantOid }).sort({
    role: 1,
    emailLower: 1,
  });
  const seatUsed = memberDocs.length;
  const members = await enrichMemberRows(memberDocs);
  const keys = Array.isArray(tenant.integrationApiKeys) ? tenant.integrationApiKeys : [];
  const integrationApiKeys = keys.map((k) => ({
    id: k._id ? k._id.toString() : null,
    prefix: k.prefix || '',
    label: k.label || '',
    createdAt: k.createdAt || null,
    lastUsedAt: k.lastUsedAt || null,
  }));
  return {
    tenantId: tenantOid.toString(),
    subscription: {
      id: sub._id,
      organisationName: tenant.organisationName,
      emailDomain: tenant.emailDomain,
      planTier: sub.planTier,
      seatLimit: sub.seatLimit,
      seatUsed,
      startDate: sub.startDate,
      endDate: sub.endDate,
      subscriptionActive: active,
      reportTemplate: {
        hasFile: !!(tenant.reportTemplateUploadedAt && orgTemplateFileExists(tenantOid)),
        originalName: tenant.reportTemplateOriginalName || '',
        uploadedAt: tenant.reportTemplateUploadedAt || null,
        accentDetectedHex: tenant.reportAccentDetectedHex || '',
        accentEffectiveHex: effectiveAccentHexFromTenant(tenant),
      },
      integrationApiKeys,
    },
    myRole: membership.role,
    myMembership: membershipCapabilities(membership),
    members,
  };
}

async function findRequesterActiveOrgMembership(requesterUserId) {
  const user = await User.findById(requesterUserId);
  if (!user) return null;
  const active = await findActiveMembershipsForEmail(user.email);
  return active[0] || null;
}

function membershipToJson(m) {
  if (!m) return null;
  const id = m._id != null ? m._id.toString() : null;
  const tid = m.tenantId != null ? (m.tenantId._id || m.tenantId).toString() : null;
  const sid =
    m.activeSubscription != null && m.activeSubscription._id != null
      ? m.activeSubscription._id.toString()
      : null;
  return {
    id,
    emailLower: m.emailLower,
    role: m.role,
    licenseAdmin: !!m.licenseAdmin,
    aiModelAdmin: !!m.aiModelAdmin,
    promptAdmin: !!m.promptAdmin,
    reportAdmin: !!m.reportAdmin,
    projectManager: !!m.projectManager,
    tenantId: tid,
    subscriptionId: sid,
  };
}

async function addMember(requesterUserId, body) {
  const idStr =
    requesterUserId != null && requesterUserId !== ''
      ? String(requesterUserId)
      : '';
  if (!mongoose.isValidObjectId(idStr)) {
    const err = new Error('Invalid session user id');
    err.status = 401;
    throw err;
  }
  const addedByUserId = new mongoose.Types.ObjectId(idStr);

  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageLicenses(requester)) {
    const err = new Error('You do not have permission to manage licensed users');
    err.status = 403;
    throw err;
  }
  const sub = requester.activeSubscription;
  const tenant = requester.tenantId;
  if (!sub || !tenant || !isSubscriptionActive(sub)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const tenantOid = tenant._id || tenant;

  const membershipRoleInput =
    body && (body.membershipRole != null ? body.membershipRole : body.role);
  const wantsAdmin = membershipRoleInput === 'admin';
  if (wantsAdmin && !isOrganisationAdmin(requester)) {
    const err = new Error('Only organisation admins can assign organisation admin role');
    err.status = 403;
    throw err;
  }

  let licenseAdmin = !!(body && body.licenseAdmin);
  let aiModelAdmin = !!(body && body.aiModelAdmin);
  let promptAdmin = !!(body && body.promptAdmin);
  let reportAdmin = !!(body && body.reportAdmin);
  let projectManager = !!(body && body.projectManager);
  if (!isOrganisationAdmin(requester)) {
    licenseAdmin = false;
    aiModelAdmin = false;
    promptAdmin = false;
    reportAdmin = false;
    projectManager = false;
  }
  if (wantsAdmin) {
    licenseAdmin = false;
    aiModelAdmin = false;
    promptAdmin = false;
    reportAdmin = false;
    projectManager = false;
  }

  const role = wantsAdmin ? 'admin' : 'member';
  const trimmed = String(body && body.email != null ? body.email : '').trim();
  if (!trimmed) {
    const err = new Error('Email is required');
    err.status = 400;
    throw err;
  }
  if (!emailMatchesDomain(trimmed, tenant.emailDomain)) {
    const err = new Error(`Email must be on the organisation domain @${tenant.emailDomain}`);
    err.status = 400;
    throw err;
  }
  const emailLower = normalizeMemberEmail(trimmed);
  const n = await countMembers(tenantOid);
  if (n >= sub.seatLimit) {
    const err = new Error('Seat limit reached');
    err.status = 403;
    throw err;
  }
  const existing = await OrganisationMembership.findOne({
    tenantId: tenantOid,
    emailLower,
  });
  if (existing) {
    const enriched = {
      ...existing.toObject(),
      tenantId: requester.tenantId,
      activeSubscription: requester.activeSubscription,
    };
    return {
      message: 'That email is already on this organisation',
      membership: membershipToJson(enriched),
    };
  }
  const membership = await OrganisationMembership.create({
    tenantId: tenantOid,
    emailLower,
    role,
    licenseAdmin,
    aiModelAdmin,
    promptAdmin,
    reportAdmin,
    projectManager,
    addedByUserId,
  });
  const enriched = {
    ...membership.toObject(),
    tenantId: tenant,
    activeSubscription: sub,
  };
  return {
    message: role === 'admin' ? 'Organisation admin added' : 'Licensed user added',
    membership: membershipToJson(enriched),
  };
}

async function updateMembership(requesterUserId, membershipId, body) {
  if (!mongoose.isValidObjectId(membershipId)) {
    const err = new Error('Invalid membership id');
    err.status = 400;
    throw err;
  }
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !isOrganisationAdmin(requester)) {
    const err = new Error('Only organisation admins can change roles and permissions');
    err.status = 403;
    throw err;
  }
  const sub = requester.activeSubscription;
  const tenant = requester.tenantId;
  if (!sub || !tenant || !isSubscriptionActive(sub)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const tenantOid = tenant._id || tenant;
  const target = await OrganisationMembership.findOne({
    _id: membershipId,
    tenantId: tenantOid,
  });
  if (!target) {
    const err = new Error('Member not found');
    err.status = 404;
    throw err;
  }

  const roleInput = body && (body.membershipRole != null ? body.membershipRole : body.role);
  let nextRole = target.role;
  if (roleInput === 'admin' || roleInput === 'member') {
    nextRole = roleInput;
  }

  let nextLicense = !!target.licenseAdmin;
  let nextAi = !!target.aiModelAdmin;
  let nextPrompt = !!target.promptAdmin;
  let nextReport = !!target.reportAdmin;
  let nextProjectManager = !!target.projectManager;
  if (body && body.licenseAdmin !== undefined) nextLicense = !!body.licenseAdmin;
  if (body && body.aiModelAdmin !== undefined) nextAi = !!body.aiModelAdmin;
  if (body && body.promptAdmin !== undefined) nextPrompt = !!body.promptAdmin;
  if (body && body.reportAdmin !== undefined) nextReport = !!body.reportAdmin;
  if (body && body.projectManager !== undefined) nextProjectManager = !!body.projectManager;

  if (nextRole === 'admin') {
    nextLicense = false;
    nextAi = false;
    nextPrompt = false;
    nextReport = false;
    nextProjectManager = false;
  }

  if (target.role === 'admin' && nextRole === 'member') {
    const adminCount = await OrganisationMembership.countDocuments({
      tenantId: tenantOid,
      role: 'admin',
    });
    if (adminCount <= 1) {
      const err = new Error('Cannot demote the last organisation admin');
      err.status = 400;
      throw err;
    }
  }

  target.role = nextRole;
  target.licenseAdmin = nextLicense;
  target.aiModelAdmin = nextAi;
  target.promptAdmin = nextPrompt;
  target.reportAdmin = nextReport;
  target.projectManager = nextProjectManager;
  await target.save();

  const enriched = {
    ...target.toObject(),
    tenantId: requester.tenantId,
    activeSubscription: requester.activeSubscription,
  };
  return {
    message: 'Membership updated',
    membership: membershipToJson(enriched),
  };
}

async function removeMember(requesterUserId, membershipId) {
  if (!mongoose.isValidObjectId(membershipId)) {
    const err = new Error('Invalid membership id');
    err.status = 400;
    throw err;
  }
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageLicenses(requester)) {
    const err = new Error('You do not have permission to remove licensed users');
    err.status = 403;
    throw err;
  }
  const sub = requester.activeSubscription;
  const tenant = requester.tenantId;
  if (!sub || !tenant || !isSubscriptionActive(sub)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const tenantOid = tenant._id || tenant;
  const target = await OrganisationMembership.findOne({
    _id: membershipId,
    tenantId: tenantOid,
  });
  if (!target) {
    const err = new Error('Member not found');
    err.status = 404;
    throw err;
  }
  if (target.role === 'admin' && !isOrganisationAdmin(requester)) {
    const err = new Error('Only organisation admins can remove an organisation admin');
    err.status = 403;
    throw err;
  }
  if (target.role === 'admin') {
    const adminCount = await OrganisationMembership.countDocuments({
      tenantId: tenantOid,
      role: 'admin',
    });
    if (adminCount <= 1) {
      const err = new Error('Cannot remove the last organisation admin');
      err.status = 400;
      throw err;
    }
  }
  await OrganisationMembership.deleteOne({ _id: target._id });
  return { message: 'Licensed user removed' };
}

const SMOKE_STRUCTURE_SCHEMA_TEST = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    ok: { type: 'boolean' },
  },
};

const STEP2_USER_PROMPT_TEST =
  'Set ok to true. In reply, write exactly: Structured output test passed.';

async function getAiEligibilityForUser(userId, forMessageId) {
  const user = await User.findById(userId);
  if (!user || !user.email) {
    return { organisationAiAvailable: false, scanContextByStage: {}, scanContextText: null };
  }
  const m = await findMembershipForEmail(user.email);
  if (!m || !m.tenantId) {
    return { organisationAiAvailable: false, scanContextByStage: {}, scanContextText: null };
  }
  const tenant = m.tenantId._id ? m.tenantId : await Tenant.findById(m.tenantId);
  const ov = orgAiToRuntimeOverrides(tenant && tenant.organisationAi);
  const scanContextByStage = scanContextPresenceByStageForSubscription(tenant);
  const mid = forMessageId != null ? String(forMessageId).trim() : '';
  const rawCtx = mid ? getScanContextTextForSubscription(tenant, mid) : '';
  const scanContextText = rawCtx ? rawCtx : null;
  return { organisationAiAvailable: !!ov, scanContextByStage, scanContextText };
}

async function getAiConfigAdmin(requesterUserId) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageAiModel(requester)) {
    const err = new Error('You do not have permission to view organisation AI configuration');
    err.status = 403;
    throw err;
  }
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  return maskOrgAiForClient(tenant.organisationAi);
}

async function updateAiConfigAdmin(requesterUserId, body) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageAiModel(requester)) {
    const err = new Error('You do not have permission to update organisation AI configuration');
    err.status = 403;
    throw err;
  }
  if (!requester.activeSubscription || !isSubscriptionActive(requester.activeSubscription)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const validated = validateOrgAiUpdate(body);
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const merged = mergeOrgAiIntoSubscription(tenant.organisationAi, validated);
  await Tenant.updateOne({ _id: tenant._id }, { $set: { organisationAi: merged } });
  return { message: 'Saved', config: maskOrgAiForClient(merged) };
}

/**
 * Run the same smoke checks as scripts/test-ai.js against optional overrides or saved org config.
 */
async function testAiConfigAdmin(requesterUserId, body) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageAiModel(requester)) {
    const err = new Error('You do not have permission to test organisation AI configuration');
    err.status = 403;
    throw err;
  }
  if (!body || typeof body !== 'object') {
    const err = new Error('Expected JSON body');
    err.status = 400;
    throw err;
  }
  let overrides;
  if (body.useSaved) {
    const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
    overrides = orgAiToRuntimeOverrides(tenant && tenant.organisationAi);
    if (!overrides) {
      const err = new Error(
        'Saved organisation AI is not enabled or incomplete. Save settings first or send a full config (useSaved: false).'
      );
      err.status = 400;
      throw err;
    }
  } else {
    const testDoc = {
      enabled: true,
      provider: body.provider,
      apiKey: body.apiKey,
      model: body.model,
      baseURL: body.baseURL,
      maxTokens: body.maxTokens,
      openaiApiVersion: body.openaiApiVersion,
      useApiKeyHeader: body.useApiKeyHeader,
      anthropicBaseUrl: body.anthropicBaseUrl,
      googleBaseUrl: body.googleBaseUrl,
      disableStructuredOutput: body.disableStructuredOutput,
      openaiUseLegacyMaxTokens: body.openaiUseLegacyMaxTokens,
    };
    overrides = orgAiToRuntimeOverrides(testDoc);
    if (!overrides) {
      const err = new Error(
        'Invalid test config: need provider, model, and apiKey when not using useSaved'
      );
      err.status = 400;
      throw err;
    }
  }

  const simpleOnly = !!body.simpleOnly;
  const structuredOnly = !!body.structuredOnly;
  if (simpleOnly && structuredOnly) {
    const err = new Error('Use only one of simpleOnly and structuredOnly');
    err.status = 400;
    throw err;
  }

  const prompt =
    typeof body.step1Prompt === 'string' && body.step1Prompt.trim()
      ? body.step1Prompt.trim()
      : 'Reply with a single short sentence confirming you received this test message. No preamble.';

  const out = {
    provider: overrides.provider,
    model: overrides.model,
  };

  if (!structuredOnly) {
    out.step1 = await chatCompletion([{ role: 'user', content: prompt }], overrides);
  }

  if (!simpleOnly) {
    if (overrides.disableStructuredOutput) {
      out.step2Skipped = true;
      out.step2Reason = 'disableStructuredOutput is set (same as AI_DISABLE_STRUCTURED_OUTPUT)';
    } else {
      const raw = await chatCompletion([{ role: 'user', content: STEP2_USER_PROMPT_TEST }], {
        ...overrides,
        structuredResponse: {
          schemaName: 'care_test_smoke',
          rawSchema: JSON.parse(JSON.stringify(SMOKE_STRUCTURE_SCHEMA_TEST)),
        },
      });
      out.step2RawPreview = raw.length > 600 ? raw.slice(0, 600) + '…' : raw;
      try {
        out.step2Parsed = parseModelJsonResponse(raw);
      } catch (e) {
        out.step2ParseError = e.message || String(e);
      }
    }
  }

  out.ok = true;
  return out;
}

async function getScanContextAdmin(requesterUserId) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManagePromptScanContext(requester)) {
    const err = new Error('You do not have permission to view organisation scan guidance');
    err.status = 403;
    throw err;
  }
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  return {
    items: resolveGuidanceItems(tenant),
    labels: SCAN_CONTEXT_STAGE_LABELS,
    stageKeys: SCAN_CONTEXT_STAGE_KEYS,
    uncoveredStages: uncoveredScanStages(tenant),
  };
}

async function updateScanContextAdmin(requesterUserId, body) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManagePromptScanContext(requester)) {
    const err = new Error('You do not have permission to update organisation scan guidance');
    err.status = 403;
    throw err;
  }
  if (!requester.activeSubscription || !isSubscriptionActive(requester.activeSubscription)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const items = validateAndNormalizeGuidanceItems(body);
  await Tenant.updateOne(
    { _id: tenant._id },
    {
      $set: { organisationScanGuidanceItems: items },
      $unset: { organisationScanContext: '' },
    }
  );
  const synthetic = { organisationScanGuidanceItems: items };
  return {
    message: 'Saved',
    items: resolveGuidanceItems(synthetic),
    labels: SCAN_CONTEXT_STAGE_LABELS,
    stageKeys: SCAN_CONTEXT_STAGE_KEYS,
    uncoveredStages: uncoveredScanStages(synthetic),
  };
}

async function assertOrgAdminForReportTemplate(requesterUserId) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !canManageReportTemplate(requester)) {
    const err = new Error(
      'Only organisation admins and report managers can manage the report template'
    );
    err.status = 403;
    throw err;
  }
  if (!requester.activeSubscription || !isSubscriptionActive(requester.activeSubscription)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  return requester;
}

async function uploadReportTemplateAdmin(requesterUserId, buffer, originalName) {
  const requester = await assertOrgAdminForReportTemplate(requesterUserId);
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const tenantId = tenant._id;
  const validation = validateDocxTemplateBuffer(buffer);
  if (!validation.ok) {
    return {
      ok: false,
      missingKeys: validation.missingKeys,
      warnings: validation.warnings,
    };
  }
  const detected = extractAccentHexFromDocxBuffer(buffer);
  saveOrgReportTemplate(tenantId, buffer);
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: {
        reportTemplateOriginalName: String(originalName || 'template.docx').slice(0, 240),
        reportTemplateUploadedAt: new Date(),
        reportAccentDetectedHex: detected,
      },
    }
  );
  const t = await Tenant.findById(tenantId).lean();
  return {
    ok: true,
    warnings: validation.warnings,
    accentDetectedHex: detected,
    accentEffectiveHex: effectiveAccentHexFromTenant(t),
    originalName: t.reportTemplateOriginalName,
    uploadedAt: t.reportTemplateUploadedAt,
  };
}

async function assertOrgAdminForIntegrationApi(requesterUserId) {
  const requester = await findRequesterActiveOrgMembership(requesterUserId);
  if (!requester || !isOrganisationAdmin(requester)) {
    const err = new Error('Only organisation admins can manage integration API keys');
    err.status = 403;
    throw err;
  }
  if (!requester.activeSubscription || !isSubscriptionActive(requester.activeSubscription)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  return requester;
}

async function createTenantIntegrationApiKey(requesterUserId, body) {
  const requester = await assertOrgAdminForIntegrationApi(requesterUserId);
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const label = String((body && body.label) || '').trim().slice(0, 120);
  const { plaintext, keyHash, prefix, keyId } = generateIntegrationApiKey();
  await Tenant.updateOne(
    { _id: tenant._id },
    {
      $push: {
        integrationApiKeys: {
          _id: keyId,
          keyHash,
          prefix,
          label,
          createdAt: new Date(),
        },
      },
    }
  );
  return {
    message: 'Key created. Store it securely; it will not be shown again.',
    key: plaintext,
    keyId: keyId.toString(),
    prefix,
    label,
  };
}

async function deleteTenantIntegrationApiKey(requesterUserId, keyId) {
  if (!mongoose.isValidObjectId(keyId)) {
    const err = new Error('Invalid key id');
    err.status = 400;
    throw err;
  }
  const requester = await assertOrgAdminForIntegrationApi(requesterUserId);
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const oid = new mongoose.Types.ObjectId(keyId);
  const before = await Tenant.findOne({
    _id: tenant._id,
    integrationApiKeys: { $elemMatch: { _id: oid } },
  });
  if (!before) {
    const err = new Error('Key not found');
    err.status = 404;
    throw err;
  }
  await Tenant.updateOne({ _id: tenant._id }, { $pull: { integrationApiKeys: { _id: oid } } });
  return { ok: true, message: 'Key revoked' };
}

async function deleteReportTemplateAdmin(requesterUserId) {
  const requester = await assertOrgAdminForReportTemplate(requesterUserId);
  const tenant = requester.tenantId._id ? requester.tenantId : await Tenant.findById(requester.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const tenantId = tenant._id;
  deleteOrgReportTemplate(tenantId);
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $unset: {
        reportTemplateOriginalName: 1,
        reportTemplateUploadedAt: 1,
        reportAccentDetectedHex: 1,
        reportAccentHexOverride: 1,
      },
    }
  );
  return { ok: true };
}

module.exports = {
  getOrganisationContext,
  addMember,
  updateMembership,
  removeMember,
  normalizeEmailDomain,
  emailMatchesDomain,
  isSubscriptionActive,
  getAiEligibilityForUser,
  getAiConfigAdmin,
  updateAiConfigAdmin,
  testAiConfigAdmin,
  getScanContextAdmin,
  updateScanContextAdmin,
  uploadReportTemplateAdmin,
  deleteReportTemplateAdmin,
  createTenantIntegrationApiKey,
  deleteTenantIntegrationApiKey,
};
