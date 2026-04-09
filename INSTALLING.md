# Installing CARE

This guide covers local installation and setup for the CARE Tool.

## Prerequisites

- Node.js
- MongoDB
- OAuth credentials for Google and Django
- OpenAI API key (or other provider keys you intend to use)

## Dependencies and services

The app depends on:

- Express.js
- Passport.js
- Mongoose
- configured OAuth providers
- configured AI provider credentials
- MongoDB for users, tokens, organisations, and project data

Install package dependencies with:

```bash
npm install
```

## Setup

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Create `config.env` in the project root using `config.env.example`.
4. Fill in required environment variables, including:
   - database connection settings
   - OAuth credentials
   - AI provider/API credentials
   - HubSpot key (if used)
   - free project limit and other deployment-specific settings
5. Start the app with `npm start`.
6. Open `http://localhost:3080`.

## Local accounts for demos/testing

CARE supports local test accounts for demonstrations:

- A shared local password can be reset from the admin flow.
- Resetting removes existing local test accounts and associated projects.
- A scheduled cleanup removes local test accounts daily.

## Notes for enterprise setup

If you are deploying for organisational subscriptions, ensure:

- organisation subscription and seat configuration is enabled
- tenant integration API access is configured
- report template upload capability is available (for branded exports)
- any organisation-level AI provider requirements are documented for admins
