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
    try {
        console.log('Generating chart with risk counts:', riskCounts);
        
        if (!riskCounts || Object.keys(riskCounts).length === 0) {
            console.warn('No risk counts provided, using default data');
            riskCounts = { 'No Data': 1 };
        }

        // Capitalize the first letter of each label
        const labels = Object.keys(riskCounts).map(key => {
            return key.charAt(0).toUpperCase() + key.slice(1);
        });

        const myChart = new ChartJsImage();
        myChart.setConfig({
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
        console.log('Chart generated successfully, size:', buf.length, 'bytes');
        return buf;
    } catch (error) {
        console.error('Error generating chart:', error);
        // Return a minimal valid image buffer as fallback
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    }
}

async function buildDocx(project, metrics, owner) {
    console.log('Starting docx build for project:', project.title);
    console.log('Metrics:', JSON.stringify(metrics, null, 2));
    console.log('Owner:', owner);

    // Validate inputs
    if (!project || !project.title) {
        throw new Error('Invalid project data: missing project or title');
    }
    
    if (!metrics) {
        throw new Error('Invalid metrics data');
    }
    
    if (!owner || !owner.name) {
        throw new Error('Invalid owner data');
    }

    const positiveUnintended = project.unintendedConsequences ? project.unintendedConsequences.filter(u => u.outcome === 'Positive') : [];
    const negativeUnintended = project.unintendedConsequences ? project.unintendedConsequences.filter(u => u.outcome !== 'Positive') : [];
    
    console.log('Processing unintended consequences - positive:', positiveUnintended.length, 'negative:', negativeUnintended.length);

    let donutChartData;
    try {
        donutChartData = await getImage(metrics.riskCounts);
    } catch (error) {
        console.error('Failed to generate chart, using fallback:', error);
        donutChartData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    }

    let tempFilePath;
    try {
        // Create temporary file
        const tmpFile = await tmp.file();
        tempFilePath = tmpFile.path;
        console.log('Created temporary file:', tempFilePath);

        // Read template file
        const templatePath = "./public/data/template.docx";
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template file not found: ${templatePath}`);
        }
        
        const templateBuffer = fs.readFileSync(templatePath);
        console.log('Template file read, size:', templateBuffer.length, 'bytes');

        // Validate template buffer
        if (templateBuffer.length < 1000) {
            throw new Error('Template file appears to be corrupted or too small');
        }

        console.log('Starting document patch...');
        
        const doc = await docx.patchDocument(templateBuffer, {
            outputType: "nodebuffer",
            features: {
                updateFields: true,
            },
            patches: {
                doctitle: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun( {
                            text: project.title || 'Untitled Project',
                            size: 60
                        })
                    ]
                },
                title: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.title || 'Untitled Project')
                    ]
                },
                author: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun((owner.name || 'Unknown') + " (" + (owner.email || 'No email') + ")")
                    ]
                },
                footertitle: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.title || 'Untitled Project')
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
                        new docx.TextRun(project.objectives || 'No objectives specified')
                    ]
                },
                intendedConsequences: {
                    type: docx.PatchType.DOCUMENT,
                    children: (project.intendedConsequences || []).map(consequence =>
                        new docx.Paragraph({
                            text: consequence.consequence || 'No consequence specified',
                            bullet: {
                                level: 0
                            }
                        })
                    )
                },
                positiveUnintendedConsequences: {
                    type: docx.PatchType.DOCUMENT,
                    children: positiveUnintended.length > 0
                        ? positiveUnintended.map(u => new docx.Paragraph({
                            text: u.consequence || 'No consequence specified',
                            bullet: { level: 0 }
                        }))
                        : [new docx.Paragraph("None recorded.")]
                },
                dataUsed: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(project.dataUsed || 'No data specified')
                    ]
                },
                stakeholders: {
                    type: docx.PatchType.DOCUMENT,
                    children: (project.stakeholders || []).map(stakeholder =>
                        new docx.Paragraph({
                            text: stakeholder.stakeholder || 'No stakeholder specified',
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
                        new docx.TextRun(`${metrics.averages?.likelihood || 'N/A'}`)
                    ]
                },
                averageImpact: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(`${metrics.averages?.impact || 'N/A'}`)
                    ]
                },
                averageRisk: {
                    type: docx.PatchType.PARAGRAPH,
                    children: [
                        new docx.TextRun(`${metrics.averages?.riskScore || 'N/A'}`)
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
                                ...(metrics.topRisks || []).map(risk =>
                                    new docx.TableRow({
                                        children: [
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(risk.consequence || 'No consequence')],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(risk.level || 'Unknown')],
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
                                ...negativeUnintended.map(unintendedConsequence =>
                                    new docx.TableRow({
                                        children: [
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.consequence || 'No consequence')],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.outcome || 'Unknown')],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.impact || 'Unknown')],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.likelihood || 'Unknown')],
                                            }),
                                            new docx.TableCell({
                                                children: [new docx.Paragraph(unintendedConsequence.role || '')],
                                            }),
                                            new docx.TableCell({
                                                children: [
                                                    new docx.Paragraph(
                                                        unintendedConsequence.action
                                                            ? `${unintendedConsequence.action.description || 'No description'}`
                                                            : 'N/A'
                                                    ),
                                                    new docx.Paragraph({
                                                        children: [
                                                            new docx.TextRun({
                                                                text: "Assignee: ",
                                                                bold: true,
                                                            }),
                                                            new docx.TextRun(
                                                                unintendedConsequence.action?.stakeholder
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
                                                                unintendedConsequence.action?.KPI
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
                                                                unintendedConsequence.action?.date
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

        console.log('Document patch completed, output size:', doc.length, 'bytes');

        // Validate the generated document
        if (!doc || doc.length < 1000) {
            throw new Error(`Generated document is too small (${doc.length} bytes), likely corrupted`);
        }

        // Write the patched document to the temporary file
        fs.writeFileSync(tempFilePath, doc);
        console.log('Document written to temporary file, size:', fs.statSync(tempFilePath).size, 'bytes');

        // Validate the written file
        const fileStats = fs.statSync(tempFilePath);
        if (fileStats.size < 1000) {
            throw new Error(`Written file is too small (${fileStats.size} bytes), likely corrupted`);
        }

        console.log('Docx build completed successfully');
        return tempFilePath;
    } catch (err) {
        console.error("Error creating docx:", err);
        
        // Clean up temporary file if it exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.error("Error cleaning up temp file:", cleanupError);
            }
        }
        
        throw err; // Rethrow the error to be handled elsewhere
    }
}

module.exports = { buildDocx };