const sanitizeHtml = require('sanitize-html');

const GUIDANCE_HTML_TAGS = [
  'h2',
  'h3',
  'h4',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'b',
  'i',
];

const GUIDANCE_HTML_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
};

/**
 * Sanitize organisation human step guidance HTML for storage and display.
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeGuidanceHtml(raw) {
  if (raw == null) return '';
  return sanitizeHtml(String(raw), {
    allowedTags: GUIDANCE_HTML_TAGS,
    allowedAttributes: GUIDANCE_HTML_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true),
    },
  }).trim();
}

module.exports = {
  sanitizeGuidanceHtml,
  GUIDANCE_HTML_TAGS,
};
