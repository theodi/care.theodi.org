const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlaceholder,
  describeHttpFailure,
  checkMongo,
  checkHubspot,
  checkAi,
  checkOauthConfig,
  runConnectionChecks,
} = require('../lib/connectionChecks');

function jsonResponse(status, body, extraHeaders) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: extraHeaders || {},
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

describe('connectionChecks helpers', () => {
  it('treats example placeholders as unset', () => {
    assert.equal(isPlaceholder(''), true);
    assert.equal(isPlaceholder('your_hubspot_key'), true);
    assert.equal(isPlaceholder('sk-live-real'), false);
  });

  it('describes expired and invalid API keys', () => {
    assert.match(
      describeHttpFailure(
        'Anthropic',
        401,
        JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      ),
      /rejected|authentication failed/i
    );
    assert.match(
      describeHttpFailure('HubSpot', 401, JSON.stringify({ message: 'The access token is expired' })),
      /expired/i
    );
    assert.match(describeHttpFailure('OpenAI', 500, JSON.stringify({ error: { message: 'boom' } })), /boom/);
  });
});

describe('checkMongo', () => {
  it('fails when MONGO_URI is missing', async () => {
    const row = await checkMongo({ uri: '', mongoose: {} });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /MONGO_URI/);
  });

  it('fails when URI is a placeholder', async () => {
    const row = await checkMongo({ uri: 'your_mongo_uri', mongoose: {} });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /placeholder/);
  });

  it('pings after connect', async () => {
    const mongoose = {
      async connect() {},
      connection: {
        name: 'care',
        db: {
          admin() {
            return {
              async command() {
                return { ok: 1 };
              },
            };
          },
        },
      },
      async disconnect() {},
    };
    const row = await checkMongo({ uri: 'mongodb://localhost:27017/care', dbName: 'care', mongoose });
    assert.equal(row.status, 'ok');
    assert.match(row.message, /care/);
  });

  it('reports auth failures', async () => {
    const mongoose = {
      async connect() {
        const err = new Error('Authentication failed');
        throw err;
      },
      async disconnect() {},
    };
    const row = await checkMongo({ uri: 'mongodb://user:bad@localhost:27017/care', mongoose });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /authentication failed/i);
  });
});

describe('checkHubspot', () => {
  it('warns when the key is missing', async () => {
    const row = await checkHubspot({ apiKey: '', fetchImpl: async () => jsonResponse(200, {}) });
    assert.equal(row.status, 'warn');
  });

  it('fails on expired tokens', async () => {
    const fetchImpl = async () =>
      jsonResponse(401, { message: 'The access token is expired or invalid' });
    const row = await checkHubspot({ apiKey: 'pat-expired', fetchImpl });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /expired/i);
  });

  it('succeeds with portal id', async () => {
    const fetchImpl = async () => jsonResponse(200, { portalId: 99 });
    const row = await checkHubspot({ apiKey: 'pat-ok', fetchImpl });
    assert.equal(row.status, 'ok');
    assert.match(row.message, /99/);
  });
});

describe('checkAi', () => {
  it('warns when no key is configured', async () => {
    const row = await checkAi({ cfg: { provider: 'anthropic', apiKey: '' } });
    assert.equal(row.status, 'warn');
  });

  it('fails when Anthropic rejects the key', async () => {
    const fetchImpl = async () =>
      jsonResponse(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const row = await checkAi({
      cfg: { provider: 'anthropic', apiKey: 'sk-ant-bad', model: 'claude-3-5-sonnet-20241022' },
      fetchImpl,
    });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /401/);
  });

  it('succeeds when Anthropic lists models', async () => {
    const fetchImpl = async (url, opts) => {
      assert.match(url, /\/v1\/models$/);
      assert.equal(opts.headers['x-api-key'], 'sk-ant-ok');
      return jsonResponse(200, { data: [{ id: 'claude-3-5-sonnet-20241022' }] });
    };
    const row = await checkAi({
      cfg: { provider: 'anthropic', apiKey: 'sk-ant-ok', model: 'claude-3-5-sonnet-20241022' },
      fetchImpl,
    });
    assert.equal(row.status, 'ok');
    assert.match(row.message, /1 models/);
  });

  it('fails when OpenAI key is invalid', async () => {
    const fetchImpl = async () =>
      jsonResponse(401, { error: { message: 'Incorrect API key provided' } });
    const row = await checkAi({
      cfg: { provider: 'openai', apiKey: 'sk-bad', model: 'gpt-4o-mini' },
      fetchImpl,
    });
    assert.equal(row.status, 'fail');
    assert.match(row.message, /rejected|authentication failed/i);
  });
});

describe('checkOauthConfig', () => {
  it('warns when OAuth secrets are missing', () => {
    const rows = checkOauthConfig({});
    assert.equal(rows.find((r) => r.name === 'Google OAuth').status, 'warn');
    assert.equal(rows.find((r) => r.name === 'Django OAuth').status, 'warn');
    assert.equal(rows.find((r) => r.name === 'Session').status, 'warn');
  });

  it('marks configured OAuth as ok without a live login', () => {
    const rows = checkOauthConfig({
      GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      DJANGO_CLIENT_ID: 'django-id',
      DJANGO_CLIENT_SECRET: 'django-secret',
      SESSION_SECRET: 'session-secret',
    });
    assert.ok(rows.every((r) => r.status === 'ok'));
  });
});

describe('runConnectionChecks', () => {
  it('aggregates live failures with oauth warnings', async () => {
    const mongoose = {
      async connect() {},
      connection: {
        name: 'care',
        db: {
          admin() {
            return { async command() { return { ok: 1 }; } };
          },
        },
      },
      async disconnect() {},
    };
    const fetchImpl = async (url) => {
      if (String(url).includes('hubapi.com')) {
        return jsonResponse(401, { message: 'The access token is expired' });
      }
      return jsonResponse(200, { data: [] });
    };
    const out = await runConnectionChecks({
      env: {
        MONGO_URI: 'mongodb://localhost:27017/care',
        MONGO_DB: 'care',
        HUBSPOT_API_KEY: 'pat-expired',
        ANTHROPIC_API_KEY: 'sk-ant-ok',
        AI_PROVIDER: 'anthropic',
      },
      mongoose,
      fetchImpl,
      loadAiConfig: () => ({
        provider: 'anthropic',
        apiKey: 'sk-ant-ok',
        model: 'claude-test',
        anthropicBaseUrl: 'https://api.anthropic.com',
      }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.failed, 1);
    assert.ok(out.warned >= 1);
    assert.equal(out.results.find((r) => r.name === 'HubSpot').status, 'fail');
    assert.equal(out.results.find((r) => r.name.startsWith('AI')).status, 'ok');
  });
});
