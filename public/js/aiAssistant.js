let responseData = {};
let aiMessage = "";
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

function assistantQueryString(extra) {
    const p = new URLSearchParams();
    p.set('aiSource', careAiSourceParam());
    if (careIncludeOrgContextParam()) {
        p.set('includeOrgContext', '1');
    }
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
        <h2>Assessment <span id="assessmentStatus"></span></h2>
        <p id="assessmentError"></p>
        <h3>Outcomes</h3>
        <div class="postAI">
        <table id="outcomesTable">
            <!-- Table content will be dynamically added here -->
        </table>
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
        row.appendChild(stepCell);
        row.appendChild(statusCell);
        outcomesTable.appendChild(row);
    });
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

async function checkExistingData(projectId) {
    try {
        const response = await fetch(`/project/${projectId}`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const projectData = await response.json();

        if ((projectData.intendedConsequences && projectData.intendedConsequences.length > 0) ||
            (projectData.unintendedConsequences && projectData.unintendedConsequences.length > 0) ||
            (projectData.stakeholders && projectData.stakeholders.length > 0)) {
            // Show merge/overwrite options
            document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.mergeOverwrite').forEach(el => el.style.display = 'block');
        } else {
            getCompleteAIResponse(projectId, false); // No existing data, proceed directly
        }
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
    }
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
    let html = '';
    for (const key in json) {
        if (json.hasOwnProperty(key)) {
            html += `<b>${key}:</b> `;
            if (typeof json[key] === 'object') {
                html += '<ul>';
                html += parseJsonToHtml(json[key]);
                html += '</ul>';
            } else {
                html += `${json[key]}<br/>`;
            }
        }
    }
    return html;
}

async function getInlineAIReponse(projectId) {
    try {
        const messageId = document.getElementById("pageId").value;
        // Hide preAI and mergeOverwrite elements, show aiRunning elements
        document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'block');

        const response = await fetch(
            `/assistant/${projectId}/${messageId}?${assistantQueryString()}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        responseData = await response.json();
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

async function getCompleteAIResponse(projectId, merge) {
    try {
        const messageId = document.getElementById("pageId").value;
        // Hide preAI and mergeOverwrite elements, show aiRunning elements
        document.querySelectorAll('.preAI').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.mergeOverwrite').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'block');
        document.getElementById('submitButtonContainer').style.display = 'none';
        renderCompleteAssessmentProgress([
            { id: 'intendedConsequences', status: 'running' },
            { id: 'unintendedConsequences', status: 'pending' },
            { id: 'stakeholders', status: 'pending' },
            { id: 'riskEvaluation', status: 'pending' },
            { id: 'actionPlanning', status: 'pending' },
        ]);

        const response = await fetch(`/assistant/${projectId}/completeAssessment/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ merge: merge })
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const startData = await response.json();
        const runId = startData && startData.runId;
        if (!runId) {
            throw new Error('Could not start complete assessment run');
        }

        document.getElementById('assessmentStatus').innerText = 'running';
        document.getElementById('assessmentError').innerText = '';
        document.getElementById('addSelectedButton').style.display = 'none'
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        renderCompleteAssessmentStatusTable(startData);

        let responseData = startData;
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
            if (responseData.status === 'completed' || responseData.status === 'failed') {
                break;
            }
        }

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