function addRiskDonut(riskCounts, options) {
    options = options || {};
    const chartId = options.chartId || 'riskChart';
    const canvas = document.getElementById(chartId);
    if (!canvas || !riskCounts) return;
    const existing = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) existing.destroy();
    const ctx = canvas.getContext('2d');
    // Capitalize the first letter of each label
    const labels = Object.keys(riskCounts).map(key => {
        return key.charAt(0).toUpperCase() + key.slice(1);
    });
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Risk count',
                data: Object.values(riskCounts),
                backgroundColor: [
                    'rgba(226, 230, 233, 1)',
                    'rgba(221, 29, 29, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(54, 162, 235, 1)'

                ],
                borderColor: [
                    'rgba(226, 230, 233, 1)',
                    'rgba(221, 29, 29, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(54, 162, 235, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 8,
                        font: { size: 11 },
                    },
                },
                title: {
                    display: false,
                    text: 'Risk Counts'
                }
            }
        }
    });
}
function addAverages(averageScores, options) {
    if (!averageScores) return;
    options = options || {};
    const likelihoodBarId = options.likelihoodBarId || 'likelihood-bar';
    const impactBarId = options.impactBarId || 'impact-bar';
    const riskBarId = options.riskBarId || 'risk-bar';

    const likelihood = parseFloat(averageScores.likelihood) || 0;
    const impact = parseFloat(averageScores.impact) || 0;
    const riskScore = parseFloat(averageScores.riskScore) || 0;

    const likelihoodBar = document.getElementById(likelihoodBarId);
    if (likelihoodBar) {
        likelihoodBar.style.width = (likelihood / 3 * 100) + '%';
        likelihoodBar.innerText = averageScores.likelihood;
        likelihoodBar.style.backgroundColor = getColorForScore(likelihood);
    }

    const impactBar = document.getElementById(impactBarId);
    if (impactBar) {
        impactBar.style.width = (impact / 3 * 100) + '%';
        impactBar.innerText = averageScores.impact;
        impactBar.style.backgroundColor = getColorForScore(impact);
    }

    const riskBar = document.getElementById(riskBarId);
    if (riskBar) {
        riskBar.style.width = (riskScore / 9 * 100) + '%';
        riskBar.innerText = averageScores.riskScore;
        riskBar.style.backgroundColor = getColorForScore(riskScore / 3);
    }
}

function escapeHtmlTopRisk(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function addTopRisks(topRisks, options) {
    options = options || {};
    const tableBodyId = options.tableBodyId || 'topRisksTableBody';
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    tableBody.innerHTML = ''; // Clear existing rows

    if (!topRisks || !topRisks.length) return;

    topRisks.forEach(risk => {
        const row = tableBody.insertRow();
        const scoreText = getScoreText(risk.score/3);
        const scoreColor = getColorForScore(risk.score/2);
        const pid = risk.projectId != null ? String(risk.projectId) : '';
        const rawTitle = risk.evaluationTitle != null && String(risk.evaluationTitle).trim() !== ''
            ? String(risk.evaluationTitle)
            : 'Untitled evaluation';
        const riskCell =
            '<strong>' + escapeHtmlTopRisk(rawTitle) + '</strong><br>' +
            escapeHtmlTopRisk(risk.consequence);

        const viewHref = pid ? '/project/' + encodeURIComponent(pid) + '/actionPlanning' : '#';
        row.innerHTML = `
            <td>${riskCell}</td>
            <td style="background-color: ${scoreColor}; text-align: center; color: white;">${scoreText}</td>
            <td style="text-align: center;"><a href="${viewHref}">View</a></td>
        `;
    });
}

function getScoreText(score) {
    if (score < 1) {
        return 'Low';
    } else if (score < 2) {
        return 'Medium';
    } else {
        return 'High';
    }
}

function getColorForScore(score) {
    if (score > 2) {
        return 'rgba(221, 29, 29, 1)';
    } else if (score >= 1 && score <= 2) {
        return 'rgba(255, 206, 86, 1)';
    } else {
        return 'rgba(54, 162, 235, 1)';
    }
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