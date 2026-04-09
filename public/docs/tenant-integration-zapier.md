# Tenant integrations API — Zapier / Make / n8n

This is a short cookbook for connecting middleware to CARE’s **read-only** tenant API.

## What you need

1. **Tenant ID** — On **Organisation** (organisation admins): shown at the top of the **Integrations API** section. It is also returned as `tenantId` in `GET /organisation` with `Accept: application/json`.
2. **Integration API key** — Create on the same page. You receive the full secret **once**; store it in Zapier/Make as a secret field.
3. **Project ID** — For each evaluation, open **Evaluations** (`/projects`). Under the title, copy **Project ID** (or take `id` from the API list response).

4. **Your project ID (`integrationExternalId`)** — Optional. Organisation admins and users with the **Project manager** role can set **Your project ID** on the organisation evaluations table. When set, the integration API includes `integrationExternalId` on list items, the project snapshot, summary, and each work-item row so you can match CARE to your PM tool without storing only the Mongo id.

## Base URL

Use your real site origin (no trailing slash):

```text
https://YOUR_HOST/organisation/TENANT_ID/api/v1/projects
```

Examples for a single project:

```text
GET https://YOUR_HOST/organisation/TENANT_ID/api/v1/projects/PROJECT_ID
GET https://YOUR_HOST/organisation/TENANT_ID/api/v1/projects/PROJECT_ID/summary
GET https://YOUR_HOST/organisation/TENANT_ID/api/v1/projects/PROJECT_ID/work-items
GET https://YOUR_HOST/organisation/TENANT_ID/api/v1/projects/PROJECT_ID/report
```

**Word report (`/report`):** send header `Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and `Authorization: Bearer …`. Response is a `.docx` download (same as the in-app export). Optional query: `appendGlossary=1`, `includeAiProvenance=1`.

## Required headers

| Header | Value |
|--------|--------|
| `Accept` | `application/json` for JSON endpoints; for **Word report** use `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `Authorization` | `Bearer YOUR_INTEGRATION_KEY` |

If `Accept` does not match the response type, the API responds with **406**.

## Zapier (Custom Request or Webhooks)

1. Method: **GET**
2. URL: as above (replace `TENANT_ID` and `PROJECT_ID` from previous steps or from a prior Zap step).
3. Headers: add **Accept** and **Authorization** as above.

**Polling new/updated evaluations:** use `GET .../projects?limit=25&updatedSince=2025-01-01T00:00:00.000Z` (ISO 8601). Use `nextCursor` from the JSON body for the next page.

## OpenAPI

- **Interactive documentation (human-readable):** `/docs/tenant-integration.html` (renders this spec with Redoc)
- **YAML download:** `/docs/tenant-integration-openapi.yaml`

## Product rules

- The organisation must have an **active** subscription or the API returns **403**.
- Only evaluations **shared with the organisation** are visible through this API.
