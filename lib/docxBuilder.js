// docxBuilder.js

const docx = require('docx');
const fs = require('fs');
const tmp = require('tmp-promise');
const ChartJsImage = require('chartjs-to-image');

// Function to get the ordinal suffix for the day
function getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) {
        return "th";
    }
    switch (day % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
    }
}

function getPublicationDate() {
    const today = new Date();
    const day = today.getDate();
    const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
    const monthIndex = today.getMonth();
    const year = today.getFullYear();
    const formattedDate = `${day}${getOrdinalSuffix(day)} ${monthNames[monthIndex]} ${year}`;
    return formattedDate;
}

function getPublicationYear() {
    const today = new Date();
    const year = today.getFullYear();
    const formattedDate = `${year}`;
    return formattedDate;
}

async function getImage(riskCounts) {
    const myChart = new ChartJsImage();
    myChart.setConfig({
        type: 'doughnut',
        data: {
            labels: Object.keys(riskCounts),
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
    const buf = await myChart.toBinary();
    return buf;
}

async function buildDocx(project,metrics, owner) {
    const donutChartData = await getImage(metrics.riskCounts);

    try {
        const { path: tempFilePath } = await tmp.file();

        const doc = await docx.patchDocument(fs.readFileSync("./public/data/template.docx"), {
            outputType: "nodebuffer",
            features: {
                updateFields: true,
            },
            patches: {
                doctitle: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun( {
                            text: project.title,
                            size: 60
                        })
                    ]
                },
                title: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.title)
                    ]
                },
                author: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(owner.name + " (" + owner.email + ")")
                    ]
                },
                footertitle: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.title)
                    ]
                },
                date: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun( {
                            text: getPublicationDate(),
                        })
                    ]
                },
                footerdate: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun( {
                            text: getPublicationYear(),
                        })
                    ]
                },
                objectives: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.objectives)
                    ]
                },
                intendedConsequences: {
                    type: docx.PatchType.DOCUMENT,
                    children: project.intendedConsequences.map(consequence =>
                        new docx.Paragraph({
                            text: consequence.consequence,
                            bullet: {
                                level: 0
                            }
                        })
                    )
                },
                dataUsed: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.dataUsed)
                    ]
                },
                stakeholders: {
                    type: docx.PatchType.DOCUMENT,
                    children: project.stakeholders.map(stakeholder =>
                        new docx.Paragraph({
                            text: stakeholder.stakeholder,
                            bullet: {
                                level: 0
                            }
                        })
                    )
                },
                donutChart: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.ImageRun({
                            type: 'png',
                            data: donutChartData,
                            transformation: {
                                width: 300,
                                height: 200,
                            }
                        })
                    ]
                },
                averageLikelihood: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(`${metrics.averages.likelihood}`)
                    ]
                },
                averageImpact: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(`${metrics.averages.impact}`)
                    ]
                },
                averageRisk: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(`${metrics.averages.riskScore}`)
                    ]
                },
                topRisks: {
                    type: docx.PatchType.DOCUMENT,
                    children: [
                        new docx.Table({
                            columns: 2,
                            width: 0,
                            columnWidths: [7638,2000], // total page width is 9638 DXA for A4 portrait
                            rows: [
                                new docx.TableRow({
                                    children: [
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Risk')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Risk level')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        })
                                    ]
                                }),
                                ...metrics.topRisks.map(risk =>
                                    new docx.TableRow({
                                        children: [
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(risk.consequence)],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(risk.level)],
                                            })
                                        ]
                                    })
                                )
                            ]
                        })
                    ]
                },
                unintendedConsequneces: {
                    type: docx.PatchType.DOCUMENT,
                    children: [
                        new docx.Table({
                            columns: 6,
                            width: 0,
                            columnWidths: [3200,1606,1606,1606,1606,4800], // total page width is 9638 DXA for A4 portrait
                            rows: [
                                new docx.TableRow({
                                    children: [
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Consequence')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Outcome')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Impact')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Likelihood')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Role')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        }),
                                        new docx.TableCell({
                                            children: [new docx.Paragraph('Action')],
                                            shading: {
                                                fill: "072589",
                                                color: "ffffff"
                                            }
                                        })
                                    ]
                                }),
                                ...project.unintendedConsequences.map(unintendedConsequence =>
                                    new docx.TableRow({
                                        children: [
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.consequence)],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.outcome)],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.impact)],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.likelihood)],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.role || '')],
                                            }),
                                            new docx.TableCell({
                                                children: [
                                                    new docx.Paragraph(
                                                        unintendedConsequence.action
                                                            ? `${unintendedConsequence.action.description}`
                                                            : 'N/A'
                                                    ),
                                                    new docx.Paragraph({
                                                        children: [
                                                            new docx.TextRun({
                                                                text: "Assignee: ",
                                                                bold: true,
                                                            }),
                                                            new docx.TextRun(
                                                                unintendedConsequence.action.stakeholder
                                                                ? `${unintendedConsequence.action.stakeholder}`
                                                                : 'N/A'
                                                            )
                                                        ]
                                                    }),
                                                    new docx.Paragraph({
                                                        children: [
                                                            new docx.TextRun({
                                                                text: "KPI: ",
                                                                bold: true,
                                                            }),
                                                            new docx.TextRun(
                                                                unintendedConsequence.action.KPI
                                                                ? `${unintendedConsequence.action.KPI}`
                                                                : 'N/A'
                                                            )
                                                        ]
                                                    }),
                                                    new docx.Paragraph({
                                                        children: [
                                                            new docx.TextRun({
                                                                text: "Time frame: ",
                                                                bold: true,
                                                            }),
                                                            new docx.TextRun(
                                                                unintendedConsequence.action.date
                                                                ? `${unintendedConsequence.action.date}`
                                                                : 'N/A'
                                                            )
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                )
                            ]
                        })
                    ]
                }
            }
        });

        // Write the patched document to the temporary file
        fs.writeFileSync(tempFilePath, doc);

        return tempFilePath;
    } catch (err) {
        console.log("Error creating docx:", err);
        throw err; // Rethrow the error to be handled elsewhere
    }
}

module.exports = { buildDocx };