const mongoose = require('mongoose');
const Tenant = require('../models/tenant');
const { parseIntegrationBearerToken, verifyIntegrationToken } = require('../lib/tenantIntegrationKeys');
const { getActiveSubscriptionForTenantId } = require('../lib/organisationEntitlements');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function requireTenantIntegrationJson(req, res, next) {
  const accept = req.get('Accept') || '';
  if (!accept.includes('application/json')) {
    return res.status(406).json({
      error: 'not_acceptable',
      message: 'Accept header must include application/json',
    });
  }
  next();
}

function requireTenantIntegrationDocx(req, res, next) {
  const accept = req.get('Accept') || '';
  if (!accept.includes(DOCX_MIME)) {
    return res.status(406).json({
      error: 'not_acceptable',
      message: `Accept header must include ${DOCX_MIME}`,
    });
  }
  next();
}

function validateTenantIdParam(req, res, next) {
  const id = req.params.tenantId;
  if (!id || !/^[a-fA-F0-9]{24}$/.test(id) || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'bad_request', message: 'Invalid tenant id' });
  }
  next();
}

async function tenantIntegrationBearerAuth(req, res, next) {
  try {
    const auth = req.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(\S+)/i);
    if (!m) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authorization Bearer token required',
      });
    }
    const parsed = parseIntegrationBearerToken(m[1]);
    if (!parsed) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
    }
    if (!mongoose.isValidObjectId(parsed.keyId)) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
    }
    const kid = new mongoose.Types.ObjectId(parsed.keyId);
    const tenant = await Tenant.findOne({ 'integrationApiKeys._id': kid });
    if (!tenant) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
    }
    const entry = tenant.integrationApiKeys.id(kid);
    if (!entry || !verifyIntegrationToken(parsed.fullToken, entry.keyHash)) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
    }
    if (String(tenant._id) !== String(req.params.tenantId)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'API key does not match tenant in URL',
      });
    }
    const activeSub = await getActiveSubscriptionForTenantId(tenant._id);
    if (!activeSub) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'No active subscription for this tenant',
      });
    }
    Tenant.updateOne(
      { _id: tenant._id, 'integrationApiKeys._id': kid },
      { $set: { 'integrationApiKeys.$.lastUsedAt': new Date() } }
    )
      .exec()
      .catch(() => {});
    req.tenantIntegration = { tenantId: tenant._id, tenant };
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = {
  requireTenantIntegrationJson,
  requireTenantIntegrationDocx,
  validateTenantIdParam,
  tenantIntegrationBearerAuth,
  DOCX_MIME,
};
