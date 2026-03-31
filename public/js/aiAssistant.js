let responseData = {};
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

function bindAiMessageExpandControlsOnce() {
    const scope = document.querySelector('.aiContainer');
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
    const pre = document.querySelector('.aiContainer .preAI');
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

async function loadAI() {
    const form = document.getElementById("dataForm");
    const projectId = form.dataset.projectId;
    const messageId = document.getElementById("pageId").value;
    let message;
    try {
        const response = await fetch('/data/messageTemplates/' + messageId + '.txt');
        if (!response.ok) {
            throw new Error('Failed to fetch message');
        }
        message = await response.text();
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

    await addAIElements();
    injectCareAiStepOptions(orgAiAvailable, scanContextByStage, messageId);

    renderMessage(projectData,message);

    bindAiMessageExpandControlsOnce();

    const runAI = document.getElementById('runAI');
    if (runAI) {
        runAI.addEventListener('click', function(event) {
            event.preventDefault();
            getInlineAIReponse(projectId);
        });
    }
}

async function addAIElements() {
    // Select the AI container
    const aiContainer = document.querySelector('.aiContainer');

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
        <button id="addSelectedButton" onclick="addSelectedResponses(event)">Add selected</button>
    `;

    // Append aiRunning and postAI elements to the AI container
    aiContainer.appendChild(aiRunning);
    aiContainer.appendChild(postAI);

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

function stopReasoningAnimation(key) {
    const state = reasoningAnimState[key];
    if (!state) return;
    if (state.timer) {
        clearInterval(state.timer);
    }
    delete reasoningAnimState[key];
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    const panel = document.getElementById('aiReasoningPanel');
    const feed = document.getElementById('aiReasoningFeed');
    if (!panel || !feed) return;
    const labels = getCompleteAssessmentStepLabels();
    const steps = (runState && Array.isArray(runState.steps)) ? runState.steps : [];
    const withThinking = steps.filter(function (s) {
        return typeof s.thinking === 'string' && s.thinking.trim() !== '';
    });
    updateReasoningProgressTracker(withThinking.map(function (s) { return s.thinking; }));
    if (withThinking.length === 0) {
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
    withThinking.forEach(function (s) {
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
        if (terminal) {
            setReasoningTextStatic(body, s.thinking, msgKey);
        } else {
            animateReasoningText(body, s.thinking, msgKey);
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

function renderSingleStepReasoningFeed(messageId, thinkingText) {
    const panel = document.getElementById('aiReasoningPanel');
    const feed = document.getElementById('aiReasoningFeed');
    if (!panel || !feed) return;
    const text = typeof thinkingText === 'string' ? thinkingText.trim() : '';
    updateReasoningProgressTracker(text);
    if (!text) {
        panel.style.display = 'none';
        feed.innerHTML = '';
        return;
    }
    panel.style.display = 'block';
    const labels = getCompleteAssessmentStepLabels();
    const msgKey = 'single:' + messageId;
    let msg = feed.querySelector('.ai-reasoning-msg[data-reasoning-key="single"]');
    if (!msg) {
        feed.innerHTML = '';
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
    // Replace line breaks with <br> tags
    const htmlText = messageText.replace(/\n/g, "<br>");
    return htmlText;
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
    const selectedResponses = [];
    const checkboxes = document.querySelectorAll('input[name="responseSelect"]');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const responseIndex = parseInt(checkbox.value);
            const response = responseData[messageId][responseIndex];
            selectedResponses.push(response);
            responseData[messageId].splice(responseIndex, 1);
        }
    });
    let toMerge = {};
    toMerge[messageId] = selectedResponses;
    projectData = mergeObjects(projectData, toMerge);
    await reloadPage();
    renderAIResponses(responseData,messageId);
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
    responses[messageId].forEach((response, index) => {
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
                return '<li>' + String(item) + '</li>';
            })
            .join('');
        return '<ul class="ai-response-list">' + items + '</ul>';
    }

    // Plain scalar value: just text.
    if (typeof json !== 'object') {
        return String(json);
    }

    // Objects: prefer common fields if present; otherwise, join values with line breaks.
    var parts = [];
    if (Object.prototype.hasOwnProperty.call(json, 'description')) {
        parts.push(String(json.description));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'impact')) {
        parts.push('Impact: ' + String(json.impact));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'likelihood')) {
        parts.push('Likelihood: ' + String(json.likelihood));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'role')) {
        parts.push('Role: ' + String(json.role));
    }
    if (Object.prototype.hasOwnProperty.call(json, 'stakeholder')) {
        parts.push('Stakeholder: ' + String(json.stakeholder));
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
                parts.push(String(v));
            }
        });
    }

    return parts.join('<br/>');
}

async function getInlineAIReponse(projectId) {
    try {
        const messageId = document.getElementById("pageId").value;
        stopReasoningAnimation('single:' + messageId);
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
            throw new Error('Network response was not ok');
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
                throw new Error('Failed to fetch AI progress');
            }
            finalData = await statusResponse.json();
            renderSingleStepReasoningFeed(messageId, finalData.thinking || '');
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
        responseData = finalData.result || {};
        renderAIResponses(responseData,messageId);
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
            throw new Error('Network response was not ok');
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
            throw new Error('Failed to fetch assessment progress');
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
            const err = await response.json().catch(function () { return {}; });
            throw new Error(err.message || 'Failed to retry stage');
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