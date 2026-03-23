/**
 * Parse JSON from LLM output. Models (especially Claude) often wrap JSON in ```json fences
 * or add a short preamble — this normalises before JSON.parse.
 */

function stripMarkdownCodeFence(text) {
  let s = String(text).trim();
  if (!s.startsWith('```')) {
    return s;
  }
  const firstNl = s.indexOf('\n');
  const header = firstNl === -1 ? s : s.slice(0, firstNl);
  const afterHeader = firstNl === -1 ? '' : s.slice(firstNl + 1);
  // First line should be an opening fence: ``` or ```json etc.
  if (!/^```[\w-]*\s*$/.test(header.trim())) {
    return s;
  }
  const close = afterHeader.lastIndexOf('```');
  if (close === -1) {
    return afterHeader.trim();
  }
  return afterHeader.slice(0, close).trim();
}

function extractJsonSubstring(s) {
  const obj = s.indexOf('{');
  const arr = s.indexOf('[');
  let start = -1;
  let openChar;
  let closeChar;
  if (obj >= 0 && (arr < 0 || obj < arr)) {
    start = obj;
    openChar = '{';
    closeChar = '}';
  } else if (arr >= 0) {
    start = arr;
    openChar = '[';
    closeChar = ']';
  } else {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === openChar) depth++;
    if (c === closeChar) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * @param {string} raw
 * @returns {object|Array}
 */
function parseModelJsonResponse(raw) {
  if (raw == null || String(raw).trim() === '') {
    throw new SyntaxError('Empty AI response');
  }
  let s = stripMarkdownCodeFence(raw);

  try {
    return JSON.parse(s);
  } catch (first) {
    const extracted = extractJsonSubstring(s);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch (second) {
        throw new SyntaxError(
          `${first.message} (fallback extract also failed: ${second.message})`
        );
      }
    }
    throw first;
  }
}

module.exports = {
  parseModelJsonResponse,
  stripMarkdownCodeFence,
};
