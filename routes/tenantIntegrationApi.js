const express = require('express');
const tenantIntegrationApi = require('../controllers/tenantIntegrationApi');
const {
  requireTenantIntegrationJson,
  requireTenantIntegrationDocx,
  validateTenantIdParam,
  tenantIntegrationBearerAuth,
} = require('../middleware/tenantIntegrationApi');

const router = express.Router();

const chain = [
  requireTenantIntegrationJson,
  validateTenantIdParam,
  tenantIntegrationBearerAuth,
];

const chainDocx = [validateTenantIdParam, tenantIntegrationBearerAuth, requireTenantIntegrationDocx];

router.get('/:tenantId/api/v1/projects', chain, tenantIntegrationApi.listProjects);
router.get('/:tenantId/api/v1/projects/:projectId/report', chainDocx, tenantIntegrationApi.getProjectReportDocx);
router.get('/:tenantId/api/v1/projects/:projectId', chain, tenantIntegrationApi.getProject);
router.get('/:tenantId/api/v1/projects/:projectId/summary', chain, tenantIntegrationApi.getProjectSummary);
router.get('/:tenantId/api/v1/projects/:projectId/work-items', chain, tenantIntegrationApi.getProjectWorkItems);

module.exports = router;
