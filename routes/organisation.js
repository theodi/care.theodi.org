const express = require('express');
const router = express.Router();
const organisationController = require('../controllers/organisation');

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

router.get('/', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const ctx = await organisationController.getOrganisationContext(userId);
    const accept = req.get('Accept') || '';
    if (accept.includes('application/json')) {
      if (!ctx) {
        return res.status(404).json({ message: 'No organisation membership' });
      }
      return res.json(ctx);
    }
    const orgName =
      ctx && ctx.subscription && String(ctx.subscription.organisationName || '').trim();
    const page = {
      title: orgName || 'Organisation',
      link: '/organisation',
    };
    res.locals.page = page;
    res.locals.organisation = ctx;
    res.render('pages/organisation');
  } catch (e) {
    next(e);
  }
});

router.post('/members', ensureAuthenticated, async (req, res, next) => {
  try {
    const passportUser = req.session.passport && req.session.passport.user;
    const userId = passportUser && passportUser.id;
    if (userId == null || userId === '') {
      const e = new Error(
        'Your session has no user id (try signing out and signing in again).'
      );
      e.status = 401;
      throw e;
    }
    if (!req.body || typeof req.body !== 'object') {
      const e = new Error(
        'Expected a JSON body — set Content-Type: application/json and send at least { "email" }; optional: membershipRole, licenseAdmin, aiModelAdmin, promptAdmin (organisation admins only).'
      );
      e.status = 400;
      throw e;
    }
    const result = await organisationController.addMember(userId, req.body || {});
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.patch('/members/:membershipId', ensureAuthenticated, async (req, res, next) => {
  try {
    const requesterId = req.session.passport.user.id;
    const result = await organisationController.updateMembership(
      requesterId,
      req.params.membershipId,
      req.body || {}
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.delete('/members/:membershipId', ensureAuthenticated, async (req, res, next) => {
  try {
    const requesterId = req.session.passport.user.id;
    const result = await organisationController.removeMember(requesterId, req.params.membershipId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/ai-eligibility', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const forMessageId =
      typeof req.query.forMessageId === 'string' ? req.query.forMessageId : '';
    const data = await organisationController.getAiEligibilityForUser(userId, forMessageId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/ai-config', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const config = await organisationController.getAiConfigAdmin(userId);
    res.json(config);
  } catch (e) {
    next(e);
  }
});

router.put('/ai-config', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.updateAiConfigAdmin(userId, req.body);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/ai-config/test', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.testAiConfigAdmin(userId, req.body || {});
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/scan-context', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const data = await organisationController.getScanContextAdmin(userId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.put('/scan-context', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.updateScanContextAdmin(userId, req.body);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
