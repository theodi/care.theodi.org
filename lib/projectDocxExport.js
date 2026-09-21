const fs = require('fs');
const Tenant = require('../models/tenant');
const OrganisationSubscription = require('../models/organisationSubscription');
const { buildDocx } = require('./docxBuilder');
const { readOrgReportTemplateBuffer, orgTemplateFileExists } = require('./orgReportTemplateStorage');
const { extractAccentHexFromDocxBuffer } = require('./reportTemplateValidation');
const { findActiveMembershipsForEmail } = require('./organisationEntitlements');
const projectController = require('../controllers/project');

function truthyQueryParam(raw) {
  return (
    raw !== undefined &&
    raw !== null &&
    raw !== '' &&
    ['1', 'true', 'yes'].includes(String(raw).toLowerCase())
  );
}

/**
 * Build the same Word report as the human UI (GET /project/:id with Accept: docx).
 * @param {import('mongoose').Document} project — mutable; risk scores applied in place
 * @param {Record<string, unknown>} [query] — appendGlossary, includeAiProvenance
 * @returns {Promise<{ tempFilePath: string, attachmentFileName: string }>}
 */
async function exportProjectToDocxTempFile(project, query = {}) {
  const p = await projectController.addRiskScoreToProject(project);
  const owner = await projectController.getProjectOwner(p);
  const metrics = await projectController.getUserProjectMetrics([p]);

  const includeGlossaryAppendix = truthyQueryParam(query.appendGlossary);
  const includeAiProvenance = truthyQueryParam(query.includeAiProvenance);

  let tenantIdForTemplate = p.tenantId;
  if (!tenantIdForTemplate && p.organisationSubscriptionId) {
    const s = await OrganisationSubscription.findById(p.organisationSubscriptionId)
      .select('tenantId')
      .lean();
    tenantIdForTemplate = s && s.tenantId;
  }
  if (!tenantIdForTemplate && owner?.email) {
    const ownerMemberships = await findActiveMembershipsForEmail(owner.email);
    const first = ownerMemberships[0];
    if (first?.tenantId?._id) {
      tenantIdForTemplate = first.tenantId._id;
    } else if (first?.tenantId) {
      tenantIdForTemplate = first.tenantId;
    }
  }

  let templateBuffer = null;
  let accentHex = undefined;
  if (tenantIdForTemplate) {
    try {
      const tenantDoc = await Tenant.findById(tenantIdForTemplate).lean();
      if (tenantDoc) {
        if (tenantDoc.reportTemplateUploadedAt && orgTemplateFileExists(tenantDoc._id)) {
          const buf = readOrgReportTemplateBuffer(tenantDoc._id);
          if (buf && Buffer.isBuffer(buf) && buf.length >= 1000) {
            templateBuffer = buf;
            accentHex = extractAccentHexFromDocxBuffer(buf);
          } else {
            console.warn(
              '[docx] Organisation template file missing or invalid; using default template'
            );
          }
        }
      }
    } catch (orgErr) {
      console.warn('[docx] Could not load organisation template:', orgErr.message);
    }
  }

  const tempFilePath = await buildDocx(p, metrics, owner, {
    includeGlossaryAppendix,
    includeAiProvenance,
    templateBuffer: templateBuffer || undefined,
    accentHex,
  });

  if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    const e = new Error('Generated file does not exist');
    e.status = 500;
    throw e;
  }
  const fileStats = fs.statSync(tempFilePath);
  if (fileStats.size < 1000) {
    const e = new Error(`Generated file is too small (${fileStats.size} bytes), likely corrupted`);
    e.status = 500;
    throw e;
  }

  const sanitizedTitle = String(p.title || 'project_report')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  const attachmentFileName = `${sanitizedTitle || 'project_report'}.docx`;

  return { tempFilePath, attachmentFileName };
}

module.exports = { exportProjectToDocxTempFile, truthyQueryParam };
