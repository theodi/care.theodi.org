// docxBuilder.js

const docx = require('docx');
const fs = require('fs');
const tmp = require('tmp-promise');
const ChartJsImage = require('chartjs-to-image');
const { DEFAULT_REPORT_ACCENT_HEX } = require('./reportTemplatePlaceholders');
const { normalizeHex6 } = require('./reportTemplateValidation');

function accentHexOrDefault(hex) {
    const n = hex != null ? normalizeHex6(String(hex).trim()) : null;
    return n || DEFAULT_REPORT_ACCENT_HEX;
}

function accentTableHeaderShading(accentHex) {
    return { fill: accentHex, color: "ffffff" };
}

/** White bold label on accent-filled table header cells. */
function accentTableHeaderParagraph(label) {
    return new docx.Paragraph({
        children: [
            new docx.TextRun({
                text: label,
                color: "FFFFFF",
                bold: true,
            }),
        ],
    });
}

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

function loadGlossary() {
    const glossaryPath = "./public/data/glossary.json";
    if (!fs.existsSync(glossaryPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(glossaryPath, "utf8"));
    } catch (e) {
        console.error("Failed to read glossary.json:", e);
        return null;
    }
}

function buildGlossaryAppendixChildren(include, glossary, accentHex) {
    if (!include) {
        return [new docx.Paragraph("")];
    }
    const children = [
        new docx.Paragraph({ children: [new docx.PageBreak()] }),
        new docx.Paragraph({
            text: "Appendix: Glossary",
            heading: docx.HeadingLevel.HEADING_2,
        }),
        new docx.Paragraph({
            text: "Definitions of terms used in this report.",
        }),
    ];
    if (!glossary || typeof glossary !== "object") {
        children.push(new docx.Paragraph("Glossary could not be loaded."));
        return children;
    }
    const letters = Object.keys(glossary).sort();
    for (const letter of letters) {
        const entries = glossary[letter];
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }
        // Body-style paragraph (not a Word heading) so letter groupings stay out of the TOC.
        children.push(
            new docx.Paragraph({
                spacing: { before: 200, after: 80 },
                children: [
                    new docx.TextRun({
                        text: letter,
                        bold: true,
                        color: accentHex,
                        size: 24,
                        font: "Arial",
                    }),
                ],
            })
        );
        const sorted = [...entries].sort((a, b) =>
            (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })
        );
        for (const entry of sorted) {
            children.push(
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: entry.title || "Term", bold: true }),
                        new docx.TextRun({ text: ": " }),
                        new docx.TextRun({ text: entry.description || "" }),
                    ],
                })
            );
        }
    }
    return children;
}

const AI_PROVENANCE_MAX_CHARS = 28000;

function clipProvenanceText(s) {
    const t = String(s || "");
    if (t.length <= AI_PROVENANCE_MAX_CHARS) {
        return t;
    }
    return `${t.slice(0, AI_PROVENANCE_MAX_CHARS)}\n\n[… truncated for document size …]`;
}

function pushLabelParagraph(children, text, accentHex) {
    children.push(
        new docx.Paragraph({
            spacing: { before: 160, after: 80 },
            children: [
                new docx.TextRun({
                    text,
                    bold: true,
                    color: accentHex,
                    font: "Arial",
                    size: 24,
                }),
            ],
        })
    );
}

function pushMonospaceBlock(children, body) {
    const paras = buildMonospaceParagraphs(body);
    paras.forEach((p) => children.push(p));
}

/** Paragraphs (Courier) for embedding in a table cell or block. */
function buildMonospaceParagraphs(body) {
    const clipped = clipProvenanceText(body);
    const lines = clipped.split("\n");
    const maxLines = 400;
    const useLines = lines.length > maxLines ? lines.slice(0, maxLines).concat("[… more lines omitted …]") : lines;
    return useLines.map(
        (line) =>
            new docx.Paragraph({
                children: [
                    new docx.TextRun({
                        text: line.length ? line : " ",
                        font: "Courier New",
                        size: 18,
                    }),
                ],
            })
    );
}

function selectedIndicesFromRun(run) {
    const set = new Set();
    const sels = run && Array.isArray(run.selections) ? run.selections : [];
    for (const sel of sels) {
        if (!sel || !Array.isArray(sel.indices)) {
            continue;
        }
        for (const i of sel.indices) {
            const n = Number(i);
            if (Number.isInteger(n) && n >= 0) {
                set.add(n);
            }
        }
    }
    return set;
}

const AI_PROV_KV_MAX_PAIRS = 120;
const AI_PROV_KV_MAX_VALUE_CHARS = 4000;

/**
 * Flatten a suggestion object into { key, value } rows (dotted paths, [i] for arrays).
 */
function flattenSuggestionToKeyValuePairs(sug) {
    const pairs = [];
    let truncated = false;
    function walk(path, val) {
        if (pairs.length >= AI_PROV_KV_MAX_PAIRS) {
            truncated = true;
            return;
        }
        if (val === null || val === undefined) {
            pairs.push({ key: path || "value", value: "—" });
            return;
        }
        const t = typeof val;
        if (t === "string" || t === "number" || t === "boolean") {
            let s = String(val)
                .replace(/\r\n/g, "\n")
                .replace(/\n+/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            if (s.length > AI_PROV_KV_MAX_VALUE_CHARS) {
                s = `${s.slice(0, AI_PROV_KV_MAX_VALUE_CHARS)}…`;
            }
            pairs.push({ key: path || "value", value: s.length ? s : "—" });
            return;
        }
        if (Array.isArray(val)) {
            if (val.length === 0) {
                pairs.push({ key: path || "list", value: "(empty)" });
                return;
            }
            for (let i = 0; i < val.length; i++) {
                if (pairs.length >= AI_PROV_KV_MAX_PAIRS) {
                    truncated = true;
                    return;
                }
                const next = path ? `${path}[${i}]` : `[${i}]`;
                walk(next, val[i]);
            }
            return;
        }
        if (t === "object") {
            const keys = Object.keys(val);
            if (keys.length === 0) {
                pairs.push({ key: path || "object", value: "{}" });
                return;
            }
            for (const k of keys) {
                if (pairs.length >= AI_PROV_KV_MAX_PAIRS) {
                    truncated = true;
                    return;
                }
                const next = path ? `${path}.${k}` : k;
                walk(next, val[k]);
            }
        }
    }
    if (sug == null) {
        return [{ key: "response", value: "—" }];
    }
    if (typeof sug !== "object") {
        let s = String(sug);
        if (s.length > AI_PROV_KV_MAX_VALUE_CHARS) {
            s = `${s.slice(0, AI_PROV_KV_MAX_VALUE_CHARS)}…`;
        }
        return [{ key: "response", value: s }];
    }
    walk("", sug);
    if (truncated) {
        pairs.push({ key: "…", value: "Further fields omitted for document size." });
    }
    return pairs;
}

function buildKeyValueParagraphsForSuggestion(sug) {
    const pairs = flattenSuggestionToKeyValuePairs(sug);
    return pairs.map(
        ({ key, value }) =>
            new docx.Paragraph({
                spacing: { after: 40 },
                children: [
                    new docx.TextRun({ text: `${key}: `, bold: true }),
                    new docx.TextRun({ text: value.length ? value : " " }),
                ],
            })
    );
}

function buildSuggestionsWithSelectionTable(run, accentHex) {
    const suggestions = Array.isArray(run.suggestions) ? run.suggestions : [];
    const selected = selectedIndicesFromRun(run);
    const hdr = accentTableHeaderShading(accentHex);
    const headerRow = new docx.TableRow({
        children: [
            new docx.TableCell({
                children: [accentTableHeaderParagraph("Selected")],
                shading: hdr,
            }),
            new docx.TableCell({
                children: [accentTableHeaderParagraph("#")],
                shading: hdr,
            }),
            new docx.TableCell({
                children: [accentTableHeaderParagraph("Response")],
                shading: hdr,
            }),
        ],
    });
    if (suggestions.length === 0) {
        return new docx.Table({
            columns: 3,
            width: 0,
            columnWidths: [1600, 900, 7138],
            rows: [
                headerRow,
                new docx.TableRow({
                    children: [
                        new docx.TableCell({
                            columnSpan: 3,
                            children: [new docx.Paragraph("No suggestions were recorded for this run.")],
                        }),
                    ],
                }),
            ],
        });
    }
    const dataRows = suggestions.map((sug, index) => {
        const isSel = selected.has(index);
        const responseParas = buildKeyValueParagraphsForSuggestion(sug);
        return new docx.TableRow({
            children: [
                new docx.TableCell({
                    children: [new docx.Paragraph(isSel ? "Yes" : "No")],
                    verticalAlign: docx.VerticalAlign.CENTER,
                }),
                new docx.TableCell({
                    children: [new docx.Paragraph(String(index + 1))],
                    verticalAlign: docx.VerticalAlign.TOP,
                }),
                new docx.TableCell({
                    children: responseParas.length > 0 ? responseParas : [new docx.Paragraph(" ")],
                    verticalAlign: docx.VerticalAlign.TOP,
                }),
            ],
        });
    });
    return new docx.Table({
        columns: 3,
        width: 0,
        columnWidths: [1600, 900, 7138],
        rows: [headerRow, ...dataRows],
    });
}

function projectHasAiProvenance(project) {
    const h = project && project.aiInteractionHistory;
    return Array.isArray(h) && h.length > 0;
}

/**
 * Optional paragraph in the front-matter About section (patch {{aiAssistedNotice}}), after the author
 * line and ODI disclaimer — only when AI runs are recorded. Wording reflects whether this export
 * included the provenance appendix.
 */
function buildAiAssistedNoticeChildren(project, includeProvenanceAppendix, accentHex) {
    if (!projectHasAiProvenance(project)) {
        return [new docx.Paragraph("")];
    }
    const intro =
        "Generative AI was used while completing parts of this assessment. ";
    const body = includeProvenanceAppendix
        ? intro +
          "For this export, the detailed transparency record (prompts, model configuration, reasoning where captured, and your selections) is appended at the end of this document under Appendix: AI provenance."
        : intro +
          "A transparency record (prompts, model configuration, reasoning where captured, and your selections) is stored with this project in CARE, but it was not appended to this file. To include it, export the report again from CARE and tick “Include AI provenance appendix”.";
    return [
        new docx.Paragraph({
            spacing: { before: 80, after: 120 },
            children: [
                new docx.TextRun({
                    text: "Artificial intelligence: ",
                    bold: true,
                    color: accentHex,
                }),
                new docx.TextRun({ text: body }),
            ],
        }),
    ];
}

function buildAiProvenanceAppendixChildren(include, project, accentHex) {
    if (!include) {
        return [new docx.Paragraph("")];
    }
    const children = [
        new docx.Paragraph({ children: [new docx.PageBreak()] }),
        new docx.Paragraph({
            text: "Appendix: AI provenance",
            heading: docx.HeadingLevel.HEADING_2,
        }),
        new docx.Paragraph({
            text: "Transparency record: prompts, model configuration, each model response with whether it was applied to the project, and reasoning (when available). Raw API payloads are omitted.",
        }),
    ];
    const rawHist = project && Array.isArray(project.aiInteractionHistory) ? project.aiInteractionHistory : [];
    if (rawHist.length === 0) {
        children.push(new docx.Paragraph("No AI interactions were recorded for this project."));
        return children;
    }
    const hist = [...rawHist].sort((a, b) =>
        String(a.completedAt || a.startedAt || "").localeCompare(
            String(b.completedAt || b.startedAt || "")
        )
    );
    hist.forEach((run, idx) => {
        if (!run || typeof run !== "object") {
            return;
        }
        const model = run.model && typeof run.model === "object" ? run.model : {};
        const headerLine = `Run ${idx + 1}: ${run.stepId || "?"} — ${run.completedAt || run.startedAt || ""} — ${run.status || ""}`;
        const modelLine = `Source: ${run.aiSource || "?"} | Provider: ${model.provider || "?"} | Model: ${model.model || "?"}`;
        children.push(
            new docx.Paragraph({
                spacing: { before: 240, after: 120 },
                children: [
                    new docx.TextRun({
                        text: headerLine,
                        bold: true,
                        color: accentHex,
                        size: 24,
                        font: "Arial",
                    }),
                ],
            })
        );
        children.push(new docx.Paragraph({ text: modelLine }));
        if (model.baseURL) {
            children.push(new docx.Paragraph({ text: `Base URL: ${model.baseURL}` }));
        }
        children.push(
            new docx.Paragraph({
                text: `Include existing step answers in prompt: ${run.includeExistingStepData ? "yes" : "no"}; include organisation context: ${run.includeOrganisationContext ? "yes" : "no"}`,
            })
        );
        if (run.pipelineRunId) {
            children.push(new docx.Paragraph({ text: `Pipeline run id: ${run.pipelineRunId}` }));
        }
        if (run.runId) {
            children.push(new docx.Paragraph({ text: `Run id: ${run.runId}` }));
        }
        if (run.error) {
            children.push(new docx.Paragraph({ text: `Error: ${run.error}` }));
        }
        pushLabelParagraph(children, "Prompt (full text sent to the model)", accentHex);
        pushMonospaceBlock(children, run.promptFull);
        if (run.reasoning && String(run.reasoning).trim()) {
            pushLabelParagraph(children, "AI reasoning", accentHex);
            pushMonospaceBlock(children, run.reasoning);
        }
        pushLabelParagraph(children, "Model responses", accentHex);
        children.push(buildSuggestionsWithSelectionTable(run, accentHex));
    });
    return children;
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

async function buildDocx(project, metrics, owner, reportOptions = {}) {
    const includeGlossaryAppendix = !!reportOptions.includeGlossaryAppendix;
    const includeAiProvenance = !!reportOptions.includeAiProvenance;
    const accentHex = accentHexOrDefault(reportOptions.accentHex);
    const glossaryData = includeGlossaryAppendix ? loadGlossary() : null;
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

        // Template: org-supplied buffer or default CARE template
        let templateBuffer = reportOptions.templateBuffer;
        if (!Buffer.isBuffer(templateBuffer) || templateBuffer.length < 1000) {
            const templatePath = "./public/data/template.docx";
            if (!fs.existsSync(templatePath)) {
                throw new Error(`Template file not found: ${templatePath}`);
            }
            templateBuffer = fs.readFileSync(templatePath);
            console.log('Using default template, size:', templateBuffer.length, 'bytes');
        } else {
            console.log('Using custom template buffer, size:', templateBuffer.length, 'bytes');
        }

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
                aiAssistedNotice: {
                    type: docx.PatchType.DOCUMENT,
                    children: buildAiAssistedNoticeChildren(project, includeAiProvenance, accentHex),
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
                                            children: [accentTableHeaderParagraph('Risk')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Risk level')],
                                            shading: accentTableHeaderShading(accentHex),
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
                aiProvenance: {
                    type: docx.PatchType.DOCUMENT,
                    children: buildAiProvenanceAppendixChildren(includeAiProvenance, project, accentHex),
                },
                glossaryAppendix: {
                    type: docx.PatchType.DOCUMENT,
                    children: buildGlossaryAppendixChildren(includeGlossaryAppendix, glossaryData, accentHex),
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
                                            children: [accentTableHeaderParagraph('Consequence')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Outcome')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Impact')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Likelihood')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Role')],
                                            shading: accentTableHeaderShading(accentHex),
                                        }),
                                        new docx.TableCell({
                                            children: [accentTableHeaderParagraph('Action')],
                                            shading: accentTableHeaderShading(accentHex),
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

module.exports = { buildDocx, accentHexOrDefault };