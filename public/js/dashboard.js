function addRiskDonut(riskCounts) {
    const ctx = document.getElementById('riskChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(riskCounts),
            datasets: [{
                label: 'Risk count',
                data: Object.values(riskCounts),
                backgroundColor: [
                    'rgba(200, 200, 200, 0.5)',
                    'rgba(255, 99, 132, 0.5)',
                    'rgba(255, 206, 86, 0.5)',
                    'rgba(54, 162, 235, 0.5)'

                ],
                borderColor: [
                    'rgba(200, 200, 200, 1)',
                    'rgba(255, 99, 132, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(54, 162, 235, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            aspectRatio: 2,
            responsive: true,
            plugins: {
                legend: {
                    position: 'right',
                },
                title: {
                    display: false,
                    text: 'Risk Counts'
                }
            }
        }
    });
}
function addAverages(averageScores) {
    const likelihoodBar = document.getElementById('likelihood-bar');
    likelihoodBar.style.width = (averageScores.likelihood / 3 * 100) + '%';
    likelihoodBar.innerText = averageScores.likelihood;
    likelihoodBar.style.backgroundColor = getColorForScore(averageScores.likelihood);

    const impactBar = document.getElementById('impact-bar');
    impactBar.style.width = (averageScores.impact / 3 * 100) + '%';
    impactBar.innerText = averageScores.impact;
    impactBar.style.backgroundColor = getColorForScore(averageScores.impact);

    const riskBar = document.getElementById('risk-bar');
    riskBar.style.width = (averageScores.riskScore / 9 * 100) + '%';
    riskBar.innerText = averageScores.riskScore;
    riskBar.style.backgroundColor = getColorForScore(averageScores.riskScore / 3);
}

function addTopRisks(topRisks) {
    const tableBody = document.getElementById('topRisksTableBody');
    tableBody.innerHTML = ''; // Clear existing rows

    topRisks.forEach(risk => {
        const row = tableBody.insertRow();
        const scoreText = getScoreText(risk.score/3);
        const scoreColor = getColorForScore(risk.score/3);

        row.innerHTML = `
            <td>${risk.consequence}</td>
            <td style="color: ${scoreColor}">${scoreText}</td>
            <td><a href="/project/${risk.projectId}/actionPlanning">View</a></td>
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
        return 'rgba(255, 99, 132, 0.75)';
    } else if (score >= 1 && score <= 2) {
        return 'rgba(255, 206, 86, 0.75)';
    } else {
        return 'rgba(54, 162, 235, 0.75)';
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