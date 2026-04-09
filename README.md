# ODI CARE Tool

CARE helps teams think through the real-world impact of a product, service, or data project before problems appear. It gives you a clear way to spot risks early, plan actions, and export useful outputs for governance and delivery teams.

## What CARE is

CARE is a guided workflow for:

- capturing project and context details
- identifying intended and unintended consequences
- evaluating risk and likelihood
- defining mitigation actions and KPIs
- producing outputs you can use in governance, assurance, and planning

You can use CARE as an individual, or as part of a larger organisation with shared controls for AI, report templates, permissions, and integrations.

## v3.0.0 Feature Changelog

This release adds major organisation features and a stronger integrations API, while also improving the day-to-day scanning experience for all users.

### Enterprise and organisation management

- Customer organisations get a shared workspace to manage licensed users, seat usage, and active participation in one place.
- Teams can add and remove licensed users and keep seat allocation aligned with current delivery needs.
- Organisation admins can assign scoped permissions so people get access based on their role:
  - license manager
  - AI model admin
  - prompt manager
  - report manager
  - project manager
- Built-in role protections help reduce accidental changes to important organisation settings.

Example use:
- If your policy team owns report templates, your data team owns AI setup, and your PM team owns project references, each group can get the access they need without everyone becoming a full admin.
- Benefit: better governance and fewer accidental changes.

### Organisation AI controls

- Policy-led bring-your-own AI so an organisation can use its approved provider, bespoke internal model, or managed AI service as the default for licensed users.
- Provider support for OpenAI, OpenAI-compatible endpoints, Anthropic, Google Gemini, and Azure OpenAI-compatible setups.
- Where supported by the chosen provider, organisations can enable in-flight reasoning and set the reasoning level.
- During AI-assisted scans, users can view the model's live reasoning when this feature is enabled.
- In-app AI configuration testing:
  - test saved settings
  - test unsaved form values before committing changes
- Additional model behaviour options, including token limits and structured output controls.

Example use:
- If your organisation policy says teams must use an internal AI gateway or a specific approved model, admins can configure that once and make it the default for all licensed users.
- Benefit: aligned with your governance policy, with consistent AI behaviour, faster onboarding, and fewer configuration errors.

### Prompt customisation by scan stage

- Organisations can tailor the AI prompts used in each scan stage.
- Prompt customisation can be managed globally, so every licensed user benefits from the same organisation-level setup.
- Stage coverage visibility helps teams see where prompt customisation exists and where gaps remain.
- Managed editing workflow supports creating, updating, and removing scan-stage prompt customisations.

Example use:
- An organisation can include key elements from internal governance documents and ethical frameworks in specific scan stages, so AI responses are guided in the right direction for that context.
- Benefit: stronger consistency with organisational governance and values across all scans.

### Customisable reports for all users

- Users can choose what to include in report exports.
- Reports can include the tool glossary when needed.
- Where AI is used, this is explicitly marked in the report.
- Users can choose to include the full AI conversation history, which is now recorded for provenance:
  - every prompt
  - in-flight reasoning (where enabled)
  - every AI response
  - the AI configuration used
- This gives teams a transparent audit trail from AI input to AI output.

Example use:
- A team preparing for governance review can export a report that includes the glossary, AI usage disclosure, and full AI history to show exactly how conclusions were generated.
- Benefit: full transparency and stronger assurance evidence.

### Organisation report templates (new in v3.0.0)

- Organisation admins and report managers can upload a custom Word template (`.docx`) for branded exports.
- Validation checks required CARE placeholders before a template is accepted.
- Lifecycle controls allow teams to upload, replace, or remove custom templates.
- Users still choose what content to include in each report; organisations control the template format and branding.

Example use:
- Upload your organisation's branded template once, then let project teams export reports in a consistent format while choosing the sections they need for each audience.
- Benefit: standard presentation plus flexible, context-specific reporting.

### Integrations API for organisations

- A secure, read-only API gives access to evaluations that are shared with the organisation.
- This makes it easier to connect CARE into internal reporting, dashboards, and workflow tools without manual copy and paste.
- Teams can pull project lists, project summaries, normalised work items, and the same Word report export used in the app.
- Developer support is built in:
  - a human-readable integration guide
  - interactive API documentation generated from OpenAPI
  - an OpenAPI contract for codegen and tooling
  - a practical automation cookbook for Zapier, Make, and n8n

Example use:
- A developer can connect CARE to a programme dashboard so governance teams can monitor progress, risks, and actions across evaluations in near real time.
- Benefit: faster insight, less admin overhead, and clearer visibility across programmes.

### Improvements for all users

- Tidier scan interface for a cleaner, easier workflow.
- Multi-stage AI for the all-in-one scan flow.
- General UX and reliability improvements across scanning and management screens.

Example use:
- New users can run a complete scan with less friction, while experienced users can move faster through each stage.
- Benefit: better completion rates and clearer outputs from the same process.

## Quick Start

Installation and setup documentation is now in [`INSTALLING.md`](INSTALLING.md).

For local development after setup:

1. Start the app with `npm start`.
2. Open `http://localhost:3080`.
3. Sign in and create or open an evaluation.

## Contributing

Contributions are welcome via issues and pull requests.

## License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md).
