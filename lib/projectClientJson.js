/**
 * JSON representation of a project for normal client loads: omits heavy aiInteractionHistory
 * while exposing counts so the UI can show provenance and lazy-load details.
 */
function buildProjectJsonForClient(projectDoc) {
  const o = projectDoc.toObject
    ? projectDoc.toObject({ depopulate: true })
    : JSON.parse(JSON.stringify(projectDoc));
  const hist = Array.isArray(o.aiInteractionHistory) ? o.aiInteractionHistory : [];
  const aiInteractionHistoryStepCounts = {};
  const aiInteractionHistoryStepSummaries = {};
  for (const r of hist) {
    const sid = r && r.stepId;
    if (!sid) continue;
    aiInteractionHistoryStepCounts[sid] = (aiInteractionHistoryStepCounts[sid] || 0) + 1;
    if (!Array.isArray(aiInteractionHistoryStepSummaries[sid])) {
      aiInteractionHistoryStepSummaries[sid] = [];
    }
    aiInteractionHistoryStepSummaries[sid].push({
      runId: r.runId,
      stepId: sid,
      startedAt: r.startedAt || null,
      completedAt: r.completedAt || null,
      status: r.status || null,
      aiSource: r.aiSource || null,
      model: {
        provider: r.model && r.model.provider ? r.model.provider : null,
        model: r.model && r.model.model ? r.model.model : null,
      },
    });
  }
  for (const sid of Object.keys(aiInteractionHistoryStepSummaries)) {
    aiInteractionHistoryStepSummaries[sid].sort((a, b) => {
      const ta = a.completedAt || a.startedAt || '';
      const tb = b.completedAt || b.startedAt || '';
      return String(tb).localeCompare(String(ta));
    });
  }
  delete o.aiInteractionHistory;
  o.aiInteractionHistoryCount = hist.length;
  o.aiInteractionHistoryStepCounts = aiInteractionHistoryStepCounts;
  o.aiInteractionHistoryStepSummaries = aiInteractionHistoryStepSummaries;
  return o;
}

function wantsFullAiInteractionHistory(req) {
  const q = req.query && req.query.includeAiInteractionHistory;
  if (q === true) return true;
  const s = q == null ? '' : String(q).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;

  // Treat includeProvenance like includeAiInteractionHistory so that when users
  // explicitly opt in, the JSON export contains full details (including
  // provenance fields and AI history).
  const p = req.query && req.query.includeProvenance;
  if (p === true) return true;
  const ps = p == null ? '' : String(p).toLowerCase();
  return ps === '1' || ps === 'true' || ps === 'yes';
}

module.exports = {
  buildProjectJsonForClient,
  wantsFullAiInteractionHistory,
};
