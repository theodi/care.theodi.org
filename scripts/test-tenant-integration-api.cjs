#!/usr/bin/env node
/**
 * Exercise the tenant integrations API against a live server: list projects,
 * prefer one with completionStatus "done", then call project / summary /
 * work-items / report (docx) and write responses to disk for human review.
 *
 * Requires Node 18+ (global fetch).
 *
 * Usage:
 *   node scripts/test-tenant-integration-api.cjs --tenant TENANT_OBJECT_ID --key careti_...
 *   node scripts/test-tenant-integration-api.cjs --tenant ... --key ... --base https://care.example.com
 *   node scripts/test-tenant-integration-api.cjs --tenant ... --key ... --out ./my-smoke-run
 *
 * Env (optional): TENANT_INTEGRATION_TEST_BASE_URL, TENANT_INTEGRATION_TEST_TENANT_ID,
 *                 TENANT_INTEGRATION_TEST_KEY
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const configEnvPath = path.join(root, 'config.env');
const dotenvPath = path.join(root, '.env');

if (fs.existsSync(configEnvPath)) {
  require('dotenv').config({ path: configEnvPath });
}
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const JSON_ACCEPT = 'application/json';
const DOCX_ACCEPT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function parseArgs(argv) {
  let tenantId =
    process.env.TENANT_INTEGRATION_TEST_TENANT_ID || process.env.TENANT_ID || '';
  let apiKey =
    process.env.TENANT_INTEGRATION_TEST_KEY || process.env.TENANT_INTEGRATION_API_KEY || '';
  let baseUrl =
    process.env.TENANT_INTEGRATION_TEST_BASE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_ORIGIN ||
    'http://127.0.0.1:3000';
  let outDir = '';
  let listLimit = 100;
  let summaryConcurrency = 10;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v != null && !v.startsWith('-')) {
        i += 1;
        return v;
      }
      return '';
    };
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--tenant') tenantId = next() || tenantId;
    else if (a.startsWith('--tenant=')) tenantId = a.slice('--tenant='.length);
    else if (a === '--key') apiKey = next() || apiKey;
    else if (a.startsWith('--key=')) apiKey = a.slice('--key='.length);
    else if (a === '--base') baseUrl = next() || baseUrl;
    else if (a.startsWith('--base=')) baseUrl = a.slice('--base='.length);
    else if (a === '--out') outDir = next() || outDir;
    else if (a.startsWith('--out=')) outDir = a.slice('--out='.length);
    else if (a.startsWith('--list-limit='))
      listLimit = Math.min(100, Math.max(1, parseInt(a.slice('--list-limit='.length), 10) || 100));
    else if (a === '--list-limit') {
      const v = next();
      if (v) listLimit = Math.min(100, Math.max(1, parseInt(v, 10) || 100));
    } else if (a.startsWith('--summary-concurrency='))
      summaryConcurrency = Math.min(
        20,
        Math.max(1, parseInt(a.slice('--summary-concurrency='.length), 10) || 10)
      );
    else if (a === '--summary-concurrency') {
      const v = next();
      if (v) summaryConcurrency = Math.min(20, Math.max(1, parseInt(v, 10) || 10));
    }
  }

  return { tenantId, apiKey, baseUrl, outDir, listLimit, summaryConcurrency, help };
}

function normalizeBaseUrl(s) {
  return String(s || '').replace(/\/$/, '');
}

function apiPath(base, tenantId, suffix) {
  return `${base}/organisation/${tenantId}/api/v1/projects${suffix}`;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _parseError: true, raw: text };
  }
  return { ok: res.ok, status: res.status, headers: res.headers, body, text };
}

async function fetchAllProjectIds(base, tenantId, apiKey, limit) {
  const ids = [];
  let cursor = null;
  for (;;) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    const url = `${apiPath(base, tenantId, '')}?${q}`;
    console.log('Fetching projects from:', url);
    const { ok, status, body } = await fetchJson(url, {
      Accept: JSON_ACCEPT,
      Authorization: `Bearer ${apiKey}`,
    });
    if (!ok) {
      const err = new Error(`List projects failed: HTTP ${status} ${JSON.stringify(body)}`);
      err.status = status;
      err.body = body;
      throw err;
    }
    const data = body && body.data;
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected list response: ${JSON.stringify(body)}`);
    }
    for (const row of data) {
      if (row && row.id) ids.push(row);
    }
    cursor = body.nextCursor || null;
    if (!cursor || data.length === 0) break;
  }
  return ids;
}

function completionRank(status) {
  if (status === 'done') return 3;
  if (status === 'inProgress') return 2;
  if (status === 'todo') return 1;
  return 0;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function fetchSummary(base, tenantId, apiKey, projectId) {
  const url = apiPath(base, tenantId, `/${encodeURIComponent(projectId)}/summary`);
  return fetchJson(url, {
    Accept: JSON_ACCEPT,
    Authorization: `Bearer ${apiKey}`,
  });
}

async function pickProject(listRows, base, tenantId, apiKey, concurrency) {
  const summaries = await mapPool(listRows, concurrency, async (row) => {
    const { ok, status, body } = await fetchSummary(base, tenantId, apiKey, row.id);
    return {
      listRow: row,
      summaryOk: ok,
      summaryStatus: status,
      summary: body,
      completionStatus: ok && body ? body.completionStatus : null,
    };
  });

  const scored = summaries.map((s) => ({
    ...s,
    rank: completionRank(s.completionStatus),
    lastModified: s.listRow.lastModified || '',
  }));

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return String(b.lastModified).localeCompare(String(a.lastModified));
  });

  const chosen = scored[0];
  if (!chosen || !chosen.listRow) {
    throw new Error('No project candidates');
  }
  return { chosen, scored };
}

function writeJson(dir, name, value) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/test-tenant-integration-api.cjs --tenant <24-char hex id> --key <careti_...>

Options:
  --base=<url>     Site origin (default: TENANT_INTEGRATION_TEST_BASE_URL or PUBLIC_SITE_URL or http://127.0.0.1:3000)
  --out=<dir>      Output directory (default: tmp/tenant-integration-api-smoke/<timestamp>)
  --list-limit=100 Page size when listing (max 100)
  --summary-concurrency=10   Parallel summary requests when ranking projects

Env: TENANT_INTEGRATION_TEST_TENANT_ID, TENANT_INTEGRATION_TEST_KEY, TENANT_INTEGRATION_TEST_BASE_URL
`);
    process.exit(0);
  }

  const tenantId = args.tenantId.trim();
  const apiKey = args.apiKey.trim();
  const base = normalizeBaseUrl(args.baseUrl);

  if (!/^[a-fA-F0-9]{24}$/.test(tenantId)) {
    console.error('Missing or invalid --tenant (24-char hex Mongo id).');
    process.exit(1);
  }
  if (!apiKey.startsWith('careti_')) {
    console.error('Missing or invalid --key (expected careti_… integration key).');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.outDir
    ? path.resolve(process.cwd(), args.outDir)
    : path.join(root, 'tmp', 'tenant-integration-api-smoke', stamp);

  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Base: ${base}`);
  console.log(`Output: ${outDir}`);

  const meta = {
    baseUrl: base,
    tenantId,
    startedAt: new Date().toISOString(),
    listLimit: args.listLimit,
  };
  writeJson(outDir, 'run-meta.json', meta);

  console.log('Listing projects…');
  const listRows = await fetchAllProjectIds(base, tenantId, apiKey, args.listLimit);
  writeJson(outDir, 'projects-list.json', { count: listRows.length, data: listRows });

  if (listRows.length === 0) {
    console.error('No shared projects visible for this tenant.');
    process.exit(2);
  }

  console.log(`Ranking ${listRows.length} project(s) by summary completion…`);
  const { chosen, scored } = await pickProject(
    listRows,
    base,
    tenantId,
    apiKey,
    args.summaryConcurrency
  );
  writeJson(outDir, 'project-ranking.json', {
    chosenId: chosen.listRow.id,
    chosenTitle: chosen.listRow.title,
    chosenCompletionStatus: chosen.completionStatus,
    candidates: scored.map((s) => ({
      id: s.listRow.id,
      title: s.listRow.title,
      summaryOk: s.summaryOk,
      summaryStatus: s.summaryStatus,
      completionStatus: s.completionStatus,
      lastModified: s.listRow.lastModified,
    })),
  });

  const projectId = chosen.listRow.id;
  console.log(
    `Selected project ${projectId} (${chosen.listRow.title || 'untitled'}) completion=${chosen.completionStatus}`
  );

  const auth = { Authorization: `Bearer ${apiKey}` };

  console.log('GET project…');
  const projectRes = await fetchJson(apiPath(base, tenantId, `/${encodeURIComponent(projectId)}`), {
    Accept: JSON_ACCEPT,
    ...auth,
  });
  writeJson(outDir, 'project-get.json', {
    status: projectRes.status,
    ok: projectRes.ok,
    body: projectRes.body,
  });
  if (!projectRes.ok) {
    console.error('Project GET failed:', projectRes.status, projectRes.text);
    process.exit(1);
  }

  console.log('GET summary…');
  const summaryRes = await fetchJson(
    apiPath(base, tenantId, `/${encodeURIComponent(projectId)}/summary`),
    { Accept: JSON_ACCEPT, ...auth }
  );
  writeJson(outDir, 'project-summary.json', {
    status: summaryRes.status,
    ok: summaryRes.ok,
    body: summaryRes.body,
  });
  if (!summaryRes.ok) {
    console.error('Summary GET failed:', summaryRes.status, summaryRes.text);
    process.exit(1);
  }

  console.log('GET work-items…');
  const workRes = await fetchJson(
    apiPath(base, tenantId, `/${encodeURIComponent(projectId)}/work-items`),
    { Accept: JSON_ACCEPT, ...auth }
  );
  writeJson(outDir, 'project-work-items.json', {
    status: workRes.status,
    ok: workRes.ok,
    body: workRes.body,
  });
  if (!workRes.ok) {
    console.error('Work-items GET failed:', workRes.status, workRes.text);
    process.exit(1);
  }

  console.log('GET report (docx)…');
  const reportUrl = `${apiPath(base, tenantId, `/${encodeURIComponent(projectId)}/report`)}?appendGlossary=1`;
  const docxRes = await fetch(reportUrl, {
    headers: { Accept: DOCX_ACCEPT, ...auth },
  });
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  const docxPath = path.join(outDir, 'project-report.docx');
  fs.writeFileSync(docxPath, docxBuf);
  const cd = docxRes.headers.get('content-disposition') || '';
  writeJson(outDir, 'project-report-docx-meta.json', {
    status: docxRes.status,
    ok: docxRes.ok,
    contentType: docxRes.headers.get('content-type'),
    contentDisposition: cd,
    bytes: docxBuf.length,
    path: 'project-report.docx',
  });
  if (!docxRes.ok) {
    console.error('DOCX GET failed:', docxRes.status);
    try {
      console.error(docxBuf.toString('utf8'));
    } catch (_) {
      /* binary */
    }
    process.exit(1);
  }

  console.log('GET report with wrong Accept (expect 406)…');
  const badAcceptRes = await fetchJson(
    apiPath(base, tenantId, `/${encodeURIComponent(projectId)}/report`),
    { Accept: JSON_ACCEPT, ...auth }
  );
  writeJson(outDir, 'report-wrong-accept.json', {
    status: badAcceptRes.status,
    body: badAcceptRes.body,
  });
  if (badAcceptRes.status !== 406) {
    console.warn(`Expected 406 for wrong Accept on /report, got ${badAcceptRes.status}`);
  }

  const finished = {
    ...meta,
    finishedAt: new Date().toISOString(),
    projectId,
    outputDir: outDir,
    files: [
      'run-meta.json',
      'projects-list.json',
      'project-ranking.json',
      'project-get.json',
      'project-summary.json',
      'project-work-items.json',
      'project-report.docx',
      'project-report-docx-meta.json',
      'report-wrong-accept.json',
    ],
  };
  writeJson(outDir, 'index.json', finished);

  console.log('Done. Open project-report.docx and JSON files in:', outDir);
  console.log(pathToFileURL(path.join(outDir, 'project-report.docx')).href);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
