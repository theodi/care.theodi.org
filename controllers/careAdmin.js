const mongoose = require('mongoose');
const OrganisationSubscription = require('../models/organisationSubscription');
const OrganisationMembership = require('../models/organisationMembership');
const {
  normalizeEmailDomain,
  normalizeMemberEmail,
  emailMatchesDomain,
  isSubscriptionActive,
  subscriptionLifecycleStatus,
  assertNoOverlappingSubscription,
} = require('../lib/organisationEntitlements');
const { validateCreatePayload } = require('../lib/careAdminSubscriptionPayload');

async function getSubscription(id) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid subscription id');
    err.status = 400;
    throw err;
  }
  const s = await OrganisationSubscription.findById(id).lean();
  if (!s) return null;
  const adminEmails = await adminEmailsForSubscriptionId(s._id);
  return {
    id: s._id,
    organisationName: s.organisationName,
    emailDomain: s.emailDomain,
    adminEmails,
    planTier: s.planTier,
    seatLimit: s.seatLimit,
    amount: s.amount,
    startDate: s.startDate,
    endDate: s.endDate,
    status: subscriptionLifecycleStatus(s),
    isActive: isSubscriptionActive(s),
    createdAt: s.createdAt,
    hubspotCompanyId: s.hubspotCompanyId || null,
    hubspotDealId: s.hubspotDealId || null,
  };
}

async function listSubscriptions() {
  const rows = await OrganisationSubscription.find().sort({ endDate: -1 }).lean();
  const ids = rows.map((s) => s._id);
  const adminMemberships = await OrganisationMembership.find({
    subscriptionId: { $in: ids },
    role: 'admin',
  })
    .select('subscriptionId emailLower')
    .lean();

  const adminsBySub = {};
  for (const m of adminMemberships) {
    const sid = m.subscriptionId.toString();
    if (!adminsBySub[sid]) adminsBySub[sid] = [];
    adminsBySub[sid].push(m.emailLower);
  }

  return rows.map((s) => ({
    id: s._id,
    organisationName: s.organisationName,
    emailDomain: s.emailDomain,
    adminEmails: adminsBySub[s._id.toString()] || [],
    planTier: s.planTier,
    seatLimit: s.seatLimit,
    amount: s.amount,
    startDate: s.startDate,
    endDate: s.endDate,
    status: subscriptionLifecycleStatus(s),
    isActive: isSubscriptionActive(s),
    createdAt: s.createdAt,
    hubspotCompanyId: s.hubspotCompanyId || null,
    hubspotDealId: s.hubspotDealId || null,
  }));
}

async function createSubscription(body, createdByUserId) {
  const { seatLimit, amount, startDate, endDate } = validateCreatePayload(body);
  const emailDomain = normalizeEmailDomain(body.emailDomain);
  if (!emailDomain) {
    const err = new Error('emailDomain is invalid');
    err.status = 400;
    throw err;
  }
  const initialAdminEmail = String(body.initialAdminEmail).trim();
  if (!initialAdminEmail.includes('@')) {
    const err = new Error('initialAdminEmail must be a valid email');
    err.status = 400;
    throw err;
  }
  if (!emailMatchesDomain(initialAdminEmail, emailDomain)) {
    const err = new Error(`initialAdminEmail must be on the organisation domain @${emailDomain}`);
    err.status = 400;
    throw err;
  }
  await assertNoOverlappingSubscription(emailDomain, startDate, endDate, null);

  const sub = await OrganisationSubscription.create({
    organisationName: String(body.organisationName).trim(),
    emailDomain,
    planTier: body.planTier,
    seatLimit,
    amount,
    startDate,
    endDate,
    createdByUserId,
  });

  await OrganisationMembership.create({
    subscriptionId: sub._id,
    emailLower: normalizeMemberEmail(initialAdminEmail),
    role: 'admin',
    addedByUserId: new mongoose.Types.ObjectId(createdByUserId),
  });

  return sub;
}

async function adminEmailsForSubscriptionId(subscriptionId) {
  const rows = await OrganisationMembership.find({
    subscriptionId,
    role: 'admin',
  })
    .select('emailLower')
    .lean();
  return rows.map((r) => r.emailLower);
}

function normalizeAdminEmailsInput(body) {
  if (body.adminEmails === undefined) return null;
  if (!Array.isArray(body.adminEmails)) {
    const err = new Error('adminEmails must be an array of email strings');
    err.status = 400;
    throw err;
  }
  const seen = new Set();
  const out = [];
  for (const item of body.adminEmails) {
    const s = normalizeMemberEmail(item);
    if (!s || !s.includes('@')) continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  if (out.length === 0) {
    const err = new Error('adminEmails must include at least one valid email');
    err.status = 400;
    throw err;
  }
  return out;
}

async function syncSubscriptionAdmins(subscriptionId, emailDomain, adminEmailLowers, actingUserId) {
  if (adminEmailLowers.length === 0) {
    const err = new Error('adminEmails must include at least one valid email');
    err.status = 400;
    throw err;
  }
  for (const emailLower of adminEmailLowers) {
    if (!emailMatchesDomain(emailLower, emailDomain)) {
      const err = new Error(`Admin email must be on @${emailDomain}`);
      err.status = 400;
      throw err;
    }
  }
  if (!mongoose.isValidObjectId(actingUserId)) {
    const err = new Error('Invalid session user id');
    err.status = 401;
    throw err;
  }
  const addedByOid = new mongoose.Types.ObjectId(actingUserId);
  for (const emailLower of adminEmailLowers) {
    const existing = await OrganisationMembership.findOne({ subscriptionId, emailLower });
    if (existing) {
      existing.role = 'admin';
      existing.licenseAdmin = false;
      existing.aiModelAdmin = false;
      existing.promptAdmin = false;
      existing.reportAdmin = false;
      await existing.save();
    } else {
      await OrganisationMembership.create({
        subscriptionId,
        emailLower,
        role: 'admin',
        licenseAdmin: false,
        aiModelAdmin: false,
        promptAdmin: false,
        reportAdmin: false,
        addedByUserId: addedByOid,
      });
    }
  }
  await OrganisationMembership.updateMany(
    { subscriptionId, role: 'admin', emailLower: { $nin: adminEmailLowers } },
    {
      $set: {
        role: 'member',
        licenseAdmin: false,
        aiModelAdmin: false,
        promptAdmin: false,
        reportAdmin: false,
      },
    }
  );
}

async function updateSubscription(id, body, actingUserId) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid subscription id');
    err.status = 400;
    throw err;
  }
  if (body.emailDomain !== undefined) {
    const err = new Error('emailDomain cannot be changed; member emails are tied to the subscription domain');
    err.status = 400;
    throw err;
  }
  const sub = await OrganisationSubscription.findById(id);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }

  if (body.organisationName !== undefined) sub.organisationName = String(body.organisationName).trim();
  if (body.planTier !== undefined) {
    if (!['silver', 'gold'].includes(body.planTier)) {
      const err = new Error('planTier must be silver or gold');
      err.status = 400;
      throw err;
    }
    sub.planTier = body.planTier;
  }
  let prospectiveSeatLimit = sub.seatLimit;
  if (body.seatLimit !== undefined) {
    const seatLimit = parseInt(body.seatLimit, 10);
    if (Number.isNaN(seatLimit) || seatLimit < 1) {
      const err = new Error('seatLimit must be a positive integer');
      err.status = 400;
      throw err;
    }
    prospectiveSeatLimit = seatLimit;
    sub.seatLimit = seatLimit;
  }

  const usedSeats = await OrganisationMembership.countDocuments({ subscriptionId: sub._id });
  if (prospectiveSeatLimit < usedSeats) {
    const err = new Error('seatLimit cannot be less than the number of members on this subscription');
    err.status = 400;
    throw err;
  }

  const adminList = normalizeAdminEmailsInput(body);
  if (adminList !== null) {
    if (!mongoose.isValidObjectId(actingUserId)) {
      const err = new Error('Invalid session user id');
      err.status = 401;
      throw err;
    }
    for (const emailLower of adminList) {
      if (!emailMatchesDomain(emailLower, sub.emailDomain)) {
        const err = new Error(`Admin email must be on @${sub.emailDomain}`);
        err.status = 400;
        throw err;
      }
    }
    const memberEmails = await OrganisationMembership.find({ subscriptionId: sub._id })
      .select('emailLower')
      .lean();
    const memberSet = new Set(memberEmails.map((m) => m.emailLower));
    const newSeatsFromAdmins = adminList.filter((e) => !memberSet.has(e)).length;
    if (usedSeats + newSeatsFromAdmins > prospectiveSeatLimit) {
      const err = new Error(
        'Seat limit is too low for current members plus new admin emails (raise seats or remove members first)'
      );
      err.status = 400;
      throw err;
    }
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (Number.isNaN(amount) || amount < 0) {
      const err = new Error('amount must be a non-negative number');
      err.status = 400;
      throw err;
    }
    sub.amount = amount;
  }
  if (body.startDate !== undefined || body.endDate !== undefined) {
    const start = body.startDate ? new Date(`${body.startDate}T00:00:00.000Z`) : sub.startDate;
    const end = body.endDate ? new Date(`${body.endDate}T23:59:59.999Z`) : sub.endDate;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      const err = new Error('Invalid startDate or endDate');
      err.status = 400;
      throw err;
    }
    if (end < start) {
      const err = new Error('endDate must be on or after startDate');
      err.status = 400;
      throw err;
    }
    sub.startDate = start;
    sub.endDate = end;
  }

  await assertNoOverlappingSubscription(sub.emailDomain, sub.startDate, sub.endDate, sub._id);

  await sub.save();

  if (adminList !== null) {
    await syncSubscriptionAdmins(sub._id, sub.emailDomain, adminList, actingUserId);
  }

  return sub;
}

module.exports = {
  getSubscription,
  listSubscriptions,
  createSubscription,
  updateSubscription,
  adminEmailsForSubscriptionId,
};
