const express = require('express');
const multer = require('multer');
const router = express.Router();
const organisationController = require('../controllers/organisation');
const { ensureAuthenticated } = require('../middleware/auth');

const reportTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    const mt = (file.mimetype || '').toLowerCase();
    const looksLikeDocxName = n.endsWith('.docx');
    const looksLikeDocxMime =
      mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mt === 'application/zip' ||
      mt === 'application/octet-stream';
    if (looksLikeDocxName && looksLikeDocxMime) {
      cb(null, true);
      return;
    }
    cb(new Error('Only .docx files are allowed'));
  },
});

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
        'Expected a JSON body — set Content-Type: application/json and send at least { "email" }; optional: membershipRole, licenseAdmin, aiModelAdmin, promptAdmin, reportAdmin (organisation admins only).'
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

router.post(
  '/report-template',
  ensureAuthenticated,
  reportTemplateUpload.single('reportTemplate'),
  async (req, res, next) => {
    try {
      const userId = req.session.passport.user.id;
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      const result = await organisationController.uploadReportTemplateAdmin(
        userId,
        req.file.buffer,
        req.file.originalname
      );
      if (!result.ok) {
        return res.status(400).json({
          ok: false,
          missingKeys: result.missingKeys,
          warnings: result.warnings,
          message: 'Template is missing required placeholders',
        });
      }
      res.json({
        ok: true,
        message: 'Template saved',
        warnings: result.warnings,
        accentDetectedHex: result.accentDetectedHex,
        accentEffectiveHex: result.accentEffectiveHex,
        originalName: result.originalName,
        uploadedAt: result.uploadedAt,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get('/report-template', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.getReportTemplateAdmin(userId);
    const accept = req.get('Accept') || '';
    if (accept.includes('application/json')) {
      return res.json({
        source: result.source,
        hasCustomTemplate: result.source === 'custom',
        fileName: result.fileName,
        uploadedAt: result.uploadedAt,
        accentDetectedHex: result.accentDetectedHex,
        accentEffectiveHex: result.accentEffectiveHex,
        versions: result.versions || [],
        downloadUrl: '/organisation/report-template',
      });
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.buffer);
  } catch (e) {
    next(e);
  }
});

router.get('/report-template/:versionId', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.getReportTemplateAdmin(userId, {
      versionId: req.params.versionId,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.buffer);
  } catch (e) {
    next(e);
  }
});

router.delete('/report-template', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.deleteReportTemplateAdmin(userId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.delete('/report-template/:versionId', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.deleteReportTemplateVersionAdmin(
      userId,
      req.params.versionId
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/integration-api-keys', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.createTenantIntegrationApiKey(userId, req.body || {});
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.delete('/integration-api-keys/:keyId', ensureAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.passport.user.id;
    const result = await organisationController.deleteTenantIntegrationApiKey(
      userId,
      req.params.keyId
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

const tenantIntegrationApiRoutes = require('./tenantIntegrationApi');
router.use(tenantIntegrationApiRoutes);

module.exports = router;
