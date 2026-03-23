#!/usr/bin/env node
/**
 * Smoke-test the configured AI provider from the command line.
 * Uses the same env as the app (config.env in project root).
 *
 * Steps (default: both):
 *   1 — Plain chat completion (no schema / tools)
 *   2 — Structured output (OpenAI json_schema, Anthropic tool use, or Gemini responseJsonSchema), with markdown fallback inside chatCompletion
 *
 * Usage:
 *   npm run test-ai
 *   npm run test-ai -- "Your prompt for step 1"
 *   npm run test-ai -- --simple-only
 *   npm run test-ai -- --structured-only
 */

const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const configEnvPath = path.join(root, 'config.env');
const dotenvPath = path.join(root, '.env');

if (fs.existsSync(configEnvPath)) {
  require('dotenv').config({ path: configEnvPath });
}
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const { chatCompletion, loadConfig } = require('../services/aiChat');
const { parseModelJsonResponse } = require('../services/parseAIJson');

const defaultPrompt =
  'Reply with a single short sentence confirming you received this test message. No preamble.';

/** Minimal schema for step 2 — same pipeline as assistant routes (prepareStructuredSchemas). */
const SMOKE_STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    ok: { type: 'boolean' },
  },
};

const step2UserPrompt =
  'Set ok to true. In reply, write exactly: Structured output test passed.';

function parseArgs(argv) {
  let simpleOnly = false;
  let structuredOnly = false;
  const rest = [];
  for (const a of argv) {
    if (a === '--simple-only' || a === '-1') {
      simpleOnly = true;
    } else if (a === '--structured-only' || a === '-2') {
      structuredOnly = true;
    } else {
      rest.push(a);
    }
  }
  if (simpleOnly && structuredOnly) {
    console.error('Use only one of --simple-only and --structured-only');
    process.exit(1);
  }
  return { simpleOnly, structuredOnly, rest };
}

function structuredStepLabel(provider) {
  if (provider === 'anthropic') {
    return 'structured (Anthropic tool use)';
  }
  if (provider === 'openai' || provider === 'openai_compatible' || provider === 'azure_openai' || provider === 'azure') {
    return 'structured (OpenAI json_schema)';
  }
  if (provider === 'google' || provider === 'gemini') {
    return 'structured (Gemini responseJsonSchema + application/json)';
  }
  return 'structured';
}

async function runStep1(prompt) {
  console.log('\n=== Step 1: plain completion ===\n');
  const reply = await chatCompletion([{ role: 'user', content: prompt }]);
  console.log(reply);
  console.log('\nStep 1 OK (%d chars)\n', reply.length);
}

async function runStep2(cfg) {
  if (cfg.disableStructuredOutput) {
    console.log('\n=== Step 2 skipped ===');
    console.log('AI_DISABLE_STRUCTURED_OUTPUT=true — unset it to test OpenAI json_schema / Anthropic tool use.\n');
    return;
  }

  console.log('\n=== Step 2: %s ===\n', structuredStepLabel(cfg.provider));

  const raw = await chatCompletion([{ role: 'user', content: step2UserPrompt }], {
    structuredResponse: {
      schemaName: 'care_test_smoke',
      rawSchema: JSON.parse(JSON.stringify(SMOKE_STRUCTURE_SCHEMA)),
    },
  });

  console.log('Raw response:\n', raw.slice(0, 500) + (raw.length > 500 ? '…' : ''), '\n');

  let parsed;
  try {
    parsed = parseModelJsonResponse(raw);
  } catch (e) {
    console.error('Step 2: JSON parse failed:', e.message);
    throw e;
  }

  console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));

  if (typeof parsed.ok !== 'boolean') {
    console.warn('Step 2 warning: expected boolean "ok" in parsed object');
  } else if (!parsed.ok) {
    console.warn('Step 2 warning: ok is not true');
  } else {
    console.log('Step 2: ok === true');
  }

  if (typeof parsed.reply === 'string' && parsed.reply.includes('Structured output test passed')) {
    console.log('Step 2 OK (reply matches expected phrase)\n');
  } else if (typeof parsed.reply === 'string') {
    console.warn('Step 2 warning: reply did not contain expected phrase (model may have paraphrased)\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '-h' || args[0] === '--help') {
    console.log(`Usage: node scripts/test-ai.js [options] [prompt for step 1...]

Options:
  --simple-only, -1     Only step 1 (plain completion)
  --structured-only, -2 Only step 2 (structured / tool use + JSON parse)

Default: run step 1 then step 2.

Environment: AI_PROVIDER, keys, model, etc. (see config.env.example).
Step 2 uses OpenAI json_schema, Anthropic forced tool, or Gemini JSON schema when supported; otherwise falls back like production.

Examples:
  npm run test-ai
  npm run test-ai -- "What is 2+2?"
  npm run test-ai -- --structured-only`);
    process.exit(0);
  }

  const { simpleOnly, structuredOnly, rest } = parseArgs(args);
  const prompt = rest.length > 0 ? rest.join(' ') : defaultPrompt;
  const cfg = loadConfig();

  console.log('AI test');
  console.log('  provider:', cfg.provider);
  console.log('  model:   ', cfg.model);
  console.log('  baseURL: ', cfg.baseURL || '(default)');
  if (!simpleOnly) {
    console.log('  step 2:  ', structuredStepLabel(cfg.provider));
  }
  if (!structuredOnly) {
    console.log('  step 1 prompt:', prompt.slice(0, 120) + (prompt.length > 120 ? '…' : ''));
  }

  if (!structuredOnly) {
    await runStep1(prompt);
  }

  if (!simpleOnly) {
    if (structuredOnly && cfg.disableStructuredOutput) {
      console.error('Nothing to run: --structured-only but AI_DISABLE_STRUCTURED_OUTPUT=true');
      process.exit(1);
    }
    await runStep2(cfg);
  }

  console.log('All requested steps finished.');
}

main().catch((err) => {
  console.error('AI test failed:', err.message || err);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
});
