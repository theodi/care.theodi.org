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
} = require('../lib/organisationEntitlements');

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

module.exports = {
  getOrganisationContext,
  addMember,
  removeMember,
  normalizeEmailDomain,
  emailMatchesDomain,
  isSubscriptionActive,
};
