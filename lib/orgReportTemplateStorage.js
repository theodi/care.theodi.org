const fs = require('fs');
const path = require('path');
const { DEFAULT_REPORT_ACCENT_HEX } = require('./reportTemplatePlaceholders');
const { normalizeHex6 } = require('./reportTemplateValidation');

const UPLOAD_REL = path.join('uploads', 'org-report-templates');

function uploadsRoot() {
  return path.join(process.cwd(), UPLOAD_REL);
}

/** Report templates are stored per tenant (master record). */
function templatePathForTenantId(tenantId) {
  const id =
    tenantId != null && tenantId !== ''
      ? String(tenantId).replace(/[^a-fA-F0-9]/g, '')
      : '';
  if (!id) {
    return null;
  }
  return path.join(uploadsRoot(), `${id}.docx`);
}

/** @deprecated Use templatePathForTenantId */
function templatePathForSubscriptionId(id) {
  return templatePathForTenantId(id);
}

function ensureUploadsDir() {
  const root = uploadsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
}

/**
 * @returns {boolean} true if written
 */
function saveOrgReportTemplate(tenantId, buffer) {
  const p = templatePathForTenantId(tenantId);
  if (!p) {
    return false;
  }
  ensureUploadsDir();
  fs.writeFileSync(p, buffer);
  return true;
}

function deleteOrgReportTemplate(tenantId) {
  const p = templatePathForTenantId(tenantId);
  if (p && fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

function readOrgReportTemplateBuffer(tenantId) {
  const p = templatePathForTenantId(tenantId);
  if (!p || !fs.existsSync(p)) {
    return null;
  }
  return fs.readFileSync(p);
}

function orgTemplateFileExists(tenantId) {
  const p = templatePathForTenantId(tenantId);
  return !!(p && fs.existsSync(p));
}

/**
 * @param {import('mongoose').Document|object|null} tenant — Tenant lean doc or model
 * @returns {string} 6-char hex without #
 */
function effectiveAccentHexFromTenant(tenant) {
  if (!tenant) {
    return DEFAULT_REPORT_ACCENT_HEX;
  }
  const d = tenant.reportAccentDetectedHex != null ? String(tenant.reportAccentDetectedHex).trim() : '';
  if (d) {
    const n = normalizeHex6(d);
    if (n) {
      return n;
    }
  }
  return DEFAULT_REPORT_ACCENT_HEX;
}

/** @deprecated Use effectiveAccentHexFromTenant (same shape as legacy subscription docs). */
function effectiveAccentHexFromSubscription(tenant) {
  return effectiveAccentHexFromTenant(tenant);
}

module.exports = {
  templatePathForTenantId,
  templatePathForSubscriptionId,
  saveOrgReportTemplate,
  deleteOrgReportTemplate,
  readOrgReportTemplateBuffer,
  orgTemplateFileExists,
  ensureUploadsDir,
  effectiveAccentHexFromTenant,
  effectiveAccentHexFromSubscription,
  UPLOAD_REL,
};
