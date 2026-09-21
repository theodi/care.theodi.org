const OrganisationSubscription = require('../models/organisationSubscription');
const OrganisationMembership = require('../models/organisationMembership');
const { canManageOrganisationProjectIntegrations } = require('./organisationPermissions');

function normalizeEmailDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  if (d.startsWith('@')) d = d.slice(1);
  return d;
}

/** Full email for org membership rows (same idea as project.sharedWith user string). */
function normalizeMemberEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailHost(email) {
  const i = String(email).indexOf('@');
  return i === -1 ? '' : String(email).slice(i + 1).toLowerCase();
}

function emailMatchesDomain(email, domain) {
  const host = emailHost(email);
  const d = normalizeEmailDomain(domain);
  return host === d;
}

function isSubscriptionActive(sub) {
  if (!sub || !sub.startDate || !sub.endDate) return false;
  const now = new Date();
  return now >= new Date(sub.startDate) && now <= new Date(sub.endDate);
}

function subscriptionLifecycleStatus(sub) {
  return isSubscriptionActive(sub) ? 'active' : 'expired';
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as <= be && bs <= ae;
}

async function getActiveSubscriptionForTenantId(tenantId) {
  if (!tenantId) return null;
  const subs = await OrganisationSubscription.find({ tenantId }).lean();
  return subs.find((s) => isSubscriptionActive(s)) || null;
}

async function countMembers(tenantId) {
  return OrganisationMembership.countDocuments({ tenantId });
}

/**
 * Memberships whose tenant has at least one active subscription period.
 * Each doc has `tenantId` populated and `activeSubscription` set (lean plain object).
 */
async function findActiveMembershipsForEmail(userEmail) {
  const emailLower = normalizeMemberEmail(userEmail);
  if (!emailLower) return [];
  const memberships = await OrganisationMembership.find({ emailLower }).populate('tenantId').lean();
  if (!memberships.length) return [];

  const tenantIds = [
    ...new Set(
      memberships.map((m) => (m.tenantId && m.tenantId._id ? m.tenantId._id : m.tenantId)).filter(Boolean)
    ),
  ];
  if (!tenantIds.length) return [];

  const allSubs = await OrganisationSubscription.find({ tenantId: { $in: tenantIds } }).lean();
  const activeByTenant = new Map();
  for (const tid of tenantIds) {
    const tKey = String(tid);
    const subs = allSubs.filter((s) => String(s.tenantId) === tKey);
    const active = subs.find((s) => isSubscriptionActive(s));
    if (active) activeByTenant.set(tKey, active);
  }

  const out = [];
  for (const m of memberships) {
    const tid = m.tenantId && (m.tenantId._id || m.tenantId);
    if (!tid) continue;
    const act = activeByTenant.get(String(tid));
    if (!act) continue;
    out.push({ ...m, activeSubscription: act });
  }
  return out;
}

async function findMembershipForEmail(userEmail) {
  const active = await findActiveMembershipsForEmail(userEmail);
  return active[0] || null;
}

async function userHasActiveOrgEntitlementByEmail(userEmail) {
  const active = await findActiveMembershipsForEmail(userEmail);
  return active.length > 0;
}

async function getUserOrganisationMetaByEmail(userEmail) {
  const memberships = await findActiveMembershipsForEmail(userEmail);
  if (!memberships.length) {
    return {
      isMember: false,
      isAdmin: false,
      licenseAdmin: false,
      aiModelAdmin: false,
      promptAdmin: false,
      reportAdmin: false,
      projectManager: false,
      canManageOrganisationProjectIntegrations: false,
      tenantId: null,
      subscriptionId: null,
      organisationName: null,
      emailDomain: null,
    };
  }
  const m = memberships[0];
  const tenant = m.tenantId;
  const sub = m.activeSubscription;
  if (!tenant) {
    return {
      isMember: true,
      isAdmin: m.role === 'admin',
      licenseAdmin: !!m.licenseAdmin,
      aiModelAdmin: !!m.aiModelAdmin,
      promptAdmin: !!m.promptAdmin,
      reportAdmin: !!m.reportAdmin,
      projectManager: !!m.projectManager,
      canManageOrganisationProjectIntegrations: canManageOrganisationProjectIntegrations(m),
      tenantId: null,
      subscriptionId: sub ? sub._id : null,
      organisationName: null,
      emailDomain: null,
    };
  }
  const organisationName =
    typeof tenant.organisationName === 'string' && tenant.organisationName.trim()
      ? tenant.organisationName.trim()
      : null;
  const emailDomain =
    typeof tenant.emailDomain === 'string' && tenant.emailDomain.trim() ? tenant.emailDomain.trim() : null;
  return {
    isMember: true,
    isAdmin: m.role === 'admin',
    licenseAdmin: !!m.licenseAdmin,
    aiModelAdmin: !!m.aiModelAdmin,
    promptAdmin: !!m.promptAdmin,
    reportAdmin: !!m.reportAdmin,
    projectManager: !!m.projectManager,
    canManageOrganisationProjectIntegrations: canManageOrganisationProjectIntegrations(m),
    tenantId: tenant._id,
    subscriptionId: sub ? sub._id : null,
    organisationName,
    emailDomain,
  };
}

/**
 * No overlapping subscription periods for the same tenant.
 */
async function assertNoOverlappingSubscriptionForTenant(tenantId, startDate, endDate, excludeSubscriptionId) {
  const others = await OrganisationSubscription.find({ tenantId });
  for (const s of others) {
    if (excludeSubscriptionId && s._id.equals(excludeSubscriptionId)) continue;
    if (dateRangesOverlap(s.startDate, s.endDate, startDate, endDate)) {
      const err = new Error(
        'Another subscription period already exists for this tenant with overlapping dates.'
      );
      err.status = 409;
      throw err;
    }
  }
}

module.exports = {
  normalizeEmailDomain,
  normalizeMemberEmail,
  emailMatchesDomain,
  isSubscriptionActive,
  subscriptionLifecycleStatus,
  dateRangesOverlap,
  getActiveSubscriptionForTenantId,
  countMembers,
  findActiveMembershipsForEmail,
  findMembershipForEmail,
  userHasActiveOrgEntitlementByEmail,
  getUserOrganisationMetaByEmail,
  assertNoOverlappingSubscriptionForTenant,
};
