const mongoose = require('mongoose');
const OrganisationMembership = require('../models/organisationMembership');
const OrganisationSubscription = require('../models/organisationSubscription');
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
  validateOrgAiUpdate,
  mergeOrgAiIntoSubscription,
  maskOrgAiForClient,
  orgAiToRuntimeOverrides,
} = require('../lib/organisationAiConfig');
const {
  SCAN_CONTEXT_STAGE_LABELS,
  validateAndNormalizeScanContextUpdate,
  mergeScanContextIntoSubscription,
  maskScanContextForClient,
  scanContextPresenceByStage,
  getScanContextForMessageId,
} = require('../lib/organisationScanContext');
const { chatCompletion } = require('../services/aiChat');
const { parseModelJsonResponse } = require('../services/parseAIJson');

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
    };
  });
  return Promise.all(lookups);
}

async function getOrganisationContext(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  const activeMemberships = await findActiveMembershipsForEmail(user.email);
  const membership = activeMemberships[0];
  if (!membership || !membership.subscriptionId) {
    return null;
  }
  const sub = membership.subscriptionId;
  const active = isSubscriptionActive(sub);
  const memberDocs = await OrganisationMembership.find({ subscriptionId: sub._id }).sort({
    role: 1,
    emailLower: 1,
  });
  const seatUsed = memberDocs.length;
  const members = await enrichMemberRows(memberDocs);
  return {
    subscription: {
      id: sub._id,
      organisationName: sub.organisationName,
      emailDomain: sub.emailDomain,
      planTier: sub.planTier,
      seatLimit: sub.seatLimit,
      seatUsed,
      startDate: sub.startDate,
      endDate: sub.endDate,
      subscriptionActive: active,
    },
    myRole: membership.role,
    members,
  };
}

async function findRequesterAdminMembership(requesterUserId) {
  const user = await User.findById(requesterUserId);
  if (!user) return null;
  const emailLower = normalizeMemberEmail(user.email);
  const memberships = await OrganisationMembership.find({ emailLower }).populate('subscriptionId');
  return (
    memberships.find(
      (m) =>
        m.role === 'admin' && m.subscriptionId && isSubscriptionActive(m.subscriptionId)
    ) || null
  );
}

function membershipToJson(m) {
  if (!m) return null;
  const id = m._id != null ? m._id.toString() : null;
  const sid = m.subscriptionId != null ? m.subscriptionId.toString() : null;
  return {
    id,
    emailLower: m.emailLower,
    role: m.role,
    subscriptionId: sid,
  };
}

async function addMember(requesterUserId, email, roleInput) {
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

  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can add people');
    err.status = 403;
    throw err;
  }
  const sub = requester.subscriptionId;
  if (!isSubscriptionActive(sub)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const role = roleInput === 'admin' ? 'admin' : 'member';
  const trimmed = String(email == null ? '' : email).trim();
  if (!trimmed) {
    const err = new Error('Email is required');
    err.status = 400;
    throw err;
  }
  if (!emailMatchesDomain(trimmed, sub.emailDomain)) {
    const err = new Error(`Email must be on the organisation domain @${sub.emailDomain}`);
    err.status = 400;
    throw err;
  }
  const emailLower = normalizeMemberEmail(trimmed);
  const n = await countMembers(sub._id);
  if (n >= sub.seatLimit) {
    const err = new Error('Seat limit reached');
    err.status = 403;
    throw err;
  }
  const existing = await OrganisationMembership.findOne({
    subscriptionId: sub._id,
    emailLower,
  });
  if (existing) {
    return {
      message: 'That email is already on this organisation',
      membership: membershipToJson(existing),
    };
  }
  const membership = await OrganisationMembership.create({
    subscriptionId: sub._id,
    emailLower,
    role,
    addedByUserId,
  });
  return {
    message: role === 'admin' ? 'Admin added' : 'Member added',
    membership: membershipToJson(membership),
  };
}

async function removeMember(requesterUserId, membershipId) {
  if (!mongoose.isValidObjectId(membershipId)) {
    const err = new Error('Invalid membership id');
    err.status = 400;
    throw err;
  }
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can remove members');
    err.status = 403;
    throw err;
  }
  const sub = requester.subscriptionId;
  if (!isSubscriptionActive(sub)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const target = await OrganisationMembership.findOne({
    _id: membershipId,
    subscriptionId: sub._id,
  });
  if (!target) {
    const err = new Error('Member not found');
    err.status = 404;
    throw err;
  }
  if (target.role === 'admin') {
    const adminCount = await OrganisationMembership.countDocuments({
      subscriptionId: sub._id,
      role: 'admin',
    });
    if (adminCount <= 1) {
      const err = new Error('Cannot remove the last organisation admin');
      err.status = 400;
      throw err;
    }
  }
  await OrganisationMembership.deleteOne({ _id: target._id });
  return { message: 'Member removed' };
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
  if (!m || !m.subscriptionId) {
    return { organisationAiAvailable: false, scanContextByStage: {}, scanContextText: null };
  }
  const subId = m.subscriptionId._id || m.subscriptionId;
  const sub = await OrganisationSubscription.findById(subId);
  const ov = orgAiToRuntimeOverrides(sub && sub.organisationAi);
  const scanContextByStage = scanContextPresenceByStage(sub && sub.organisationScanContext);
  const mid = forMessageId != null ? String(forMessageId).trim() : '';
  const rawCtx = mid ? getScanContextForMessageId(sub && sub.organisationScanContext, mid) : '';
  const scanContextText = rawCtx ? rawCtx : null;
  return { organisationAiAvailable: !!ov, scanContextByStage, scanContextText };
}

async function getAiConfigAdmin(requesterUserId) {
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can view AI configuration');
    err.status = 403;
    throw err;
  }
  const sub = await OrganisationSubscription.findById(
    requester.subscriptionId._id || requester.subscriptionId
  );
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  return maskOrgAiForClient(sub.organisationAi);
}

async function updateAiConfigAdmin(requesterUserId, body) {
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can update AI configuration');
    err.status = 403;
    throw err;
  }
  if (!isSubscriptionActive(requester.subscriptionId)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const validated = validateOrgAiUpdate(body);
  const subId = requester.subscriptionId._id || requester.subscriptionId;
  const sub = await OrganisationSubscription.findById(subId);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  const merged = mergeOrgAiIntoSubscription(sub.organisationAi, validated);
  await OrganisationSubscription.updateOne({ _id: sub._id }, { $set: { organisationAi: merged } });
  return { message: 'Saved', config: maskOrgAiForClient(merged) };
}

/**
 * Run the same smoke checks as scripts/test-ai.js against optional overrides or saved org config.
 */
async function testAiConfigAdmin(requesterUserId, body) {
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can test AI configuration');
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
    const sub = await OrganisationSubscription.findById(
      requester.subscriptionId._id || requester.subscriptionId
    );
    overrides = orgAiToRuntimeOverrides(sub && sub.organisationAi);
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
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can view scan context');
    err.status = 403;
    throw err;
  }
  const sub = await OrganisationSubscription.findById(
    requester.subscriptionId._id || requester.subscriptionId
  );
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  return {
    stages: maskScanContextForClient(sub.organisationScanContext),
    labels: SCAN_CONTEXT_STAGE_LABELS,
  };
}

async function updateScanContextAdmin(requesterUserId, body) {
  const requester = await findRequesterAdminMembership(requesterUserId);
  if (!requester || requester.role !== 'admin') {
    const err = new Error('Only organisation admins can update scan context');
    err.status = 403;
    throw err;
  }
  if (!isSubscriptionActive(requester.subscriptionId)) {
    const err = new Error('Subscription is not active');
    err.status = 403;
    throw err;
  }
  const subId = requester.subscriptionId._id || requester.subscriptionId;
  const sub = await OrganisationSubscription.findById(subId);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  const partial = validateAndNormalizeScanContextUpdate(body);
  const merged = mergeScanContextIntoSubscription(sub.organisationScanContext, partial);
  await OrganisationSubscription.updateOne(
    { _id: sub._id },
    { $set: { organisationScanContext: merged } }
  );
  return {
    message: 'Saved',
    stages: maskScanContextForClient(merged),
  };
}

module.exports = {
  getOrganisationContext,
  addMember,
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
};
