const express = require('express');
const router = express.Router();
const { ensureCareStaff } = require('../middleware/careStaff');
const careAdminController = require('../controllers/careAdmin');
const Tenant = require('../models/tenant');
const { ensureAuthenticated } = require('../middleware/auth');

router.get('/new', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  try {
    const tenantId = String((req.query && req.query.tenantId) || '').trim();
    let renewalTenant = null;
    if (tenantId) {
      renewalTenant = await Tenant.findById(tenantId).lean();
      if (!renewalTenant) {
        const err = new Error('Tenant not found');
        err.status = 404;
        throw err;
      }
    }
    res.locals.page = {
      title: renewalTenant ? 'Add subscription period' : 'New organisation subscription',
      link: '/subscriptions/new',
    };
    res.locals.subscriptionEditId = '';
    res.locals.renewalTenant = renewalTenant;
    res.render('pages/subscriptions-new');
  } catch (e) {
    next(e);
  }
});

router.get('/:id/edit', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  try {
    const sub = await careAdminController.getSubscription(req.params.id);
    if (!sub) {
      const err = new Error('Subscription not found');
      err.status = 404;
      throw err;
    }
    res.locals.page = {
      title: 'Edit organisation subscription',
      link: `/subscriptions/${req.params.id}/edit`,
    };
    res.locals.subscriptionEditId = req.params.id;
    res.render('pages/subscriptions-new');
  } catch (e) {
    next(e);
  }
});

router.get('/', ensureAuthenticated, ensureCareStaff, (req, res) => {
  const accept = req.get('Accept') || '';
  if (accept.includes('application/json')) {
    return careAdminController
      .listSubscriptions()
      .then((data) => res.json({ subscriptions: data }));
  }
  res.locals.page = {
    title: 'Organisation subscriptions',
    link: '/subscriptions',
  };
  res.render('pages/subscriptions');
});

router.get('/:id', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  const accept = req.get('Accept') || '';
  if (!accept.includes('application/json')) {
    return res.redirect(302, `/subscriptions/${req.params.id}/edit`);
  }
  try {
    const subscription = await careAdminController.getSubscription(req.params.id);
    if (!subscription) {
      const err = new Error('Subscription not found');
      err.status = 404;
      throw err;
    }
    res.json({ subscription });
  } catch (e) {
    next(e);
  }
});

router.post('/', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const sub = await careAdminController.createSubscription(req.body, userId);
    const full = await careAdminController.getSubscription(sub._id);
    res.status(201).json({
      id: sub._id,
      tenantId: full && full.tenantId,
      organisationName: full && full.organisationName,
      emailDomain: full && full.emailDomain,
      planTier: sub.planTier,
      seatLimit: sub.seatLimit,
      amount: sub.amount,
      startDate: sub.startDate,
      endDate: sub.endDate,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const sub = await careAdminController.updateSubscription(req.params.id, req.body, userId);
    const full = await careAdminController.getSubscription(sub._id);
    const adminEmails = full
      ? full.adminEmails
      : await careAdminController.adminEmailsForSubscriptionId(sub._id);
    res.json({
      id: sub._id,
      tenantId: full && full.tenantId,
      organisationName: full && full.organisationName,
      emailDomain: full && full.emailDomain,
      planTier: sub.planTier,
      seatLimit: sub.seatLimit,
      amount: sub.amount,
      startDate: sub.startDate,
      endDate: sub.endDate,
      adminEmails,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
