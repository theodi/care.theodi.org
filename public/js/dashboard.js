function escapeHtmlTopRisk(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getBandFromScore(score) {
    if (score == null || Number.isNaN(score)) return 'Unclassified';
    if (score >= 7) return 'High';
    if (score >= 3) return 'Medium';
    return 'Low';
}

function getColorForBand(band) {
    if (band === 'High') return 'rgba(221, 29, 29, 1)';
    if (band === 'Medium') return 'rgba(255, 206, 86, 1)';
    if (band === 'Low') return 'rgb(57, 184, 112)';
    return 'rgba(226, 230, 233, 1)';
}

function normalizeLevel(value) {
    const t = String(value || '').trim().toLowerCase();
    if (t === 'high') return 'High';
    if (t === 'medium') return 'Medium';
    if (t === 'low') return 'Low';
    return '';
}

function buildMatrixCellId(impact, likelihood) {
    const i = normalizeLevel(impact);
    const l = normalizeLevel(likelihood);
    if (!i || !l) return '';
    return i + '|' + l;
}

function addRiskDonut(riskCounts, options) {
    options = options || {};
    const chartId = options.chartId || 'riskChart';
    const onBarClick = typeof options.onBarClick === 'function' ? options.onBarClick : null;
    const activeLabels = new Set(Array.isArray(options.activeLabels) ? options.activeLabels : []);
    const canvas = document.getElementById(chartId);
    if (!canvas || !riskCounts) return;
    const existing = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) existing.destroy();
    const ctx = canvas.getContext('2d');
    const labels = ['Unclassified', 'High', 'Medium', 'Low'];
    const values = [
        Number(riskCounts.unclassified || 0),
        Number(riskCounts.high || 0),
        Number(riskCounts.medium || 0),
        Number(riskCounts.low || 0),
    ];
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Risk count',
                data: values,
                backgroundColor: labels.map((l) => getColorForBand(l)),
                borderColor: labels.map((l) => getColorForBand(l)),
                borderWidth: labels.map((l) => (activeLabels.has(l) ? 3 : 1)),
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: {
                legend: { display: false },
            },
            onClick: function (_evt, elements) {
                if (!onBarClick || !elements || !elements.length) return;
                const idx = elements[0].index;
                onBarClick(labels[idx]);
            },
        },
    });
    if (onBarClick) canvas.style.cursor = 'pointer';
}

function addBinaryBarChart(options) {
    options = options || {};
    const chartId = options.chartId;
    const labels = Array.isArray(options.labels) ? options.labels : [];
    const values = Array.isArray(options.values) ? options.values : [];
    const onBarClick = typeof options.onBarClick === 'function' ? options.onBarClick : null;
    const activeLabels = new Set(Array.isArray(options.activeLabels) ? options.activeLabels : []);
    const canvas = document.getElementById(chartId);
    if (!canvas || !labels.length || !values.length) return;
    const existing = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) existing.destroy();
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: values,
                backgroundColor: labels.map(() => '#072589'),
                borderColor: labels.map(() => '#072589'),
                borderWidth: labels.map((l) => (activeLabels.has(l) ? 3 : 1)),
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { display: false } },
            onClick: function (_evt, elements) {
                if (!onBarClick || !elements || !elements.length) return;
                const idx = elements[0].index;
                onBarClick(labels[idx]);
            },
        },
    });
    if (onBarClick) canvas.style.cursor = 'pointer';
}

function addAverages() {}

function addTopRisks() {}

function renderRiskMatrix(matrixCounts, options) {
    options = options || {};
    const tableId = options.tableId || 'riskMatrixTable';
    const table = document.getElementById(tableId);
    if (!table) return;
    const body = table.querySelector('tbody');
    if (!body) return;
    const levels = ['High', 'Medium', 'Low'];
    body.innerHTML = '';
    levels.forEach((impact) => {
        const tr = document.createElement('tr');
        const head = document.createElement('th');
        head.scope = 'row';
        head.textContent = impact;
        tr.appendChild(head);
        levels.forEach((likelihood) => {
            const value =
                matrixCounts &&
                matrixCounts[impact] &&
                typeof matrixCounts[impact][likelihood] !== 'undefined'
                    ? Number(matrixCounts[impact][likelihood] || 0)
                    : 0;
            const td = document.createElement('td');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'matrix-cell-btn';
            btn.setAttribute('data-impact', impact);
            btn.setAttribute('data-likelihood', likelihood);
            btn.setAttribute('data-cell-id', buildMatrixCellId(impact, likelihood));
            btn.setAttribute(
                'aria-label',
                `${value} risks with ${likelihood} likelihood and ${impact} impact`
            );
            btn.style.backgroundColor = getColorForBand(getBandFromScore(levelToValue(impact) * levelToValue(likelihood)));
            btn.textContent = String(value);
            td.appendChild(btn);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

function levelToValue(level) {
    if (level === 'High') return 3;
    if (level === 'Medium') return 2;
    if (level === 'Low') return 1;
    return 0;
}

function updateSelectedMatrixCells(selectedSet, options) {
    options = options || {};
    const tableId = options.tableId || 'riskMatrixTable';
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('.matrix-cell-btn').forEach((el) => {
        const id = String(el.getAttribute('data-cell-id') || '');
        const on = selectedSet && selectedSet.has(id);
        el.classList.toggle('matrix-cell-btn--active', !!on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

async function addRiskScoreToProject(project) {
    for (const unintendedConsequence of project.unintendedConsequences) {
        // Check if both impact and likelihood are defined
        if (unintendedConsequence.likelihood && unintendedConsequence.impact) {
            // Calculate risk score for the unintended consequence
            let riskScore = 1; // Default risk score
            switch (unintendedConsequence.likelihood) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown likelihood
                    break;
            }
            switch (unintendedConsequence.impact) {
                case 'High':
                    riskScore *= 3;
                    break;
                case 'Medium':
                    riskScore *= 2;
                    break;
                case 'Low':
                    riskScore *= 1;
                    break;
                default:
                    // Handle unknown impact
                    break;
            }
            // Add risk score to the unintended consequence
            unintendedConsequence.riskScore = riskScore;
        } else {
            unintendedConsequence.riskScore = null;
        }
    }
    return project;
}