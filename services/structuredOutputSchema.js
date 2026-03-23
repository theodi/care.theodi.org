/**
 * Normalise jsonform-style JSON Schemas for LLM structured outputs.
 */

function cloneStripMetadata(node) {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(cloneStripMetadata);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === 'title') {
      continue;
    }
    out[k] = cloneStripMetadata(v);
  }
  return out;
}

/**
 * OpenAI structured outputs (strict json_schema) require every object to list
 * every key in `required` and set additionalProperties: false.
 */
function openAIStrictify(node) {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(openAIStrictify);
  }
  const out = { ...node };
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const keys = Object.keys(out.properties);
    out.properties = Object.fromEntries(
      keys.map((key) => [key, openAIStrictify(out.properties[key])])
    );
    out.required = keys;
    out.additionalProperties = false;
  }
  if (out.type === 'array' && out.items) {
    out.items = openAIStrictify(out.items);
  }
  return out;
}

/**
 * @param {object} rawSchema — e.g. required partial JSON from disk
 * @returns {{ openai: object, anthropic: object }}
 */
function prepareStructuredSchemas(rawSchema) {
  const stripped = cloneStripMetadata(rawSchema);
  const copy = JSON.parse(JSON.stringify(stripped));
  return {
    openai: openAIStrictify(JSON.parse(JSON.stringify(copy))),
    anthropic: copy,
  };
}

module.exports = {
  cloneStripMetadata,
  openAIStrictify,
  prepareStructuredSchemas,
};
