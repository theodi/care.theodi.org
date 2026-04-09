const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Project = require('../models/project');
const User = require('../models/user');
const { exportProjectToDocxTempFile } = require('../lib/projectDocxExport');
const { buildTenantSharedProjectsFilter } = require('../lib/integrationApiQuery');
const { toIntegrationProjectDto } = require('../lib/integrationProjectDto');
const { buildWorkItemsFromProject } = require('../lib/integrationWorkItems');
const {
  addRiskScoreToProject,
  getUserProjectMetrics,
  getCompletionState,
} = require('./project');
const projectSchema = require('../public/data/schemas/project.json');

function getPublicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_ORIGIN;
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');
  const host = req.get('host');
  if (!host) return '';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${host}`;
}

function encodeCursor(doc) {
  const lm = doc.lastModified instanceof Date ? doc.lastModified.toISOString() : new Date(doc.lastModified).toISOString();
  const payload = { lm, id: String(doc._id) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(s) {
  if (!s || typeof s !== 'string') return null;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    const j = JSON.parse(raw);
    if (!j.lm || !j.id || !mongoose.isValidObjectId(j.id)) return null;
    return { lastModified: new Date(j.lm), _id: new mongoose.Types.ObjectId(j.id) };
  } catch {
    return null;
  }
}

async function listProjects(req, res, next) {
  try {
    const tenantId = req.params.tenantId;
    const base = await buildTenantSharedProjectsFilter(tenantId);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const andParts = [base];

    const sinceRaw = req.query.updatedSince;
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (!Number.isNaN(d.getTime())) {
        andParts.push({ lastModified: { $gte: d } });
      }
    }

    const cursorDecoded = decodeCursor(req.query.cursor);
    if (cursorDecoded) {
      andParts.push({
        $or: [
          { lastModified: { $lt: cursorDecoded.lastModified } },
          {
            lastModified: cursorDecoded.lastModified,
            _id: { $lt: cursorDecoded._id },
          },
        ],
      });
    }

    const filter = andParts.length === 1 ? base : { $and: andParts };

    const docs = await Project.find(filter)
      .sort({ lastModified: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const page = docs.slice(0, limit);
    const baseUrl = getPublicBaseUrl(req);
    const items = page.map((p) => ({
      id: String(p._id),
      title: p.title || '',
      lastModified: p.lastModified ? new Date(p.lastModified).toISOString() : null,
      sharedWithOrganisation: !!p.sharedWithOrganisation,
      tenantId: p.tenantId ? String(p.tenantId) : null,
      integrationExternalId:
        p.integrationExternalId != null && String(p.integrationExternalId).trim() !== ''
          ? String(p.integrationExternalId).trim()
          : null,
      careWebUrl: `${baseUrl}/project/${p._id}/projectDetails`,
    }));

    let nextCursor = null;
    if (docs.length > limit) {
      nextCursor = encodeCursor(page[page.length - 1]);
    }

    res.json({
      data: items,
      nextCursor,
      limit,
    });
  } catch (e) {
    next(e);
  }
}

async function loadVisibleProject(tenantId, projectId) {
  if (!mongoose.isValidObjectId(projectId)) return null;
  const filter = await buildTenantSharedProjectsFilter(tenantId);
  filter._id = new mongoose.Types.ObjectId(projectId);
  return Project.findOne(filter);
}

async function getProject(req, res, next) {
  try {
    const doc = await loadVisibleProject(req.params.tenantId, req.params.projectId);
    if (!doc) {
      return res.status(404).json({ error: 'not_found', message: 'Project not found' });
    }
    addRiskScoreToProject(doc);
    const owner = await User.findById(doc.owner).select('name email').lean();
    const plain = toIntegrationProjectDto(doc);
    if (owner) {
      plain.owner = { id: String(owner._id), name: owner.name, email: owner.email };
    }
    res.json(plain);
  } catch (e) {
    next(e);
  }
}

async function getProjectSummary(req, res, next) {
  try {
    const doc = await loadVisibleProject(req.params.tenantId, req.params.projectId);
    if (!doc) {
      return res.status(404).json({ error: 'not_found', message: 'Project not found' });
    }
    addRiskScoreToProject(doc);
    const metrics = await getUserProjectMetrics([doc]);
    const status = await getCompletionState(doc._id, projectSchema);
    res.json({
      id: String(doc._id),
      title: doc.title || '',
      lastModified: doc.lastModified ? new Date(doc.lastModified).toISOString() : null,
      integrationExternalId:
        doc.integrationExternalId != null && String(doc.integrationExternalId).trim() !== ''
          ? String(doc.integrationExternalId).trim()
          : null,
      completionStatus: status,
      riskCounts: metrics.riskCounts,
      averages: metrics.averages,
      topRisks: metrics.topRisks,
    });
  } catch (e) {
    next(e);
  }
}

async function getProjectWorkItems(req, res, next) {
  try {
    const doc = await loadVisibleProject(req.params.tenantId, req.params.projectId);
    if (!doc) {
      return res.status(404).json({ error: 'not_found', message: 'Project not found' });
    }
    addRiskScoreToProject(doc);
    const baseUrl = getPublicBaseUrl(req);
    const items = buildWorkItemsFromProject(doc, baseUrl);
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
}

/**
 * Word report — same output as the signed-in export (organisation template when configured).
 * Requires Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 */
async function getProjectReportDocx(req, res, next) {
  try {
    const doc = await loadVisibleProject(req.params.tenantId, req.params.projectId);
    if (!doc) {
      return res.status(404).json({ error: 'not_found', message: 'Project not found' });
    }
    const { tempFilePath, attachmentFileName } = await exportProjectToDocxTempFile(doc, req.query);
    res.set(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.set('Content-Disposition', `attachment; filename="${attachmentFileName}"`);
    res.sendFile(path.resolve(tempFilePath), async (sendErr) => {
      if (sendErr) {
        console.error('[tenant-integration-api] docx send:', sendErr);
        if (!res.headersSent) next(sendErr);
        return;
      }
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (unlinkErr) {
        console.error('[tenant-integration-api] docx cleanup:', unlinkErr);
      }
    });
  } catch (e) {
    console.error('[tenant-integration-api] docx build:', e);
    return res.status(500).json({
      error: 'docx_generation_failed',
      message: e.message || 'Failed to generate Word report',
    });
  }
}

module.exports = {
  listProjects,
  getProject,
  getProjectSummary,
  getProjectWorkItems,
  getProjectReportDocx,
  getPublicBaseUrl,
};
