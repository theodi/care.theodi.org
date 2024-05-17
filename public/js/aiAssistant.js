let responseData = {};
let aiMessage = "";

async function loadAI() {
    const form = document.getElementById("dataForm");
    const projectId = form.dataset.projectId;
    const messageId = document.getElementById("pageId").value;
    const response = await fetch('/data/aiTemplates.json');
    const messageData = await response.json();
    const message = messageData.messages[messageId];
    if (!message) {
        return;
    }
    await addAIElements();

    renderMessage(projectData,message);

    const expandToggle = document.querySelector('.expandToggle');
    const aiMessage = document.getElementById('aiMessage');
    const expandButton = document.querySelector('.expandButton');

    expandToggle.addEventListener('click', function(event) {
        event.preventDefault();
        if (aiMessage.style.display === 'none') {
            aiMessage.style.display = 'block';
            expandButton.textContent = '-';
            expandToggle.style.display = 'none';
        }
    });

    expandButton.addEventListener('click', function(event) {
        event.preventDefault();
        if (aiMessage.style.display === 'none') {
            aiMessage.style.display = 'block';
            expandButton.textContent = '-';
            expandToggle.style.display = 'none';
        } else {
            aiMessage.style.display = 'none';
            expandButton.textContent = '+';
            expandToggle.style.display = 'block';
        }
    });

    const runAI = document.getElementById('runAI');
    runAI.addEventListener('click', function(event) {
        event.preventDefault();
        getInlineAIReponse(projectId);
    });
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
function renderMessageHTML(messageText) {
    // Replace line breaks with <br> tags
    const htmlText = messageText.replace(/\n/g, "<br>");
    return htmlText;
}

async function renderMessage(projectData,message) {
    try {
        if (aiMessage == "") {
            aiMessage = await populateMessage(message, projectData);
        }
        const messageHTML = renderMessageHTML(aiMessage);
        document.getElementById("aiMessage").innerHTML = messageHTML;
    } catch (error) {
        console.error("Error rendering message:", error);
    }
}

async function populateMessage(message, data) {

    let populatedText = message.message;

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

        const response = await fetch(`/assistant/${projectId}/${messageId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

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

        const response = await fetch(`/assistant/${projectId}/${messageId}?merge=${merge}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const responseData = await response.json();

        // Hide aiRunning elements
        document.querySelectorAll('.aiRunning').forEach(el => el.style.display = 'none');

        // Populate assessment status
        document.getElementById('assessmentStatus').innerText = 'success';

        // Populate summary table
        document.getElementById('intendedConsequencesCount').innerText = responseData.intendedConsequencesCount;
        document.getElementById('unintendedConsequencesCount').innerText = responseData.unintendedConsequencesCount;
        document.getElementById('stakeholdersCount').innerText = responseData.stakeholdersCount;

        // Show postAI elements
        document.querySelectorAll('.postAI').forEach(el => el.style.display = 'block');
        document.getElementById('submitButtonContainer').style.display = 'block';
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