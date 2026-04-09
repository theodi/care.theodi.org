/**
 * Strip sensitive / heavy fields for tenant integration API responses.
 * @param {import('mongoose').Document | object} project
 */
function toIntegrationProjectDto(project) {
  const o =
    project && typeof project.toObject === 'function'
      ? project.toObject({ virtuals: false })
      : { ...(project || {}) };
  delete o.aiInteractionHistory;
  if (o.owner && o.owner._id) {
    o.owner = { id: String(o.owner._id), name: o.owner.name, email: o.owner.email };
  } else if (o.owner) {
    o.owner = { id: String(o.owner) };
  }
  if (o.tenantId) o.tenantId = String(o.tenantId);
  if (o.organisationSubscriptionId) o.organisationSubscriptionId = String(o.organisationSubscriptionId);
  if (o._id) o.id = String(o._id);
  delete o.__v;
  return o;
}

module.exports = { toIntegrationProjectDto };
