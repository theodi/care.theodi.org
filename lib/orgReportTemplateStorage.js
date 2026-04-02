const fs = require('fs');
const path = require('path');
const { DEFAULT_REPORT_ACCENT_HEX } = require('./reportTemplatePlaceholders');
const { normalizeHex6 } = require('./reportTemplateValidation');

const UPLOAD_REL = path.join('uploads', 'org-report-templates');

function uploadsRoot() {
  return path.join(process.cwd(), UPLOAD_REL);
}

function templatePathForSubscriptionId(subscriptionId) {
  const id =
    subscriptionId != null && subscriptionId !== ''
      ? String(subscriptionId).replace(/[^a-fA-F0-9]/g, '')
      : '';
  if (!id) {
    return null;
  }
  return path.join(uploadsRoot(), `${id}.docx`);
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
function saveOrgReportTemplate(subscriptionId, buffer) {
  const p = templatePathForSubscriptionId(subscriptionId);
  if (!p) {
    return false;
  }
  ensureUploadsDir();
  fs.writeFileSync(p, buffer);
  return true;
}

function deleteOrgReportTemplate(subscriptionId) {
  const p = templatePathForSubscriptionId(subscriptionId);
  if (p && fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

function readOrgReportTemplateBuffer(subscriptionId) {
  const p = templatePathForSubscriptionId(subscriptionId);
  if (!p || !fs.existsSync(p)) {
    return null;
  }
  return fs.readFileSync(p);
}

function orgTemplateFileExists(subscriptionId) {
  const p = templatePathForSubscriptionId(subscriptionId);
  return !!(p && fs.existsSync(p));
}

/**
 * @param {import('mongoose').Document|object|null} sub
 * @returns {string} 6-char hex without #
 */
/** Accent for org admin display (matches last upload); Word export parses the template file on each run. */
function effectiveAccentHexFromSubscription(sub) {
  if (!sub) {
    return DEFAULT_REPORT_ACCENT_HEX;
  }
  const d = sub.reportAccentDetectedHex != null ? String(sub.reportAccentDetectedHex).trim() : '';
  if (d) {
    const n = normalizeHex6(d);
    if (n) {
      return n;
    }
  }
  return DEFAULT_REPORT_ACCENT_HEX;
}

module.exports = {
  templatePathForSubscriptionId,
  saveOrgReportTemplate,
  deleteOrgReportTemplate,
  readOrgReportTemplateBuffer,
  orgTemplateFileExists,
  ensureUploadsDir,
  effectiveAccentHexFromSubscription,
  UPLOAD_REL,
};
