/**
 * Multi-provider chat completion for the assistant.
 *
 * Providers:
 * - openai — official API (default when AI_PROVIDER unset and OPENAI_API_KEY is set)
 * - openai_compatible — same wire format as OpenAI chat completions (Groq, LiteLLM, vLLM,
 *   many proxies, and Azure OpenAI when you set base URL + api-version + api-key header)
 * - anthropic — Claude Messages API
 * - google — Gemini generateContent (REST); structured mode uses responseMimeType + responseJsonSchema
 *
 * Per-organisation keys/endpoints can later override these env defaults in the route layer.
 */

const OpenAI = require('openai');
const { prepareStructuredSchemas } = require('./structuredOutputSchema');

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_STRUCTURED_TOOL_DESCRIPTION =
  'Return the full response as structured JSON. Use this tool with arguments that match the schema; do not reply with plain text.';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_GOOGLE_MODEL = 'gemini-1.5-flash';

function normalizeProvider(raw) {
  if (!raw || String(raw).trim() === '') {
    return null;
  }
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

function loadConfig() {
  const explicit = normalizeProvider(process.env.AI_PROVIDER);
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY;

  let provider = explicit;
  if (!provider) {
    if (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) {
      provider = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL
        ? 'openai_compatible'
        : 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      provider = 'anthropic';
    } else if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      provider = 'google';
    } else {
      provider = 'openai';
    }
  }

  const model =
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    (provider === 'anthropic'
      ? DEFAULT_ANTHROPIC_MODEL
      : provider === 'google' || provider === 'gemini'
        ? DEFAULT_GOOGLE_MODEL
        : DEFAULT_OPENAI_MODEL);

  const baseURL =
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    undefined;

  const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '24000', 10);
  const anthropicThinkingBudget = parseInt(
    process.env.AI_ANTHROPIC_THINKING_BUDGET || '10000',
    10
  );

  return {
    provider,
    apiKey,
    model,
    baseURL,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 8192,
    openaiApiVersion: process.env.AI_OPENAI_API_VERSION || process.env.AZURE_OPENAI_API_VERSION,
    useApiKeyHeader:
      process.env.AI_OPENAI_USE_API_KEY_HEADER === 'true' ||
      process.env.AZURE_OPENAI === 'true',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    googleBaseUrl:
      process.env.GOOGLE_AI_BASE_URL || 'https://generativelanguage.googleapis.com',
    /** Newer OpenAI models reject max_tokens; use max_completion_tokens unless legacy is set */
    openaiUseLegacyMaxTokens: process.env.AI_OPENAI_LEGACY_MAX_TOKENS === 'true',
    /** Skip json_schema / Anthropic tools and use plain completion + markdown JSON parse */
    disableStructuredOutput: process.env.AI_DISABLE_STRUCTURED_OUTPUT === 'true',
    anthropicThinkingBudget: Number.isFinite(anthropicThinkingBudget)
      ? Math.max(1024, anthropicThinkingBudget)
      : 10000,
  };
}

function assertKey(cfg) {
  if (!cfg.apiKey) {
    throw new Error(
      'No API key configured. Set AI_API_KEY or a provider-specific key (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY).'
    );
  }
}

/**
 * @param {Array<{ role: string, content: string }>} messages OpenAI-style messages
 * @param {Partial<ReturnType<typeof loadConfig>> & {
 *   structuredResponse?: { schemaName: string, rawSchema: object }
 * }} [runtimeOverrides] Optional overrides; structuredResponse enables OpenAI json_schema, Anthropic tools, or Gemini responseJsonSchema + markdown fallback on failure
 * @returns {Promise<string>} Model output (JSON string when structured path succeeds)
 */
async function chatCompletion(messages, runtimeOverrides = {}) {
  const cfg = { ...loadConfig(), ...runtimeOverrides };
  assertKey(cfg);

  const structured = cfg.structuredResponse;
  const canStructure =
    structured &&
    structured.rawSchema &&
    typeof structured.rawSchema === 'object' &&
    !cfg.disableStructuredOutput;

  if (canStructure) {
    const schemaName =
      structured.schemaName && /^[a-zA-Z0-9_-]+$/.test(structured.schemaName)
        ? structured.schemaName
        : 'care_structured_response';
    const prepared = prepareStructuredSchemas(structured.rawSchema);

    if (cfg.provider === 'openai' || cfg.provider === 'openai_compatible' || cfg.provider === 'azure_openai' || cfg.provider === 'azure') {
      try {
        return await openaiStructuredChat(messages, cfg, prepared.openai, schemaName);
      } catch (e) {
        console.warn('[aiChat] OpenAI structured output failed, using plain completion + JSON parse:', e.message || e);
        return openaiCompatibleChat(messages, cfg);
      }
    }

    if (cfg.provider === 'anthropic') {
      try {
        return await anthropicStructuredChat(messages, cfg, prepared.anthropic, schemaName);
      } catch (e) {
        console.warn('[aiChat] Anthropic tool use failed, using plain completion + JSON parse:', e.message || e);
        return anthropicChat(messages, cfg);
      }
    }

    if (cfg.provider === 'google' || cfg.provider === 'gemini') {
      try {
        return await googleGeminiStructuredChat(messages, cfg, prepared.anthropic);
      } catch (e) {
        console.warn('[aiChat] Gemini structured output failed, using plain completion + JSON parse:', e.message || e);
        return googleGeminiChat(messages, cfg);
      }
    }
  }

  switch (cfg.provider) {
    case 'openai':
      return openaiCompatibleChat(messages, {
        ...cfg,
        baseURL: cfg.baseURL,
      });
    case 'openai_compatible':
    case 'azure_openai':
    case 'azure':
      return openaiCompatibleChat(messages, cfg);
    case 'anthropic':
      return anthropicChat(messages, cfg);
    case 'google':
    case 'gemini':
      return googleGeminiChat(messages, cfg);
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${process.env.AI_PROVIDER}". Use: openai | openai_compatible | anthropic | google`
      );
  }
}

function buildOpenAIClient(cfg) {
  const clientOptions = {
    apiKey: cfg.apiKey,
  };
  if (cfg.baseURL) {
    clientOptions.baseURL = cfg.baseURL.replace(/\/$/, '');
  }
  if (cfg.openaiApiVersion) {
    clientOptions.defaultQuery = { 'api-version': cfg.openaiApiVersion };
  }
  if (cfg.useApiKeyHeader) {
    clientOptions.defaultHeaders = { 'api-key': cfg.apiKey };
  }
  return new OpenAI(clientOptions);
}

async function openaiStructuredChat(messages, cfg, jsonSchema, schemaName) {
  const client = buildOpenAIClient(cfg);
  const requestBody = {
    model: cfg.model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema: jsonSchema,
      },
    },
  };
  if (cfg.openaiUseLegacyMaxTokens) {
    requestBody.max_tokens = cfg.maxTokens;
  } else {
    requestBody.max_completion_tokens = cfg.maxTokens;
  }
  const completion = await client.chat.completions.create(requestBody);
  const msg = completion.choices[0]?.message;
  if (!msg) {
    throw new Error('OpenAI structured: no message');
  }
  if (msg.refusal) {
    throw new Error(`OpenAI refusal: ${msg.refusal}`);
  }
  const text = msg.content;
  if (text == null || text === '') {
    throw new Error('OpenAI structured: empty content');
  }
  return typeof text === 'string' ? text : JSON.stringify(text);
}

async function openaiCompatibleChat(messages, cfg) {
  const client = buildOpenAIClient(cfg);
  const requestBody = {
    model: cfg.model,
    messages,
  };
  if (cfg.openaiUseLegacyMaxTokens) {
    requestBody.max_tokens = cfg.maxTokens;
  } else {
    requestBody.max_completion_tokens = cfg.maxTokens;
  }
  const completion = await client.chat.completions.create(requestBody);
  const text = completion.choices[0]?.message?.content;
  if (text == null) {
    throw new Error('OpenAI-compatible API returned no message content');
  }
  return text;
}

async function anthropicStructuredChat(messages, cfg, inputSchema, toolName) {
  const url = `${cfg.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`;
  const anthropicMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  if (anthropicMessages.length === 0) {
    throw new Error('Anthropic requires at least one user or assistant message');
  }

  const streamObserver = typeof cfg.streamObserver === 'function' ? cfg.streamObserver : null;
  const requestBody = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: anthropicMessages,
    tools: [
      {
        name: toolName,
        description: DEFAULT_STRUCTURED_TOOL_DESCRIPTION,
        input_schema: inputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: toolName },
  };
  if (streamObserver) {
    requestBody.stream = true;
    requestBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.max(
        1024,
        Math.min(cfg.anthropicThinkingBudget || 10000, Math.max(1024, cfg.maxTokens - 1))
      ),
    };
    // Extended thinking is not compatible with forced tool choice.
    requestBody.tool_choice = { type: 'auto' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (streamObserver) {
    return anthropicParseStreamResponse(res, streamObserver);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.message || res.statusText;
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }

  const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
  if (toolUse && toolUse.input != null) {
    return JSON.stringify(toolUse.input);
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (textBlock?.text) {
    return textBlock.text;
  }

  throw new Error('Anthropic structured: no tool_use or text in response');
}

async function anthropicChat(messages, cfg) {
  const url = `${cfg.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`;
  const anthropicMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  if (anthropicMessages.length === 0) {
    throw new Error('Anthropic requires at least one user or assistant message');
  }

  const streamObserver = typeof cfg.streamObserver === 'function' ? cfg.streamObserver : null;
  const requestBody = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: anthropicMessages,
  };
  if (streamObserver) {
    requestBody.stream = true;
    requestBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.max(
        1024,
        Math.min(cfg.anthropicThinkingBudget || 10000, Math.max(1024, cfg.maxTokens - 1))
      ),
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (streamObserver) {
    return anthropicParseStreamResponse(res, streamObserver);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.message || res.statusText;
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }

  const block = (data.content || []).find((b) => b.type === 'text');
  const text = block?.text;
  if (text == null) {
    throw new Error('Anthropic returned no text content');
  }
  return text;
}

async function anthropicParseStreamResponse(res, streamObserver) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || data.message || res.statusText;
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }
  if (!res.body) {
    throw new Error('Anthropic stream: missing response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let textOut = '';
  let toolInput = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const event = parseSseEvent(rawEvent);
      if (!event || !event.data) continue;
      if (event.data === '[DONE]') continue;

      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }
      const t = payload && payload.type;
      if (t === 'content_block_delta') {
        const d = payload.delta || {};
        if (typeof d.text === 'string' && d.text) {
          textOut += d.text;
          streamObserver({ type: 'text_delta', text: d.text });
        }
        // Anthropic thinking deltas may vary by shape; handle common variants.
        if (d.type === 'thinking_delta' && typeof d.thinking === 'string' && d.thinking) {
          streamObserver({ type: 'thinking_delta', text: d.thinking });
        } else if (typeof d.thinking === 'string' && d.thinking) {
          streamObserver({ type: 'thinking_delta', text: d.thinking });
        } else if (d.type === 'thinking_delta' && typeof d.text === 'string' && d.text) {
          streamObserver({ type: 'thinking_delta', text: d.text });
        }
        if (typeof d.partial_json === 'string') {
          streamObserver({ type: 'tool_json_delta', text: d.partial_json });
        }
      } else if (t === 'content_block_stop') {
        const b = payload.content_block || {};
        if (b.type === 'tool_use' && b.input != null) {
          toolInput = b.input;
        }
      } else if (t === 'message_delta') {
        const stopReason = payload.delta && payload.delta.stop_reason;
        if (stopReason) {
          streamObserver({ type: 'stop', stopReason });
        }
      }
    }
  }

  if (toolInput != null) {
    return JSON.stringify(toolInput);
  }
  if (textOut) return textOut;
  throw new Error('Anthropic stream: no tool_use or text output');
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.split('\n');
  let eventType = '';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  return {
    event: eventType,
    data: dataLines.join('\n'),
  };
}

function geminiUserText(messages) {
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');
  return userText;
}

function geminiGenerateContentUrl(cfg) {
  const modelId = cfg.model.startsWith('models/')
    ? cfg.model.replace(/^models\//, '')
    : cfg.model;
  const base = cfg.googleBaseUrl.replace(/\/$/, '');
  return `${base}/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
}

/**
 * Gemini structured outputs: JSON matching responseJsonSchema (see Google AI docs).
 * Uses the metadata-stripped schema (not OpenAI strict) for broader Gemini compatibility.
 */
async function googleGeminiStructuredChat(messages, cfg, responseJsonSchema) {
  const userText = geminiUserText(messages);
  if (!userText) {
    throw new Error('Gemini adapter needs at least one user message');
  }

  const url = geminiGenerateContentUrl(cfg);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: cfg.maxTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: responseJsonSchema,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.message || res.statusText;
    throw new Error(`Google Gemini API error (${res.status}): ${msg}`);
  }

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) {
    throw new Error('Gemini structured: no text content');
  }
  return text;
}

async function googleGeminiChat(messages, cfg) {
  const userText = geminiUserText(messages);

  if (!userText) {
    throw new Error('Gemini adapter needs at least one user message');
  }

  const url = geminiGenerateContentUrl(cfg);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: cfg.maxTokens,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.message || res.statusText;
    throw new Error(`Google Gemini API error (${res.status}): ${msg}`);
  }

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) {
    throw new Error('Gemini returned no text content');
  }
  return text;
}

module.exports = {
  chatCompletion,
  loadConfig,
};
