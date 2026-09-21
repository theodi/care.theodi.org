let careStepHelpModalInitialized = false;
let careStepHelpLastFocus = null;

function initCareStepHelpModal() {
    if (careStepHelpModalInitialized) return;
    const openBtn = document.getElementById('careStepHelpOpen');
    const modal = document.getElementById('careStepHelpModal');
    if (!openBtn || !modal) return;
    careStepHelpModalInitialized = true;

    const closeBtn = modal.querySelector('.care-step-help-modal-close');

    function closeHelpModal() {
        modal.classList.remove('care-step-help-modal--open');
        openBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('care-step-help-modal-open');
        if (careStepHelpLastFocus && typeof careStepHelpLastFocus.focus === 'function') {
            careStepHelpLastFocus.focus();
        }
    }

    function openHelpModal() {
        careStepHelpLastFocus = document.activeElement;
        modal.classList.add('care-step-help-modal--open');
        openBtn.setAttribute('aria-expanded', 'true');
        document.body.classList.add('care-step-help-modal-open');
        if (closeBtn) {
            closeBtn.focus();
        }
    }

    window.careOpenStepHelpModal = openHelpModal;
    window.careCloseStepHelpModal = closeHelpModal;

    openBtn.addEventListener('click', function (event) {
        event.preventDefault();
        openHelpModal();
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', function (event) {
            event.preventDefault();
            closeHelpModal();
        });
    }
    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            closeHelpModal();
        }
    });
    if (!document.documentElement.dataset.careStepHelpEscapeBound) {
        document.documentElement.dataset.careStepHelpEscapeBound = '1';
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && modal.classList.contains('care-step-help-modal--open')) {
                closeHelpModal();
            }
        });
    }
}

function collectFallbackHelpHtml() {
    const sources = document.querySelectorAll('#dataForm .care-step-help-source');
    if (sources.length === 0) return '';

    const infobox = document.createElement('div');
    infobox.className = 'infobox care-step-help-body';
    sources.forEach(function (source) {
        while (source.firstChild) {
            infobox.appendChild(source.firstChild);
        }
        source.remove();
    });
    return infobox.outerHTML;
}

async function setupCareStepHelp() {
    initCareStepHelpModal();
    const openBtn = document.getElementById('careStepHelpOpen');
    const modal = document.getElementById('careStepHelpModal');
    const body = document.getElementById('careStepHelpModalBody');
    const titleEl = document.getElementById('careStepHelpModalTitle');
    if (!openBtn || !modal || !body) return;

    if (typeof window.careCloseStepHelpModal === 'function') {
        window.careCloseStepHelpModal();
    }

    const fallbackHtml = collectFallbackHelpHtml();
    body.innerHTML = '';

    const pageIdEl = document.getElementById('pageId');
    const stepId = pageIdEl ? String(pageIdEl.value || '').trim() : '';
    let html = '';

    if (stepId) {
        try {
            const res = await fetch(
                '/organisation/step-human-guidance?step=' + encodeURIComponent(stepId),
                { headers: { Accept: 'application/json' } }
            );
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data.html === 'string' && data.html.trim()) {
                    html = data.html;
                }
            }
        } catch (err) {
            console.warn('Could not load step guidance from server', err);
        }
    }

    if (!html && fallbackHtml) {
        html = fallbackHtml;
    }

    if (!html) {
        openBtn.hidden = true;
        openBtn.setAttribute('aria-expanded', 'false');
        return;
    }

    body.innerHTML = html;

    const pageH1 = document.querySelector('.page-title h1');
    if (titleEl && pageH1) {
        titleEl.textContent = pageH1.textContent;
    }

    openBtn.hidden = false;
    openBtn.setAttribute('aria-expanded', 'false');
}

window.setupCareStepHelp = setupCareStepHelp;
