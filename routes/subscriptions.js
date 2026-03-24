const express = require('express');
const router = express.Router();
const { ensureCareStaff } = require('../middleware/careStaff');
const careAdminController = require('../controllers/careAdmin');

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  const accept = req.get('Accept') || '';
  if (accept.includes('application/json')) {
    const error = new Error('Unauthorized access');
    error.status = 401;
    return next(error);
  }
  res.redirect('/');
}

router.get('/new', ensureAuthenticated, ensureCareStaff, (req, res) => {
  res.locals.page = {
    title: 'New organisation subscription',
    link: '/subscriptions/new',
  };
  res.render('pages/subscriptions-new');
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

router.post('/', ensureAuthenticated, ensureCareStaff, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const sub = await careAdminController.createSubscription(req.body, userId);
    res.status(201).json({
      id: sub._id,
      organisationName: sub.organisationName,
      emailDomain: sub.emailDomain,
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
    const sub = await careAdminController.updateSubscription(req.params.id, req.body);
    res.json({
      id: sub._id,
      organisationName: sub.organisationName,
      emailDomain: sub.emailDomain,
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

module.exports = router;
