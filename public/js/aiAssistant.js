let responseData = {};
/** runId of the AI invocation that populated the current suggestions table (for POST .../selections). */
let activeAiRunId = null;
let aiMessage = "";
let completeAssessmentRunId = null;
let reasoningLastProgressAt = 0;
let reasoningLastFingerprint = '';
/** Populated CARE template; `{{orgContext}}` filled in refreshAiMessagePreview (same as server). */
let aiMessageBase = '';
/** Plain text for this step from GET /organisation/ai-eligibility?forMessageId=… */
let careScanContextPlainText = null;

/** Must match lib/organisationScanContext.js replaceOrgContextPlaceholder */
const ORG_CONTEXT_PLACEHOLDER = /\{\{orgContext\}\}/g;

function applyOrgContextPlaceholderPreview(baseMessage) {
    const base = typeof baseMessage === 'string' ? baseMessage : '';
    const t =
        careIncludeOrgContextParam() &&
        careScanContextPlainText != null &&
        typeof careScanContextPlainText === 'string' &&
        careScanContextPlainText.trim()
            ? careScanContextPlainText.trim()
            : '';
    return base.replace(ORG_CONTEXT_PLACEHOLDER, t);
}

function refreshAiMessagePreview() {
    const el = document.getElementById('aiMessage');
    if (!el) return;
    aiMessage = applyOrgContextPlaceholderPreview(aiMessageBase);
    el.innerHTML = renderMessageHTML(aiMessage);
}

/** True when the preview is collapsed (CSS can hide without setting inline style). */
function isAiMessagePreviewHidden(aiMessageEl) {
    if (!aiMessageEl) return true;
    const inline = aiMessageEl.style.display;
    if (inline === 'none') return true;
    if (inline === 'block') return false;
    return window.getComputedStyle(aiMessageEl).display === 'none';
}

function careAiScopeEl() {
    const pageIdEl = document.getElementById('pageId');
    const messageId = pageIdEl ? pageIdEl.value : '';
    if (messageId === 'completeAssessment') {
        return document.querySelector('.main-content .content-block.aiContainer') || document.getElementById('careAiModal');
    }
    return document.getElementById('careAiModal');
}

function careAiPreEl() {
    const scope = careAiScopeEl();
    return scope ? scope.querySelector('.preAI') : null;
}

function bindAiMessageExpandControlsOnce() {
    const scope = careAiScopeEl();
    if (!scope) return;
    const expandToggle = scope.querySelector('.expandToggle');
    const expandButton = scope.querySelector('.expandButton');
    const aiMessageEl = scope.querySelector('#aiMessage');
    if (!expandToggle || !expandButton || !aiMessageEl) return;
    if (expandButton.dataset.careExpandBound === '1') return;
    expandButton.dataset.careExpandBound = '1';

    function expandPreview() {
        aiMessageEl.style.display = 'block';
        expandButton.textContent = '-';
        expandToggle.style.display = 'none';
    }

    function collapsePreview() {
        aiMessageEl.style.display = 'none';
        expandButton.textContent = '+';
        expandToggle.style.display = 'block';
    }

    expandToggle.addEventListener('click', function (event) {
        event.preventDefault();
        if (isAiMessagePreviewHidden(aiMessageEl)) expandPreview();
    });

    expandButton.addEventListener('click', function (event) {
        event.preventDefault();
        if (isAiMessagePreviewHidden(aiMessageEl)) expandPreview();
        else collapsePreview();
    });
}

function careAiSourceParam() {
    try {
        if (sessionStorage.getItem('careAiSource') === 'built_in') {
            return 'built_in';
        }
    } catch (e) { /* ignore */ }
    return 'organisation';
}

function careIncludeOrgContextParam() {
    try {
        const v = sessionStorage.getItem('careIncludeOrgContext');
        if (v === '0') return false;
        return true;
    } catch (e) {
        return true;
    }
}

function careIncludeExistingStepDataParam() {
    try {
        const v = sessionStorage.getItem('careIncludeExistingStepData');
        if (v === '0') return false;
        return true;
    } catch (e) {
        return true;
    }
}

function careHasExistingAnswersForStep(messageId) {
    if (typeof projectData !== 'object' || !projectData) return false;
    if (messageId === 'intendedConsequences') {
        return Array.isArray(projectData.intendedConsequences) && projectData.intendedConsequences.length > 0;
    }
    if (messageId === 'unintendedConsequences' || messageId === 'riskEvaluation' || messageId === 'actionPlanning') {
        return Array.isArray(projectData.unintendedConsequences) && projectData.unintendedConsequences.length > 0;
    }
    if (messageId === 'stakeholders') {
        return Array.isArray(projectData.stakeholders) && projectData.stakeholders.length > 0;
    }
    return false;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Shown when POST /assistant/* returns 403 (no membership / org entitlement). */
var CARE_AI_PLAN_FORBIDDEN_MESSAGE =
    'Your plan does not include AI use. Please consider upgrading.';

/**
 * @param {Response} response — non-ok fetch response (body not yet read)
 * @param {string} fallback — if status is not 403 and JSON has no message
 */
async function assistantErrorMessageFromResponse(response, fallback) {
    if (response.status === 403) {
        return CARE_AI_PLAN_FORBIDDEN_MESSAGE;
    }
    try {
        const data = await response.json();
        if (data && typeof data.message === 'string' && data.message.trim()) {
            return data.message.trim();
        }
    } catch (e) {
        /* ignore */
    }
    return fallback;
}

/** Pretty-print JSON in raw model output for <pre>; otherwise return original text (newlines preserved). */
function prettyPrintRawModelResponse(raw) {
    if (raw == null) {
        return '';
    }
    var s = String(raw);
    var trimmed = s.trim();
    if (!trimmed) {
        return s;
    }
    var candidate = trimmed;
    if (/^```/.test(candidate)) {
        candidate = candidate.replace(/^```(?:json|JSON)?\s*/i, '');
        candidate = candidate.replace(/\s*```\s*$/i, '');
        candidate = candidate.trim();
    }
    try {
        return JSON.stringify(JSON.parse(candidate), null, 2);
    } catch (e) {
        return s;
    }
}

function getSuggestionsTableRows(messageId, result) {
    if (!result || typeof result !== 'object') {
        return [];
    }
    if (messageId === 'riskEvaluation' || messageId === 'actionPlanning') {
        return Array.isArray(result.unintendedConsequences) ? result.unintendedConsequences : [];
    }
    if (messageId === 'intendedConsequences') {
        return Array.isArray(result.intendedConsequences) ? result.intendedConsequences : [];
    }
    if (messageId === 'unintendedConsequences') {
        return Array.isArray(result.unintendedConsequences) ? result.unintendedConsequences : [];
    }
    if (messageId === 'stakeholders') {
        return Array.isArray(result.stakeholders) ? result.stakeholders : [];
    }
    return [];
}

function getAppliedIndicesUnion(run) {
    if (!run || !Array.isArray(run.selections)) {
        return new Set();
    }
    const s = new Set();
    run.selections.forEach(function (sel) {
        (sel.indices || []).forEach(function (i) {
            s.add(Number(i));
        });
    });
    return s;
}

function projectMergeKeyForAiStep(messageId) {
    if (messageId === 'intendedConsequences') {
        return 'intendedConsequences';
    }
    if (messageId === 'stakeholders') {
        return 'stakeholders';
    }
    return 'unintendedConsequences';
}

async function refreshProjectAiHistory(projectId) {
    if (!projectId) {
        return false;
    }
    try {
        const pr = await fetch(
            '/project/' + encodeURIComponent(projectId) + '/ai-interaction-history',
            { headers: { Accept: 'application/json' } }
        );
        if (!pr.ok) {
            return false;
        }
        const data = await pr.json();
        if (Array.isArray(data.aiInteractionHistory)) {
            projectData.aiInteractionHistory = data.aiInteractionHistory;
            return true;
        }
    } catch (e) {
        console.warn('Could not refresh AI history', e);
    }
    return false;
}

function getStepHistoryCount(messageId) {
    const c = projectData && projectData.aiInteractionHistoryStepCounts;
    if (c && typeof c === 'object' && typeof c[messageId] === 'number') {
        return c[messageId];
    }
    return 0;
}

const CARE_AI_SCAN_STEPS = ['intendedConsequences', 'unintendedConsequences', 'stakeholders'];

const CARE_AI_STEP_UI = {
    intendedConsequences: {
        title: 'AI suggestions for intended consequences',
        description:
            'The AI will review your project details and suggest possible intended consequences. Treat suggestions as a guide for planning.',
        runLabel: 'Use AI to suggest intended consequences',
    },
    unintendedConsequences: {
        title: 'AI suggestions for unintended consequences',
        description:
            'The AI will review your project and suggest unintended consequences, impacts, and actions. Treat suggestions as a guide for planning.',
        runLabel: 'Use AI to suggest unintended consequences',
    },
    stakeholders: {
        title: 'AI suggestions for stakeholders',
        description:
            'The AI will review your consequences and suggest stakeholders who may be involved or impacted.',
        runLabel: 'Use AI to suggest stakeholders',
    },
};

let careAiModalUiInitialized = false;

function careAiStepHasCompactUi(messageId) {
    return CARE_AI_SCAN_STEPS.indexOf(messageId) !== -1;
}

function setCareAiTitleSlotVisible(visible) {
    const slot = document.getElementById('careAiTitleSlot');
    if (!slot) return;
    slot.hidden = !visible;
}

function applyCareAiStepUi(messageId) {
    const ui = CARE_AI_STEP_UI[messageId];
    if (!ui) return;
    const titleEl = document.getElementById('careAiModalTitle');
    const descEl = document.getElementById('careAiModalDescription');
    const runAI = document.getElementById('runAI');
    if (titleEl) titleEl.textContent = ui.title;
    if (descEl) descEl.textContent = ui.description;
    if (runAI) runAI.textContent = ui.runLabel;
}

function resetCareAiModalPanelExtras() {
    const panel = careAiModalMountEl();
    if (!panel) return;
    panel.querySelectorAll('.aiRunning, .postAI, #careAiHistory').forEach(function (el) {
        el.remove();
    });
    panel.querySelectorAll('.care-ai-source-picker').forEach(function (el) {
        el.remove();
    });
    const expandButton = document.querySelector('#careAiModal .expandButton');
    if (expandButton) {
        delete expandButton.dataset.careExpandBound;
    }
    document.querySelectorAll('#careAiModal .preAI, #careAiModal .postAI, #careAiModal .aiRunning').forEach(function (el) {
        el.style.display = '';
    });
    const assessmentStatus = document.getElementById('assessmentStatus');
    const assessmentError = document.getElementById('assessmentError');
    if (assessmentStatus) assessmentStatus.textContent = '';
    if (assessmentError) assessmentError.textContent = '';
}

function careAiModalMountEl() {
    const modal = document.getElementById('careAiModal');
    return modal ? modal.querySelector('.care-ai-modal-panel') : null;
}

function careAiDynamicMountEl() {
    const pageIdEl = document.getElementById('pageId');
    const messageId = pageIdEl ? pageIdEl.value : '';
    if (messageId === 'completeAssessment') {
        return document.querySelector('.main-content .content-block.aiContainer');
    }
    return careAiModalMountEl();
}

function cleanupCareAiCompactUi() {
    if (typeof window.careCloseAiModal === 'function') {
        window.careCloseAiModal();
        return;
    }
    const modal = document.getElementById('careAiModal');
    if (modal) {
        modal.classList.remove('care-ai-modal--open');
    }
    document.body.classList.remove('care-ai-modal-open');
}

function prepareCareAiModalDom() {
    cleanupCareAiCompactUi();
    const modal = document.getElementById('careAiModal');
    if (modal) {
        modal.style.display = '';
    }
}

function updateCareAiCompactStatus(messageId) {
    const el = document.getElementById('careAiCompactStatus');
    if (!el) return;
    const runs = runHistoryMetaForStep(messageId);
    const count = runs.length > 0 ? runs.length : getStepHistoryCount(messageId);
    if (count > 0) {
        el.textContent = count === 1 ? '1 previous AI run' : count + ' previous AI runs';
        el.classList.add('care-ai-compact-status--has-history');
    } else {
        el.textContent = 'No AI runs yet';
        el.classList.remove('care-ai-compact-status--has-history');
    }
}

function initCareAiModal() {
    if (careAiModalUiInitialized) return;
    const openBtn = document.getElementById('careAiOpenModal');
    const modal = document.getElementById('careAiModal');
    if (!modal || !openBtn) return;
    careAiModalUiInitialized = true;

    const closeBtn = modal.querySelector('.care-ai-modal-close');

    function closeModal() {
        modal.classList.remove('care-ai-modal--open');
        document.body.classList.remove('care-ai-modal-open');
    }

    function openModal() {
        document.querySelectorAll('.preAI').forEach(function (el) {
            if (el.closest('#careAiModal')) {
                el.style.display = '';
            }
        });
        modal.classList.add('care-ai-modal--open');
        document.body.classList.add('care-ai-modal-open');
    }

    window.careOpenAiModal = openModal;
    window.careCloseAiModal = closeModal;

    openBtn.addEventListener('click', function (event) {
        event.preventDefault();
        openModal();
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', function (event) {
            event.preventDefault();
            closeModal();
        });
    }
    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            closeModal();
        }
    });
    if (!document.documentElement.dataset.careAiModalEscapeBound) {
        document.documentElement.dataset.careAiModalEscapeBound = '1';
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && document.getElementById('careAiModal')?.classList.contains('care-ai-modal--open')) {
                if (typeof window.careCloseAiModal === 'function') {
                    window.careCloseAiModal();
                }
            }
        });
    }

    const runAI = document.getElementById('runAI');
    if (runAI) {
        runAI.addEventListener('click', function (event) {
            event.preventDefault();
            const form = document.getElementById('dataForm');
            const projectId = form && form.dataset ? form.dataset.projectId : '';
            if (projectId) {
                getInlineAIReponse(projectId);
            }
        });
    }
}

function hasLoadedAiHistoryArray() {
    return Array.isArray(projectData.aiInteractionHistory);
}

function runHistoryMetaForStep(messageId) {
    if (hasLoadedAiHistoryArray()) {
        return projectData.aiInteractionHistory
            .filter(function (r) {
                return r && r.stepId === messageId;
            })
            .map(function (r) {
                return {
                    runId: r.runId,
                    stepId: r.stepId,
                    startedAt: r.startedAt || '',
                    completedAt: r.completedAt || '',
                    status: r.status || '',
                    aiSource: r.aiSource || '',
                    model: r.model || {},
                };
            });
    }
    const all = projectData && projectData.aiInteractionHistoryStepSummaries;
    if (!all || typeof all !== 'object' || !Array.isArray(all[messageId])) {
        return [];
    }
    return all[messageId].map(function (r) {
        return {
            runId: r && r.runId ? r.runId : '',
            stepId: r && r.stepId ? r.stepId : messageId,
            startedAt: r && r.startedAt ? r.startedAt : '',
            completedAt: r && r.completedAt ? r.completedAt : '',
            status: r && r.status ? r.status : '',
            aiSource: r && r.aiSource ? r.aiSource : '',
            model: (r && r.model) || {},
        };
    });
}

function sortRunsNewestFirst(arr) {
    return arr.sort(function (a, b) {
        const ta = a.completedAt || a.startedAt || '';
        const tb = b.completedAt || b.startedAt || '';
        return String(tb).localeCompare(String(ta));
    });
}

async function fetchAiRunDetail(projectId, runId) {
    const response = await fetch(
        '/project/' +
            encodeURIComponent(projectId) +
            '/ai-interaction-history/' +
            encodeURIComponent(runId),
        { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) {
        throw new Error('Could not load AI run detail');
    }
    const data = await response.json();
    return data && data.aiInteractionRun ? data.aiInteractionRun : null;
}

function renderAiRunDetailBody(body, run, projectIdLocal, messageId) {
    var applied = getAppliedIndicesUnion(run);
    var sug = Array.isArray(run.suggestions) ? run.suggestions : [];
    var rows = '';
    sug.forEach(function (row, i) {
        var dis = applied.has(i) ? ' disabled checked' : '';
        rows +=
            '<tr><td><input type="checkbox" name="historyResponseSelect" value="' +
            i +
            '"' +
            dis +
            '/></td><td>' +
            parseJsonToHtml(row) +
            '</td></tr>';
    });
    body.innerHTML =
        '<div class="care-ai-history-body-inner">' +
        '<details class="care-ai-prompt-details"><summary>Prompt sent to the model</summary><pre class="care-ai-pre">' +
        escapeHtml(run.promptFull || '') +
        '</pre></details>' +
        (run.reasoning
            ? '<details class="care-ai-prompt-details"><summary>AI reasoning</summary><pre class="care-ai-pre">' +
              escapeHtml(run.reasoning) +
              '</pre></details>'
            : '') +
        (run.rawResponseText
            ? '<details class="care-ai-prompt-details"><summary>Raw model response</summary><pre class="care-ai-pre">' +
              escapeHtml(prettyPrintRawModelResponse(run.rawResponseText)) +
              '</pre></details>'
            : '') +
        '<p class="small care-ai-history-flags">Flags: existing answers in prompt: ' +
        !!run.includeExistingStepData +
        '; org context: ' +
        !!run.includeOrganisationContext +
        '</p>' +
        '<table class="care-ai-history-suggestions"><thead><tr><th>Select</th><th>Response</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>' +
        '<p class="care-ai-history-add-wrap"><button type="button" class="btn btn-primary care-ai-add-from-history">Add selected from this run</button></p>' +
        '</div>';
    body.setAttribute('data-care-populated', '1');
    body.querySelector('.care-ai-add-from-history').addEventListener('click', function () {
        activeAiRunId = run.runId;
        var selectedResponses = [];
        var indices = [];
        body.querySelectorAll('input[name="historyResponseSelect"]').forEach(function (cb) {
            if (cb.checked && !cb.disabled) {
                var responseIndex = parseInt(cb.value, 10);
                indices.push(responseIndex);
                selectedResponses.push(sug[responseIndex]);
            }
        });
        if (selectedResponses.length === 0) {
            return;
        }
        void postSelectionsAndMerge(projectIdLocal, run.runId, messageId, indices, selectedResponses, body);
    });
}

function renderAiRunHistoryPanel(messageId) {
    const wrap = document.getElementById('careAiHistory');
    if (!wrap) {
        return;
    }
    const form = document.getElementById('dataForm');
    const projectIdLocal = form && form.dataset ? form.dataset.projectId : '';
    const runs = sortRunsNewestFirst(runHistoryMetaForStep(messageId));

    if (runs.length === 0) {
        if (getStepHistoryCount(messageId) > 0) {
            wrap.innerHTML = '<p class="small care-ai-history-empty">Saved runs are available but could not be listed.</p>';
        } else {
            wrap.innerHTML = '<p class="small care-ai-history-empty">No saved AI runs for this step yet.</p>';
        }
        updateCareAiCompactStatus(messageId);
        return;
    }
    var html = '<h3 class="care-ai-history-title">AI run history</h3><ul class="care-ai-history-list">';
    runs.forEach(function (run) {
        const when = run.completedAt || run.startedAt || '';
        const modelBits = run.model || {};
        const modelLabel =
            (run.aiSource === 'built_in' ? 'CARE built-in' : 'Organisation') +
            ' · ' +
            (modelBits.provider || '?') +
            ' / ' +
            (modelBits.model || '?');
        const st = run.status === 'failed' ? 'Failed' : 'Completed';
        html +=
            '<li class="care-ai-history-item">' +
            '<details class="care-ai-history-run" data-care-run-id="' +
            escapeHtml(run.runId || '') +
            '">' +
            '<summary class="care-ai-history-summary">' +
            escapeHtml(when) +
            ' — ' +
            escapeHtml(modelLabel) +
            ' (' +
            escapeHtml(st) +
            ')</summary>' +
            '<div class="care-ai-history-body" data-care-populated="0"></div>' +
            '</details>' +
            '</li>';
    });
    html += '</ul>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.care-ai-history-run').forEach(function (detEl) {
        detEl.addEventListener('toggle', function () {
            if (!detEl.open) {
                return;
            }
            const body = detEl.querySelector('.care-ai-history-body');
            if (!body || body.getAttribute('data-care-populated') === '1') {
                return;
            }
            if (body.getAttribute('data-care-loading') === '1') {
                return;
            }
            const runId = detEl.getAttribute('data-care-run-id');
            if (!runId) {
                return;
            }
            body.setAttribute('data-care-loading', '1');
            body.innerHTML = '<p class="small care-ai-history-loading">Loading…</p>';
            void (async function () {
                try {
                    const loaded = hasLoadedAiHistoryArray()
                        ? projectData.aiInteractionHistory.find(function (r) {
                              return r && String(r.runId) === String(runId);
                          })
                        : null;
                    const run = loaded || (await fetchAiRunDetail(projectIdLocal, runId));
                    if (!run) {
                        throw new Error('Run not found');
                    }
                    renderAiRunDetailBody(body, run, projectIdLocal, messageId);
                } catch (e) {
                    body.innerHTML = '<p class="small">Could not load AI run history. Try again.</p>';
                    body.setAttribute('data-care-populated', '0');
                } finally {
                    body.setAttribute('data-care-loading', '0');
                }
            })();
        });
    });
    updateCareAiCompactStatus(messageId);
}

async function postSelectionsAndMerge(projectId, runId, messageId, indices, selectedResponses, detailEl) {
    try {
        const r = await fetch(
            '/project/' +
                encodeURIComponent(projectId) +
                '/ai-runs/' +
                encodeURIComponent(runId) +
                '/selections',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({ indices: indices, items: selectedResponses }),
            }
        );
        if (!r.ok) {
            throw new Error('Could not record selection');
        }
    } catch (e) {
        console.error(e);
    }
    var mergeKey = projectMergeKeyForAiStep(messageId);
    var toMerge = {};
    toMerge[mergeKey] = selectedResponses;
    projectData = mergeObjects(projectData, toMerge);
    if (typeof window.careCloseAiModal === 'function') {
        window.careCloseAiModal();
    } else {
        prepareCareAiModalDom();
    }
    await persistProjectDataAfterAiMerge();
    await reloadPage();
    await refreshProjectAiHistory(projectId);
    renderAiRunHistoryPanel(messageId);
    var runDetails = detailEl && detailEl.closest('.care-ai-history-run');
    if (runDetails) {
        runDetails.open = false;
    }
}

function assistantQueryString(extra) {
    const p = new URLSearchParams();
    p.set('aiSource', careAiSourceParam());
    if (careIncludeOrgContextParam()) {
        p.set('includeOrgContext', '1');
    }
    p.set('includeExisting', careIncludeExistingStepDataParam() ? '1' : '0');
    if (extra && Object.prototype.hasOwnProperty.call(extra, 'merge')) {
        p.set('merge', String(extra.merge));
    }
    return p.toString();
}

/**
 * One bordered block: optional org model choice + optional org guidance (same .care-ai-source-intro styling).
 */
function injectCareAiStepOptions(orgAiAvailable, scanContextByStage, messageId) {
    const pre = careAiPreEl();
    if (!pre || pre.querySelector('.care-ai-source-picker')) return;
    const hasContext = !!(scanContextByStage && messageId && scanContextByStage[messageId]);
    if (!orgAiAvailable && !hasContext) return;

    var storedSource = '';
    try {
        storedSource = sessionStorage.getItem('careAiSource') || '';
    } catch (e) { /* ignore */ }
    var useBuiltIn = storedSource === 'built_in';

    var ctxStored = '';
    try {
        ctxStored = sessionStorage.getItem('careIncludeOrgContext') || '';
    } catch (e) { /* ignore */ }
    var contextOn = ctxStored !== '0';

    var hasExistingForStep = careHasExistingAnswersForStep(messageId);
    var existingStored = '';
    try {
        existingStored = sessionStorage.getItem('careIncludeExistingStepData') || '';
    } catch (e) { /* ignore */ }
    var existingOn = hasExistingForStep && existingStored !== '0';
    if (!hasExistingForStep) {
        try {
            sessionStorage.setItem('careIncludeExistingStepData', '0');
        } catch (e) { /* ignore */ }
    }

    var legendText = orgAiAvailable ? 'Choose AI provider' : 'Organisation guidance';
    var html = '<legend class="care-ai-source-legend">' + legendText + '</legend>';
    if (orgAiAvailable) {
        html +=
            '<p class="small care-ai-source-intro">Please choose which AI provider to use for this step: your organisation\'s default model, or CARE built-in (server) settings.</p>' +
            '<div class="care-ai-source-row">' +
            '<label class="care-ai-source-option"><input type="radio" name="careAiSource" value="organisation"' +
            (useBuiltIn ? '' : ' checked') +
            '> Organisational default</label> ' +
            '<label class="care-ai-source-option"><input type="radio" name="careAiSource" value="built_in"' +
            (useBuiltIn ? ' checked' : '') +
            '> CARE built-in</label>' +
            '</div>';
    }
    if (hasContext) {
        if (orgAiAvailable) {
            html += '<hr class="care-ai-source-divider" aria-hidden="true"/>';
        }
        html +=
            '<label class="care-ai-source-option care-ai-source-option--block"><input type="checkbox" name="careIncludeOrgContext" value="1"' +
            (contextOn ? ' checked' : '') +
            '> Include organisation guidance in the AI prompt</label>';
    }

    if (hasExistingForStep) {
        html +=
            '<label class="care-ai-source-option care-ai-source-option--block"><input type="checkbox" name="careIncludeExistingStepData" value="1"' +
            (existingOn ? ' checked' : '') +
            '> Include existing answers for this step in the AI prompt</label>';
    } else {
        html +=
            '<label class="care-ai-source-option care-ai-source-option--block">' +
            '<input type="checkbox" name="careIncludeExistingStepData" value="1" disabled>' +
            ' Include existing answers for this step in the AI prompt' +
            '<span class="small"><em>(Disabled: no existing answers for this step yet)</em></span>' +
            '</label>';
    }

    var fieldset = document.createElement('fieldset');
    fieldset.className = 'care-ai-source-picker';
    fieldset.innerHTML = html;
    var queryPreview = pre.querySelector('#aiMessageContainer');
    if (queryPreview && queryPreview.parentNode === pre) {
        pre.insertBefore(fieldset, queryPreview);
    } else {
        pre.insertBefore(fieldset, pre.firstChild);
    }

    fieldset.addEventListener('change', function (ev) {
        var t = ev.target;
        if (!t) return;
        if (t.name === 'careAiSource') {
            try {
                sessionStorage.setItem('careAiSource', t.value);
            } catch (e) { /* ignore */ }
        }
        if (t.name === 'careIncludeOrgContext') {
            try {
                sessionStorage.setItem('careIncludeOrgContext', t.checked ? '1' : '0');
            } catch (e) { /* ignore */ }
            refreshAiMessagePreview();
        }
        if (t.name === 'careIncludeExistingStepData') {
            try {
                sessionStorage.setItem('careIncludeExistingStepData', t.checked ? '1' : '0');
            } catch (e) { /* ignore */ }
        }
    });
}

/**
 * The full-assessment pipeline sends one request per stage (same templates as each section).
 * Legacy completeAssessment.txt describes a single monolithic prompt and must not be shown as the “query sent”.
 */
function getCompleteAssessmentPromptExplanationText() {
    return (
        'This full run does not send one combined prompt.\n\n' +
        'The server runs five separate AI requests, in order, each using the same message template as that step elsewhere in the tool:\n' +
        '1. Intended consequences\n' +
        '2. Unintended consequences\n' +
        '3. Stakeholders\n' +
        '4. Risk evaluation\n' +
        '5. Action planning\n\n' +
        'Each request includes your project details (title, objectives, data used) and, where relevant, existing answers from earlier steps. Options such as organisation guidance and “include existing answers” apply per stage, using your settings when you start the run.\n\n' +
        'To see the exact wording and placeholders for a stage, open that section of the evaluation and expand “Click here to view the query and data sent to the AI” there.'
    );
}

async function loadAI() {
    const form = document.getElementById("dataForm");
    const projectId = form.dataset.projectId;
    const messageId = document.getElementById("pageId").value;
    initCareAiModal();

    const hasCompactAiUi = careAiStepHasCompactUi(messageId);
    setCareAiTitleSlotVisible(hasCompactAiUi);

    if (!hasCompactAiUi && messageId !== 'completeAssessment') {
        prepareCareAiModalDom();
        return;
    }

    let message;
    try {
        if (messageId === 'completeAssessment') {
            message = getCompleteAssessmentPromptExplanationText();
        } else {
            const response = await fetch('/data/messageTemplates/' + messageId + '.txt');
            if (!response.ok) {
                throw new Error('Failed to fetch message');
            }
            message = await response.text();
        }
    } catch (error) {
        return;
    }

    var orgAiAvailable = false;
    var scanContextByStage = {};
    careScanContextPlainText = null;
    try {
        const eligUrl =
            '/organisation/ai-eligibility?forMessageId=' + encodeURIComponent(messageId);
        const er = await fetch(eligUrl, { headers: { Accept: 'application/json' } });
        if (er.ok) {
            const d = await er.json();
            orgAiAvailable = !!d.organisationAiAvailable;
            scanContextByStage = d.scanContextByStage && typeof d.scanContextByStage === 'object'
                ? d.scanContextByStage
                : {};
            if (d.scanContextText != null && typeof d.scanContextText === 'string' && d.scanContextText.trim()) {
                careScanContextPlainText = d.scanContextText;
            }
        }
    } catch (e) {
        orgAiAvailable = false;
    }

    if (messageId === 'completeAssessment') {
        prepareCareAiModalDom();
        await addAIElements();
        injectCareAiStepOptions(orgAiAvailable, scanContextByStage, messageId);
        renderMessage(projectData, message);
        bindAiMessageExpandControlsOnce();
        return;
    }

    if (!hasCompactAiUi) {
        prepareCareAiModalDom();
        return;
    }

    prepareCareAiModalDom();
    resetCareAiModalPanelExtras();
    applyCareAiStepUi(messageId);

    await addAIElements();
    injectCareAiStepOptions(orgAiAvailable, scanContextByStage, messageId);

    renderMessage(projectData,message);

    bindAiMessageExpandControlsOnce();

    if (messageId !== 'completeAssessment') {
        renderAiRunHistoryPanel(messageId);
        updateCareAiCompactStatus(messageId);
    }
}

async function persistProjectDataAfterAiMerge() {
    if (typeof window.sendDataToServer === 'function') {
        await window.sendDataToServer(projectData, { autoSave: true });
    }
}

async function addAIElements() {
    const mount = careAiDynamicMountEl();
    if (!mount) {
        return;
    }

    if (mount.querySelector('.aiRunning')) {
        return;
    }

    // Create the aiRunning element
    const aiRunning = document.createElement('div');
    aiRunning.classList.add('aiRunning');
    aiRunning.innerHTML = `
        <h2>Running assessment, please wait...</h2>
    `;

    // Create the postAI element
    const postAI = document.createElement('div');
    postAI.classList.add('postAI');
    postAI.innerHTML = `
        <h2 class="ai-assessment-heading">Assessment <span id="assessmentStatus"></span></h2>
        <p id="assessmentError"></p>
        <div class="postAI">
        <table id="outcomesTable">
            <!-- Table content will be dynamically added here -->
        </table>
        <div id="aiReasoningPanel" class="ai-reasoning-panel" style="display:none;">
            <h3>AI reasoning (live)</h3>
            <div id="aiReasoningFeed" class="ai-reasoning-feed"></div>
            <div id="aiReasoningStatus" class="ai-reasoning-status" style="display:none;"></div>
        </div>
        <button type="button" id="addSelectedButton" onclick="addSelectedResponses(event)">Add selected</button>
    `;

    // Append aiRunning and postAI elements inside the modal (or legacy inline container)
    mount.appendChild(aiRunning);
    mount.appendChild(postAI);

    const pageIdEl = document.getElementById('pageId');
    const mid = pageIdEl ? pageIdEl.value : '';
    if (mid !== 'completeAssessment' && !document.getElementById('careAiHistory')) {
        const historyWrap = document.createElement('div');
        historyWrap.id = 'careAiHistory';
        historyWrap.className = 'care-ai-history-wrap';
        mount.appendChild(historyWrap);
    }
}

function getCompleteAssessmentStepLabels() {
    return {
        intendedConsequences: 'Intended consequences',
        unintendedConsequences: 'Unintended consequences',
        stakeholders: 'Stakeholders',
        riskEvaluation: 'Risk evaluation',
        actionPlanning: 'Action planning',
    };
}

function updateReasoningProgressTracker(texts) {
    const arr = Array.isArray(texts) ? texts : [texts];
    const fingerprint = arr
        .map(function (t) { return (typeof t === 'string' ? t : ''); })
        .join('\n---\n');
    if (fingerprint !== reasoningLastFingerprint) {
        reasoningLastFingerprint = fingerprint;
        reasoningLastProgressAt = Date.now();
        setReasoningStatus('');
    }
}

function updateReasoningWaitStatus() {
    if (!reasoningLastProgressAt) return;
    const elapsedMs = Date.now() - reasoningLastProgressAt;
    if (elapsedMs >= 8000) {
        setReasoningStatus('Still generating... this can pause briefly on longer reasoning.');
    } else {
        setReasoningStatus('');
    }
}

function setReasoningStatus(message) {
    const panel = document.getElementById('aiReasoningPanel');
    const status = document.getElementById('aiReasoningStatus');
    if (!panel || !status) return;
    const txt = typeof message === 'string' ? message.trim() : '';
    if (!txt) {
        status.style.display = 'none';
        status.textContent = '';
        return;
    }
    panel.style.display = 'block';
    status.style.display = 'block';
    status.textContent = txt;
}

const reasoningAnimState = {};

/** Minimum time (ms) a structured-retry notice stays visible so users can read it. */
const REASONING_NOTICE_MIN_READ_MS = 12000;

var singleStepReasoningNoticeDwell = { messageId: '', text: '', hideAfter: 0 };
var singleStepNoticeDwellTimeout = null;
var lastSingleStepReasoningRender = { messageId: '', thinking: '' };

var completeAssessmentNoticeDwell = {};
var completeStepNoticeTimers = {};
var lastCompleteAssessmentRunStateRef = null;

function getEffectiveSingleStepNotice(messageId, serverNotice) {
    var fromServer = typeof serverNotice === 'string' ? serverNotice.trim() : '';
    if (singleStepReasoningNoticeDwell.messageId !== messageId) {
        singleStepReasoningNoticeDwell = { messageId: messageId, text: '', hideAfter: 0 };
    }
    if (fromServer) {
        singleStepReasoningNoticeDwell.text = fromServer;
        singleStepReasoningNoticeDwell.hideAfter = Date.now() + REASONING_NOTICE_MIN_READ_MS;
        return fromServer;
    }
    if (singleStepReasoningNoticeDwell.text && Date.now() < singleStepReasoningNoticeDwell.hideAfter) {
        return singleStepReasoningNoticeDwell.text;
    }
    if (Date.now() >= singleStepReasoningNoticeDwell.hideAfter) {
        singleStepReasoningNoticeDwell.text = '';
    }
    return '';
}

function scheduleSingleStepNoticeDwellRerender(messageId) {
    if (singleStepNoticeDwellTimeout) {
        clearTimeout(singleStepNoticeDwellTimeout);
        singleStepNoticeDwellTimeout = null;
    }
    singleStepNoticeDwellTimeout = setTimeout(function () {
        singleStepNoticeDwellTimeout = null;
        renderSingleStepReasoningFeed(
            messageId,
            lastSingleStepReasoningRender.thinking,
            ''
        );
    }, REASONING_NOTICE_MIN_READ_MS);
}

function getEffectiveCompleteStepNotice(stepId, serverNotice) {
    var fromServer = typeof serverNotice === 'string' ? serverNotice.trim() : '';
    var dwell = completeAssessmentNoticeDwell[stepId];
    if (!dwell) {
        dwell = { text: '', hideAfter: 0 };
    }
    if (fromServer) {
        dwell.text = fromServer;
        dwell.hideAfter = Date.now() + REASONING_NOTICE_MIN_READ_MS;
        completeAssessmentNoticeDwell[stepId] = dwell;
        return fromServer;
    }
    if (dwell.text && Date.now() < dwell.hideAfter) {
        return dwell.text;
    }
    if (Date.now() >= dwell.hideAfter && dwell.text) {
        delete completeAssessmentNoticeDwell[stepId];
    }
    return '';
}

function scheduleCompleteStepNoticeDwellRerender(stepId) {
    if (completeStepNoticeTimers[stepId]) {
        clearTimeout(completeStepNoticeTimers[stepId]);
    }
    completeStepNoticeTimers[stepId] = setTimeout(function () {
        delete completeStepNoticeTimers[stepId];
        if (lastCompleteAssessmentRunStateRef) {
            renderCompleteAssessmentReasoningFeed(lastCompleteAssessmentRunStateRef);
        }
    }, REASONING_NOTICE_MIN_READ_MS);
}

function stopReasoningAnimation(key) {
    const state = reasoningAnimState[key];
    if (!state) return;
    if (state.timer) {
        clearInterval(state.timer);
    }
    delete reasoningAnimState[key];
}

function renderReasoningHtml(text, showCursor) {
    const lines = normalizeReasoningWhitespace(text).split('\n');
    const html = [];
    lines.forEach(function (line) {
        const trimmed = line.trim();
        if (trimmed === '') {
            html.push('<div class="ai-reasoning-blank"></div>');
            return;
        }
        const markdownHeading = trimmed.match(/^#{1,3}\s+(.+)$/);
        if (markdownHeading) {
            html.push('<div class="ai-reasoning-heading">' + escapeHtml(markdownHeading[1]) + '</div>');
            return;
        }
        if (/^[A-Z][A-Z0-9\s\-]{2,}:$/.test(trimmed)) {
            html.push('<div class="ai-reasoning-heading">' + escapeHtml(trimmed.replace(/:$/, '')) + '</div>');
            return;
        }
        html.push('<div class="ai-reasoning-line">' + escapeHtml(line) + '</div>');
    });
    if (showCursor) {
        html.push('<span class="ai-reasoning-cursor" aria-hidden="true"></span>');
    }
    return html.join('');
}

function animateReasoningText(bodyEl, fullText, key) {
    if (!bodyEl) return;
    const target = typeof fullText === 'string' ? fullText : '';
    let state = reasoningAnimState[key];
    if (!state) {
        state = {
            renderedText: '',
            targetText: target,
            timer: null,
        };
        reasoningAnimState[key] = state;
    } else {
        state.targetText = target;
    }

    // Do not rewind if a polled snapshot is temporarily shorter.
    if (state.targetText.length < state.renderedText.length) {
        state.targetText = state.renderedText;
    }
    if (!state.timer) {
        state.timer = setInterval(function () {
            if (!document.body.contains(bodyEl)) {
                stopReasoningAnimation(key);
                return;
            }
            if (state.renderedText.length < state.targetText.length) {
                const remaining = state.targetText.length - state.renderedText.length;
                const chunkSize = Math.min(remaining, 6);
                state.renderedText += state.targetText.slice(
                    state.renderedText.length,
                    state.renderedText.length + chunkSize
                );
            }
            bodyEl.innerHTML = renderReasoningHtml(
                state.renderedText,
                state.renderedText.length < state.targetText.length
            );
        }, 25);
    }
}

function setReasoningTextStatic(bodyEl, fullText, key) {
    if (!bodyEl) return;
    stopReasoningAnimation(key);
    const text = typeof fullText === 'string' ? fullText : '';
    bodyEl.innerHTML = renderReasoningHtml(text, false);
}

function renderCompleteAssessmentStatusTable(runState) {
    const outcomesTable = document.getElementById('outcomesTable');
    if (!outcomesTable) return;
    const labels = getCompleteAssessmentStepLabels();
    const order = [
        'intendedConsequences',
        'unintendedConsequences',
        'stakeholders',
        'riskEvaluation',
        'actionPlanning',
    ];
    const byId = {};
    ((runState && runState.steps) || []).forEach(function (s) { byId[s.id] = s; });
    outcomesTable.innerHTML = '';

    const headerRow = document.createElement('tr');
    const c1 = document.createElement('th');
    c1.textContent = 'Step';
    const c2 = document.createElement('th');
    c2.textContent = 'Status';
    headerRow.appendChild(c1);
    headerRow.appendChild(c2);
    outcomesTable.appendChild(headerRow);

    order.forEach(function (id) {
        const s = byId[id] || { status: 'pending' };
        let statusText = 'Waiting';
        if (s.status === 'running') statusText = 'Processing';
        if (s.status === 'done') {
            if (typeof s.count === 'number') {
                statusText = 'Complete (' + s.count + ' identified)';
            } else {
                statusText = 'Complete';
            }
        }
        if (s.status === 'failed') statusText = 'Failed';
        const row = document.createElement('tr');
        const stepCell = document.createElement('td');
        stepCell.textContent = labels[id] || id;
        const statusCell = document.createElement('td');
        statusCell.textContent = statusText;
        if (runState && runState.status === 'failed' && s.status === 'failed') {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'btn btn-primary';
            retryButton.textContent = 'Retry stage';
            retryButton.addEventListener('click', function (event) {
                event.preventDefault();
                retryCompleteAssessmentStep(id);
            });
            statusCell.appendChild(document.createElement('br'));
            statusCell.appendChild(retryButton);
        }
        row.appendChild(stepCell);
        row.appendChild(statusCell);
        outcomesTable.appendChild(row);
    });

    renderCompleteAssessmentReasoningFeed(runState);
}

function renderCompleteAssessmentReasoningFeed(runState) {
    lastCompleteAssessmentRunStateRef = runState;
    const panel = document.getElementById('aiReasoningPanel');
    const feed = document.getElementById('aiReasoningFeed');
    if (!panel || !feed) return;
    const labels = getCompleteAssessmentStepLabels();
    const steps = (runState && Array.isArray(runState.steps)) ? runState.steps : [];
    const withContent = steps.filter(function (s) {
        const t = typeof s.thinking === 'string' && s.thinking.trim() !== '';
        const n = getEffectiveCompleteStepNotice(s.id, s.reasoningNotice).trim() !== '';
        return t || n;
    });
    updateReasoningProgressTracker(withContent.map(function (s) { return s.thinking || ''; }));
    if (withContent.length === 0) {
        // Keep current output if we are mid-animation to avoid visible reset flicker.
        if (Object.keys(reasoningAnimState).length > 0) {
            panel.style.display = 'block';
            return;
        }
        panel.style.display = 'none';
        feed.innerHTML = '';
        return;
    }
    panel.style.display = 'block';
    const terminal = runState && (runState.status === 'completed' || runState.status === 'failed');
    const activeKeys = {};
    withContent.forEach(function (s) {
        const msgKey = 'complete:' + s.id;
        activeKeys[msgKey] = true;
        let msg = feed.querySelector('.ai-reasoning-msg[data-reasoning-key="' + s.id + '"]');
        if (!msg) {
            msg = document.createElement('div');
            msg.className = 'ai-reasoning-msg';
            msg.dataset.reasoningKey = s.id;
            const title = document.createElement('div');
            title.className = 'ai-reasoning-msg__title';
            const body = document.createElement('div');
            body.className = 'ai-reasoning-msg__body';
            msg.appendChild(title);
            msg.appendChild(body);
            feed.appendChild(msg);
        }
        const title = msg.querySelector('.ai-reasoning-msg__title');
        const body = msg.querySelector('.ai-reasoning-msg__body');
        title.textContent = labels[s.id] || s.id;
        const noticeFromServer = typeof s.reasoningNotice === 'string' ? s.reasoningNotice.trim() : '';
        const effectiveNotice = getEffectiveCompleteStepNotice(s.id, s.reasoningNotice);
        if (noticeFromServer) {
            scheduleCompleteStepNoticeDwellRerender(s.id);
        }
        if (effectiveNotice) {
            let noticeEl = msg.querySelector('.ai-reasoning-notice');
            if (!noticeEl) {
                noticeEl = document.createElement('div');
                noticeEl.className = 'ai-reasoning-notice';
                msg.insertBefore(noticeEl, body);
            }
            noticeEl.textContent = effectiveNotice;
        } else {
            const oldNotice = msg.querySelector('.ai-reasoning-notice');
            if (oldNotice) oldNotice.remove();
        }
        const thinkingText = typeof s.thinking === 'string' ? s.thinking : '';
        if (!thinkingText.trim()) {
            stopReasoningAnimation(msgKey);
            body.innerHTML = '';
        } else if (terminal) {
            setReasoningTextStatic(body, thinkingText, msgKey);
        } else {
            animateReasoningText(body, thinkingText, msgKey);
        }
    });
    feed.querySelectorAll('.ai-reasoning-msg').forEach(function (el) {
        const id = el.dataset.reasoningKey;
        const msgKey = 'complete:' + id;
        if (!activeKeys[msgKey]) {
            stopReasoningAnimation(msgKey);
            el.remove();
        }
    });
    feed.scrollTop = feed.scrollHeight;
}

function renderSingleStepReasoningFeed(messageId, thinkingText, reasoningNotice) {
    const panel = document.getElementById('aiReasoningPanel');
    const feed = document.getElementById('aiReasoningFeed');
    if (!panel || !feed) return;
    const text = typeof thinkingText === 'string' ? thinkingText.trim() : '';
    lastSingleStepReasoningRender = {
        messageId: messageId,
        thinking: typeof thinkingText === 'string' ? thinkingText : '',
    };
    const noticeFromServer = typeof reasoningNotice === 'string' ? reasoningNotice.trim() : '';
    const notice = getEffectiveSingleStepNotice(messageId, reasoningNotice);
    if (noticeFromServer) {
        scheduleSingleStepNoticeDwellRerender(messageId);
    }
    updateReasoningProgressTracker(text);
    if (!text && !notice) {
        panel.style.display = 'none';
        feed.innerHTML = '';
        return;
    }
    panel.style.display = 'block';
    const msgKey = 'single:' + messageId;
    let noticeEl = feed.querySelector('.ai-reasoning-notice');
    if (notice) {
        if (!noticeEl) {
            noticeEl = document.createElement('div');
            noticeEl.className = 'ai-reasoning-notice';
            feed.insertBefore(noticeEl, feed.firstChild);
        }
        noticeEl.textContent = notice;
    } else if (noticeEl) {
        noticeEl.remove();
    }
    if (!text) {
        stopReasoningAnimation(msgKey);
        const msg = feed.querySelector('.ai-reasoning-msg[data-reasoning-key="single"]');
        if (msg) {
            const body = msg.querySelector('.ai-reasoning-msg__body');
            if (body) body.innerHTML = '';
        }
        return;
    }
    const labels = getCompleteAssessmentStepLabels();
    let msg = feed.querySelector('.ai-reasoning-msg[data-reasoning-key="single"]');
    if (!msg) {
        feed.querySelectorAll('.ai-reasoning-msg').forEach(function (el) { el.remove(); });
        msg = document.createElement('div');
        msg.className = 'ai-reasoning-msg';
        msg.dataset.reasoningKey = 'single';
        const titleEl = document.createElement('div');
        titleEl.className = 'ai-reasoning-msg__title';
        const bodyEl = document.createElement('div');
        bodyEl.className = 'ai-reasoning-msg__body';
        msg.appendChild(titleEl);
        msg.appendChild(bodyEl);
        feed.appendChild(msg);
    }
    const title = msg.querySelector('.ai-reasoning-msg__title');
    const body = msg.querySelector('.ai-reasoning-msg__body');
    title.textContent = labels[messageId] || messageId;
    animateReasoningText(body, text, msgKey);
    feed.scrollTop = feed.scrollHeight;
}

function normalizeReasoningWhitespace(text) {
    if (typeof text !== 'string' || text === '') return '';
    // Collapse runs of 2+ blank lines to a single blank line.
    return text.replace(/\n\s*\n(?:\s*\n)+/g, '\n\n');
}

function hideReasoningFeed() {
    if (singleStepNoticeDwellTimeout) {
        clearTimeout(singleStepNoticeDwellTimeout);
        singleStepNoticeDwellTimeout = null;
    }
    singleStepReasoningNoticeDwell = { messageId: '', text: '', hideAfter: 0 };
    Object.keys(completeStepNoticeTimers).forEach(function (id) {
        clearTimeout(completeStepNoticeTimers[id]);
    });
    completeStepNoticeTimers = {};
    completeAssessmentNoticeDwell = {};
    const panel = document.getElementById('aiReasoningPanel');
    const feed = document.getElementById('aiReasoningFeed');
    if (panel) panel.style.display = 'none';
    if (feed) feed.innerHTML = '';
    setReasoningStatus('');
    reasoningLastProgressAt = 0;
    reasoningLastFingerprint = '';
    Object.keys(reasoningAnimState).forEach(stopReasoningAnimation);
}
function renderMessageHTML(messageText) {
    const escaped = escapeHtml(messageText == null ? '' : String(messageText));
    return escaped.replace(/\n/g, '<br>');
}

async function renderMessage(projectData,message) {
    try {
        aiMessageBase = await populateMessage(message, projectData);
        refreshAiMessagePreview();
    } catch (error) {
        console.error("Error rendering message:", error);
    }
}

async function populateMessage(message, data) {

    let populatedText = message;

    // Replace placeholders with actual data
    for (const key in data) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        let value = data[key];
        if (typeof value === 'object') {
            // If the value is a JSON object, stringify it
            value = JSON.stringify(value);
        }
        populatedText = populatedText.replace(regex, value);
    }

    return populatedText;
}

async function addSelectedResponses(event) {
    event.preventDefault();
    const messageId = document.getElementById("pageId").value;
    const form = document.getElementById("dataForm");
    const pid = form && form.dataset ? form.dataset.projectId : "";
    const indicesAsc = [];
    const checkboxes = document.querySelectorAll('input[name="responseSelect"]');
    checkboxes.forEach(function (checkbox) {
        if (checkbox.checked) {
            indicesAsc.push(parseInt(checkbox.value, 10));
        }
    });
    indicesAsc.sort(function (a, b) {
        return a - b;
    });
    if (indicesAsc.length === 0 || !Array.isArray(responseData[messageId])) {
        return;
    }
    const selectedResponses = indicesAsc.map(function (i) {
        return responseData[messageId][i];
    });
    if (activeAiRunId && pid) {
        try {
            const r = await fetch(
                '/project/' +
                    encodeURIComponent(pid) +
                    '/ai-runs/' +
                    encodeURIComponent(activeAiRunId) +
                    '/selections',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({ indices: indicesAsc, items: selectedResponses }),
                }
            );
            if (!r.ok) {
                console.warn('Recording AI selection failed', r.status);
            }
        } catch (e) {
            console.error(e);
        }
    }
    indicesAsc
        .slice()
        .sort(function (a, b) {
            return b - a;
        })
        .forEach(function (i) {
            responseData[messageId].splice(i, 1);
        });
    const mergeKey = projectMergeKeyForAiStep(messageId);
    let toMerge = {};
    toMerge[mergeKey] = selectedResponses;
    projectData = mergeObjects(projectData, toMerge);
    if (typeof window.careCloseAiModal === 'function') {
        window.careCloseAiModal();
    } else {
        prepareCareAiModalDom();
    }
    await persistProjectDataAfterAiMerge();
    await reloadPage();
    await refreshProjectAiHistory(pid);
    renderAiRunHistoryPanel(messageId);
    if (!responseData[messageId] || responseData[messageId].length === 0) {
        document.querySelectorAll('.postAI').forEach(function (el) {
            el.style.display = 'none';
        });
        document.querySelectorAll('.preAI').forEach(function (el) {
            el.style.display = 'block';
        });
        return;
    }
    renderAIResponses(responseData, messageId);
}

// Function to merge two objects
function mergeObjects(obj1, obj2) {
    for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            if (obj1.hasOwnProperty(key)) {
                // Merge arrays if both values are arrays
                if (Array.isArray(obj1[key]) && Array.isArray(obj2[key])) {
                    obj1[key] = obj1[key].concat(obj2[key]);
                } else if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
                    // Recursively merge objects
                    obj1[key] = mergeObjects(obj1[key], obj2[key]);
                }
            } else {
                // If key doesn't exist in obj1, add it
                obj1[key] = obj2[key];
            }
        }
    }
    return obj1;
}

function renderAIResponses(responses,messageId) {
    // Hide preAI and mergeOverwrite elements, show aiRunning elements
    document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
    const outcomesTable = document.getElementById('outcomesTable');
    // Clear previous content
    outcomesTable.innerHTML = '';

    const list = responses && responses[messageId];
    if (!Array.isArray(list) || list.length === 0) {
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');
        const ab = document.getElementById('addSelectedButton');
        if (ab) {
            ab.style.display = 'none';
        }
        return;
    }

    // Create table header
    const headerRow = document.createElement('tr');
    const selectHeader = document.createElement('th');
    selectHeader.style.width = '10%'; // Set width to 10%
    selectHeader.textContent = 'Select';
    headerRow.appendChild(selectHeader);
    const responseHeader = document.createElement('th');
    responseHeader.textContent = 'Response';
    headerRow.appendChild(responseHeader);
    outcomesTable.appendChild(headerRow);

    // Populate table with responses
    list.forEach((response, index) => {
        const row = document.createElement('tr');
        row.style.borderTop = "1px solid rgba(30 64 175)";
        const selectCell = document.createElement('td');
        selectCell.style.textAlign = 'center'; // Center align content
        selectCell.style.verticalAlign = 'middle';
        const selectCheckbox = document.createElement('input');
        selectCheckbox.type = 'checkbox';
        selectCheckbox.name = 'responseSelect';
        selectCheckbox.value = index;
        selectCell.appendChild(selectCheckbox);
        row.appendChild(selectCell);
        const responseCell = document.createElement('td');
        const jsonHtml = parseJsonToHtml(response);
        responseCell.innerHTML = jsonHtml;
        row.appendChild(responseCell);
        outcomesTable.appendChild(row);
    });

    // Show add selected button
    document.getElementById('addSelectedButton').style.display = 'block';
    // Hide aiRunning elements
    document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');

    // Populate assessment status
    document.getElementById('assessmentStatus').innerText = 'success';

    // Show postAI elements
    document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');

}

function parseJsonToHtml(json) {
    if (json == null) {
        return '';
    }
    // Arrays: render each item as a list entry with some spacing.
    if (Array.isArray(json)) {
        if (json.length === 0) return '';
        const items = json
            .map(function (item) {
                if (item == null) return '';
                if (typeof item === 'object') {
                    return '<li>' + parseJsonToHtml(item) + '</li>';
                }
                return '<li>' + escapeHtml(String(item)) + '</li>';
            })
            .join('');
        return '<ul class="ai-response-list">' + items + '</ul>';
    }

    // Plain scalar value: just text.
    if (typeof json !== 'object') {
        return escapeHtml(String(json));
    }

    // Objects: prefer common fields if present; otherwise, join values with line breaks.
    var parts = [];
    if (Object.prototype.hasOwnProperty.call(json, 'description')) {
        parts.push(escapeHtml(String(json.description)));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'impact')) {
        parts.push('Impact: ' + escapeHtml(String(json.impact)));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'likelihood')) {
        parts.push('Likelihood: ' + escapeHtml(String(json.likelihood)));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'role')) {
        parts.push('Role: ' + escapeHtml(String(json.role)));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'stakeholder')) {
        parts.push('Stakeholder: ' + escapeHtml(String(json.stakeholder)));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'action')) {
        parts.push(parseJsonToHtml(json.action));
    }

    if (parts.length === 0) {
        // Fallback: show all values without bold keys.
        Object.keys(json).forEach(function (key) {
            var v = json[key];
            if (v == null) return;
            if (typeof v === 'object') {
                parts.push(parseJsonToHtml(v));
            } else {
                parts.push(escapeHtml(String(v)));
            }
        });
    }

    return parts.join('<br/>');
}

async function getInlineAIReponse(projectId) {
    try {
        const messageId = document.getElementById("pageId").value;
        if (singleStepNoticeDwellTimeout) {
            clearTimeout(singleStepNoticeDwellTimeout);
            singleStepNoticeDwellTimeout = null;
        }
        singleStepReasoningNoticeDwell = { messageId: messageId, text: '', hideAfter: 0 };
        stopReasoningAnimation('single:' + messageId);
        if (typeof window.careOpenAiModal === 'function') {
            window.careOpenAiModal();
        }
        // Hide preAI and mergeOverwrite elements, show aiRunning elements
        document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'block');
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        document.getElementById('assessmentStatus').innerText = 'running';
        document.getElementById('assessmentError').innerText = '';
        document.getElementById('addSelectedButton').style.display = 'none';
        renderSingleStepReasoningFeed(messageId, '');

        const startResponse = await fetch(
            `/assistant/${projectId}/${messageId}/start?${assistantQueryString()}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        if (!startResponse.ok) {
            const msg = await assistantErrorMessageFromResponse(startResponse, 'Network response was not ok');
            throw new Error(msg);
        }

        const startData = await startResponse.json();
        const runId = startData && startData.runId;
        if (!runId) {
            throw new Error('Could not start AI run');
        }
        let finalData = startData;
        for (;;) {
            await new Promise(function (resolve) { setTimeout(resolve, 1000); });
            const statusResponse = await fetch(
                `/assistant/${projectId}/${messageId}/status/${encodeURIComponent(runId)}?${assistantQueryString()}`,
                { headers: { 'Accept': 'application/json' } }
            );
            if (!statusResponse.ok) {
                const msg = await assistantErrorMessageFromResponse(statusResponse, 'Failed to fetch AI progress');
                throw new Error(msg);
            }
            finalData = await statusResponse.json();
            renderSingleStepReasoningFeed(
                messageId,
                finalData.thinking || '',
                finalData.reasoningNotice || ''
            );
            updateReasoningWaitStatus();
            if (finalData.status === 'completed' || finalData.status === 'failed') {
                break;
            }
        }
        if (finalData.status !== 'completed') {
            throw new Error(finalData.error || 'AI run failed');
        }
        setReasoningStatus('');
        const feed = document.getElementById('aiReasoningFeed');
        const singleBody = feed && feed.querySelector('.ai-reasoning-msg[data-reasoning-key="single"] .ai-reasoning-msg__body');
        setReasoningTextStatic(singleBody, finalData.thinking || '', 'single:' + messageId);
        activeAiRunId = runId;
        const resultObj = finalData.result || {};
        if (typeof responseData !== 'object' || responseData === null) {
            responseData = {};
        }
        responseData[messageId] = getSuggestionsTableRows(messageId, resultObj);
        await refreshProjectAiHistory(projectId);
        renderAiRunHistoryPanel(messageId);
        renderAIResponses(responseData, messageId);
    } catch (error) {
        // Hide aiRunning elements
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');

        // Populate assessment status and error message
        document.getElementById('assessmentStatus').innerText = 'failed';
        document.getElementById('assessmentError').innerText = error.message;

        // Show postAI elements
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        console.error('There was a problem with the fetch operation:', error);
    }
}

async function getCompleteAIResponse(projectId) {
    try {
        const messageId = document.getElementById("pageId").value;
        Object.keys(completeStepNoticeTimers).forEach(function (id) {
            clearTimeout(completeStepNoticeTimers[id]);
        });
        completeStepNoticeTimers = {};
        completeAssessmentNoticeDwell = {};
        Object.keys(reasoningAnimState).forEach(stopReasoningAnimation);
        // Hide preAI and mergeOverwrite elements, show aiRunning elements
        document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'block');
        document.getElementById('submitButtonContainer').style.display = 'none';

        const response = await fetch(`/assistant/${projectId}/completeAssessment/start?${assistantQueryString()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const msg = await assistantErrorMessageFromResponse(response, 'Network response was not ok');
            throw new Error(msg);
        }

        const startData = await response.json();
        const runId = startData && startData.runId;
        if (!runId) {
            throw new Error('Could not start complete assessment run');
        }
        completeAssessmentRunId = runId;

        document.getElementById('assessmentStatus').innerText = 'running';
        document.getElementById('assessmentError').innerText = '';
        document.getElementById('addSelectedButton').style.display = 'none'
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        renderCompleteAssessmentStatusTable(startData);

        let responseData = await pollCompleteAssessmentRun(projectId, runId);

        // Hide aiRunning elements
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');
        document.getElementById('submitButtonContainer').style.display = 'block';
        if (responseData.status === 'failed') {
            document.getElementById('assessmentStatus').innerText = 'failed';
            document.getElementById('assessmentError').innerText = responseData.error || 'Assessment failed';
        } else {
            document.getElementById('assessmentStatus').innerText = 'success';
        }
        await refreshProjectAiHistory(projectId);
    } catch (error) {
        // Hide aiRunning elements
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');

        // Populate assessment status and error message
        document.getElementById('assessmentStatus').innerText = 'failed';
        document.getElementById('assessmentError').innerText = error.message;

        // Show postAI elements
        document.getElementById('submitButtonContainer').style.display = 'block';
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        console.error('There was a problem with the fetch operation:', error);
    }
}

async function pollCompleteAssessmentRun(projectId, runId) {
    let responseData = null;
    for (;;) {
        await new Promise(function (resolve) { setTimeout(resolve, 1000); });
        const statusResponse = await fetch(
            `/assistant/${projectId}/completeAssessment/status/${encodeURIComponent(runId)}`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!statusResponse.ok) {
            const msg = await assistantErrorMessageFromResponse(statusResponse, 'Failed to fetch assessment progress');
            throw new Error(msg);
        }
        responseData = await statusResponse.json();
        renderCompleteAssessmentStatusTable(responseData);
        updateReasoningWaitStatus();
        if (responseData.status === 'completed' || responseData.status === 'failed') {
            break;
        }
    }
    setReasoningStatus('');
    return responseData;
}

async function retryCompleteAssessmentStep(stepId) {
    try {
        const form = document.getElementById("dataForm");
        const projectId = form && form.dataset ? form.dataset.projectId : '';
        if (!projectId || !completeAssessmentRunId || !stepId) {
            return;
        }
        Object.keys(reasoningAnimState).forEach(stopReasoningAnimation);
        document.getElementById('assessmentStatus').innerText = 'running';
        document.getElementById('assessmentError').innerText = '';
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'block');

        const response = await fetch(
            `/assistant/${projectId}/completeAssessment/retry/${encodeURIComponent(completeAssessmentRunId)}/${encodeURIComponent(stepId)}?${assistantQueryString()}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );
        if (!response.ok) {
            const msg = await assistantErrorMessageFromResponse(response, 'Failed to retry stage');
            throw new Error(msg);
        }
        const restartState = await response.json();
        renderCompleteAssessmentStatusTable(restartState);

        const finalState = await pollCompleteAssessmentRun(projectId, completeAssessmentRunId);
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');
        if (finalState.status === 'failed') {
            document.getElementById('assessmentStatus').innerText = 'failed';
            document.getElementById('assessmentError').innerText = finalState.error || 'Assessment failed';
        } else {
            document.getElementById('assessmentStatus').innerText = 'success';
            document.getElementById('assessmentError').innerText = '';
        }
    } catch (error) {
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');
        document.getElementById('assessmentStatus').innerText = 'failed';
        document.getElementById('assessmentError').innerText = error.message;
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
    }
}

window.careResetAiModalUi = prepareCareAiModalDom;
window.cleanupCareAiCompactUi = cleanupCareAiCompactUi;
window.setCareAiTitleSlotVisible = setCareAiTitleSlotVisible;