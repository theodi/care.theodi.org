const mongoose = require('mongoose');
const Tenant = require('../models/tenant');
const OrganisationSubscription = require('../models/organisationSubscription');
const OrganisationMembership = require('../models/organisationMembership');
const {
  normalizeEmailDomain,
  normalizeMemberEmail,
  emailMatchesDomain,
  isSubscriptionActive,
  subscriptionLifecycleStatus,
  assertNoOverlappingSubscriptionForTenant,
} = require('../lib/organisationEntitlements');
const {
  validateCreatePayload,
  validateSubscriptionPeriodPayload,
} = require('../lib/careAdminSubscriptionPayload');

async function getSubscription(id) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid subscription id');
    err.status = 400;
    throw err;
  }
  const s = await OrganisationSubscription.findById(id).populate('tenantId').lean();
  if (!s) return null;
  const tenant = s.tenantId;
  const tenantOid = tenant && tenant._id ? tenant._id : s.tenantId;
  const adminEmails = await adminEmailsForTenantId(tenantOid);
  return {
    id: s._id,
    tenantId: tenantOid,
    organisationName: tenant && tenant.organisationName,
    emailDomain: tenant && tenant.emailDomain,
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
  const rows = await OrganisationSubscription.find().sort({ endDate: -1 }).populate('tenantId').lean();
  const tenantIds = rows.map((s) => s.tenantId && (s.tenantId._id || s.tenantId)).filter(Boolean);
  const adminMemberships = await OrganisationMembership.find({
    tenantId: { $in: tenantIds },
    role: 'admin',
  })
    .select('tenantId emailLower')
    .lean();

  const adminsByTenant = {};
  for (const m of adminMemberships) {
    const tid = m.tenantId.toString();
    if (!adminsByTenant[tid]) adminsByTenant[tid] = [];
    adminsByTenant[tid].push(m.emailLower);
  }

  return rows.map((s) => {
    const tenant = s.tenantId;
    const tenantOid = tenant && tenant._id ? tenant._id : s.tenantId;
    const tid = tenantOid ? tenantOid.toString() : '';
    return {
      id: s._id,
      tenantId: tenantOid,
      organisationName: tenant && tenant.organisationName,
      emailDomain: tenant && tenant.emailDomain,
      adminEmails: adminsByTenant[tid] || [],
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
  });
}

async function createSubscription(body, createdByUserId) {
  const createdByOid = new mongoose.Types.ObjectId(createdByUserId);

  if (body.tenantId != null && String(body.tenantId).trim() !== '') {
    if (!mongoose.isValidObjectId( String(body.tenantId))) {
      const err = new Error('tenantId is invalid');
      err.status = 400;
      throw err;
    }
    const tenant = await Tenant.findById(body.tenantId);
    if (!tenant) {
      const err = new Error('Tenant not found');
      err.status = 404;
      throw err;
    }
    const { seatLimit, amount, startDate, endDate } = validateSubscriptionPeriodPayload(body);
    await assertNoOverlappingSubscriptionForTenant(tenant._id, startDate, endDate, null);

    const sub = await OrganisationSubscription.create({
      tenantId: tenant._id,
      planTier: body.planTier,
      seatLimit,
      amount,
      startDate,
      endDate,
      createdByUserId: createdByOid,
    });
    return sub;
  }

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

  const tenant = await Tenant.create({
    organisationName: String(body.organisationName).trim(),
    emailDomain,
  });

  await assertNoOverlappingSubscriptionForTenant(tenant._id, startDate, endDate, null);

  const sub = await OrganisationSubscription.create({
    tenantId: tenant._id,
    planTier: body.planTier,
    seatLimit,
    amount,
    startDate,
    endDate,
    createdByUserId: createdByOid,
  });

  await OrganisationMembership.create({
    tenantId: tenant._id,
    emailLower: normalizeMemberEmail(initialAdminEmail),
    role: 'admin',
    addedByUserId: createdByOid,
  });

  return sub;
}

async function adminEmailsForTenantId(tenantId) {
  const rows = await OrganisationMembership.find({
    tenantId,
    role: 'admin',
  })
    .select('emailLower')
    .lean();
  return rows.map((r) => r.emailLower);
}

/** @deprecated use adminEmailsForTenantId */
async function adminEmailsForSubscriptionId(subscriptionId) {
  const sub = await OrganisationSubscription.findById(subscriptionId).select('tenantId').lean();
  if (!sub || !sub.tenantId) return [];
  return adminEmailsForTenantId(sub.tenantId);
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

async function syncTenantAdmins(tenantId, emailDomain, adminEmailLowers, actingUserId) {
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
    const existing = await OrganisationMembership.findOne({ tenantId, emailLower });
    if (existing) {
      existing.role = 'admin';
      existing.licenseAdmin = false;
      existing.aiModelAdmin = false;
      existing.promptAdmin = false;
      existing.reportAdmin = false;
      await existing.save();
    } else {
      await OrganisationMembership.create({
        tenantId,
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
    { tenantId, role: 'admin', emailLower: { $nin: adminEmailLowers } },
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
  const sub = await OrganisationSubscription.findById(id);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  const tenant = await Tenant.findById(sub.tenantId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }

  if (body.emailDomain !== undefined) {
    const err = new Error('emailDomain cannot be changed; member emails are tied to the tenant domain');
    err.status = 400;
    throw err;
  }

  if (body.organisationName !== undefined) {
    tenant.organisationName = String(body.organisationName).trim();
  }
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

  const usedSeats = await OrganisationMembership.countDocuments({ tenantId: tenant._id });
  if (prospectiveSeatLimit < usedSeats) {
    const err = new Error('seatLimit cannot be less than the number of members on this tenant');
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
      if (!emailMatchesDomain(emailLower, tenant.emailDomain)) {
        const err = new Error(`Admin email must be on @${tenant.emailDomain}`);
        err.status = 400;
        throw err;
      }
    }
    const memberEmails = await OrganisationMembership.find({ tenantId: tenant._id })
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

  await assertNoOverlappingSubscriptionForTenant(tenant._id, sub.startDate, sub.endDate, sub._id);

  await tenant.save();
  await sub.save();

  if (adminList !== null) {
    await syncTenantAdmins(tenant._id, tenant.emailDomain, adminList, actingUserId);
  }

  return sub;
}

module.exports = {
  getSubscription,
  listSubscriptions,
  createSubscription,
  updateSubscription,
  adminEmailsForTenantId,
  adminEmailsForSubscriptionId,
};