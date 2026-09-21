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

function templateVersionPathForTenantId(tenantId, versionId) {
  const id =
    tenantId != null && tenantId !== ''
      ? String(tenantId).replace(/[^a-fA-F0-9]/g, '')
      : '';
  const v =
    versionId != null && versionId !== ''
      ? String(versionId).replace(/[^a-zA-Z0-9_-]/g, '')
      : '';
  if (!id || !v) {
    return null;
  }
  return path.join(uploadsRoot(), `${id}-${v}.docx`);
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

function saveOrgReportTemplateVersion(tenantId, versionId, buffer) {
  const versionPath = templateVersionPathForTenantId(tenantId, versionId);
  if (!versionPath) return false;
  ensureUploadsDir();
  fs.writeFileSync(versionPath, buffer);
  return saveOrgReportTemplate(tenantId, buffer);
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

function readOrgReportTemplateVersionBuffer(tenantId, versionId) {
  const p = templateVersionPathForTenantId(tenantId, versionId);
  if (!p || !fs.existsSync(p)) {
    return null;
  }
  return fs.readFileSync(p);
}

function deleteOrgReportTemplateVersion(tenantId, versionId) {
  const p = templateVersionPathForTenantId(tenantId, versionId);
  if (p && fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

function deleteAllOrgReportTemplateVersions(tenantId) {
  const id =
    tenantId != null && tenantId !== ''
      ? String(tenantId).replace(/[^a-fA-F0-9]/g, '')
      : '';
  if (!id) return;
  const root = uploadsRoot();
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.docx')) continue;
    if (!name.startsWith(`${id}-`)) continue;
    const p = path.join(root, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
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
  templateVersionPathForTenantId,
  templatePathForSubscriptionId,
  saveOrgReportTemplate,
  saveOrgReportTemplateVersion,
  deleteOrgReportTemplate,
  readOrgReportTemplateBuffer,
  readOrgReportTemplateVersionBuffer,
  deleteOrgReportTemplateVersion,
  deleteAllOrgReportTemplateVersions,
  orgTemplateFileExists,
  ensureUploadsDir,
  effectiveAccentHexFromTenant,
  effectiveAccentHexFromSubscription,
  UPLOAD_REL,
};
