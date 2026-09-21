/**
 * @param {object} project — mongoose doc or plain object with _id, title, lastModified, unintendedConsequences, stakeholders, intendedConsequences, tenantId
 * @param {string} baseUrl — no trailing slash
 */
function buildWorkItemsFromProject(project, baseUrl) {
  const projectId = project._id != null ? String(project._id) : '';
  const title = project.title != null ? String(project.title) : '';
  const tenantIdStr = project.tenantId != null ? String(project.tenantId) : '';
  const integrationExternalId =
    project.integrationExternalId != null && String(project.integrationExternalId).trim() !== ''
      ? String(project.integrationExternalId).trim()
      : null;
  const careWebUrl = `${baseUrl}/project/${projectId}/projectDetails`;
  const updatedAt =
    project.lastModified instanceof Date
      ? project.lastModified.toISOString()
      : project.lastModified
        ? new Date(project.lastModified).toISOString()
        : new Date().toISOString();

  const items = [];

  items.push({
    type: 'project',
    sourceProjectId: projectId,
    sourceProjectTitle: title,
    careWebUrl,
    updatedAt,
    tenantId: tenantIdStr || undefined,
    integrationExternalId: integrationExternalId || undefined,
    payload: {
      id: projectId,
      title,
      sharedWithOrganisation: !!project.sharedWithOrganisation,
      lastModified: updatedAt,
      integrationExternalId,
    },
  });

  const intended = Array.isArray(project.intendedConsequences) ? project.intendedConsequences : [];
  intended.forEach((row, i) => {
    if (!row || !row.consequence) return;
    items.push({
      type: 'intended_outcome',
      sourceProjectId: projectId,
      sourceProjectTitle: title,
      careWebUrl,
      updatedAt,
      tenantId: tenantIdStr || undefined,
      integrationExternalId: integrationExternalId || undefined,
      payload: {
        key: `intended_${projectId}_${i}`,
        consequence: row.consequence,
      },
    });
  });

  const stakeholders = Array.isArray(project.stakeholders) ? project.stakeholders : [];
  stakeholders.forEach((row, i) => {
    if (!row) return;
    items.push({
      type: 'stakeholder',
      sourceProjectId: projectId,
      sourceProjectTitle: title,
      careWebUrl,
      updatedAt,
      tenantId: tenantIdStr || undefined,
      integrationExternalId: integrationExternalId || undefined,
      payload: {
        key: `stakeholder_${projectId}_${i}`,
        stakeholder: row.stakeholder != null ? String(row.stakeholder) : '',
        stakeholderType: row.type || '',
      },
    });
  });

  const uc = Array.isArray(project.unintendedConsequences) ? project.unintendedConsequences : [];
  uc.forEach((row, i) => {
    if (!row) return;
    const riskKey = `risk_${projectId}_${i}`;
    items.push({
      type: 'risk',
      sourceProjectId: projectId,
      sourceProjectTitle: title,
      careWebUrl,
      updatedAt,
      tenantId: tenantIdStr || undefined,
      integrationExternalId: integrationExternalId || undefined,
      payload: {
        riskKey,
        consequence: row.consequence != null ? String(row.consequence) : '',
        outcome: row.outcome || '',
        impact: row.impact || '',
        likelihood: row.likelihood || '',
        riskScore: row.riskScore != null ? row.riskScore : null,
        role: row.role || '',
      },
    });
    const act = row.action;
    if (act && (act.description || act.date || act.stakeholder || act.KPI)) {
      items.push({
        type: 'action',
        sourceProjectId: projectId,
        sourceProjectTitle: title,
        careWebUrl,
        updatedAt,
        tenantId: tenantIdStr || undefined,
        integrationExternalId: integrationExternalId || undefined,
        payload: {
          riskKey,
          description: act.description != null ? String(act.description) : '',
          date: act.date != null ? String(act.date) : '',
          stakeholder: act.stakeholder != null ? String(act.stakeholder) : '',
          KPI: act.KPI != null ? String(act.KPI) : '',
        },
      });
    }
  });

  return items;
}

module.exports = { buildWorkItemsFromProject };
