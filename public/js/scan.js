async function loadProject(projectId) {
    let fetchURL;

    const urlParams = new URLSearchParams(window.location.search);
    const templateParam = urlParams.get('template');
    const templateMode = urlParams.get('templateMode');

    if (projectId) {
        fetchURL = `/project/${projectId}`;
    } else if (templateParam) {
        fetchURL = `/data/examples/${templateParam}.json`;
    } else {
        return {}; // No need to fetch data, return an empty object
    }

    try {
        const response = await fetch(fetchURL, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();
        if (!projectId && templateParam && templateMode === 'blank') {
            return stripAssessmentDataFromTemplate(data);
        }
        return data;
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
        return {}; // Return an empty object if there's an error
    }
}

function stripAssessmentDataFromTemplate(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }
    const clone = JSON.parse(JSON.stringify(data));
    clone.intendedConsequences = [];
    clone.unintendedConsequences = [];
    clone.stakeholders = [];
    return clone;
}

/**
 * Sidebar navigation: validate current jsonform, show field errors / overlay if invalid,
 * merge values into project data, save, then move to the chosen section (quickNav).
 */
function scanNavigateToSection(event, targetPage) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    void scanNavigateToSectionAsync(targetPage);
    return false;
}

async function scanNavigateToSectionAsync(targetPage) {
    const pathParts = window.location.pathname.split('/');
    const current = pathParts.length >= 4 ? pathParts[3] : '';
    if (targetPage === current) {
        return;
    }

    const $ = window.jQuery;
    if (!$) {
        if (typeof window.quickNav === 'function') {
            await window.quickNav(targetPage);
        }
        return;
    }

    const $form = $('#dataForm');
    const tree = $form.data('jsonform-tree');

    if (!tree || typeof window.mergeFormValuesIntoProjectData !== 'function') {
        if (typeof window.quickNav === 'function') {
            await window.quickNav(targetPage);
        }
        return;
    }

    const validated = tree.validate();
    if (validated.errors) {
        if (typeof window.showErrorOverlay === 'function') {
            window.showErrorOverlay('<p>Please correct the errors in your form</p>');
        }
        return;
    }

    const values = $form.jsonFormValue();
    const payload = window.mergeFormValuesIntoProjectData(values);

    if (typeof window.sendDataToServer !== 'function') {
        if (typeof window.quickNav === 'function') {
            await window.quickNav(targetPage);
        }
        return;
    }

    await window.sendDataToServer(payload, { navigateQuickNavTo: targetPage });
}
