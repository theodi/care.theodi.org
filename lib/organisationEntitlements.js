const OrganisationSubscription = require('../models/organisationSubscription');
const OrganisationMembership = require('../models/organisationMembership');

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

async function countMembers(subscriptionId) {
  return OrganisationMembership.countDocuments({ subscriptionId });
}

async function findActiveMembershipsForEmail(userEmail) {
  const emailLower = normalizeMemberEmail(userEmail);
  if (!emailLower) return [];
  const memberships = await OrganisationMembership.find({ emailLower }).populate('subscriptionId');
  return memberships.filter((m) => m.subscriptionId && isSubscriptionActive(m.subscriptionId));
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
    return { isMember: false, isAdmin: false, subscriptionId: null, organisationName: null };
  }
  const m = memberships[0];
  const sub = m.subscriptionId;
  if (!sub) {
    return {
      isMember: true,
      isAdmin: m.role === 'admin',
      subscriptionId: null,
      organisationName: null,
    };
  }
  const organisationName =
    typeof sub.organisationName === 'string' && sub.organisationName.trim()
      ? sub.organisationName.trim()
      : null;
  return {
    isMember: true,
    isAdmin: m.role === 'admin',
    subscriptionId: sub._id,
    organisationName,
  };
}

async function assertNoOverlappingSubscription(domain, startDate, endDate, excludeId) {
  const d = normalizeEmailDomain(domain);
  const others = await OrganisationSubscription.find({ emailDomain: d });
  for (const s of others) {
    if (excludeId && s._id.equals(excludeId)) continue;
    if (dateRangesOverlap(s.startDate, s.endDate, startDate, endDate)) {
      const err = new Error(
        'Another subscription already exists for this domain with overlapping dates.'
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
  countMembers,
  findActiveMembershipsForEmail,
  findMembershipForEmail,
  userHasActiveOrgEntitlementByEmail,
  getUserOrganisationMetaByEmail,
  assertNoOverlappingSubscription,
};
