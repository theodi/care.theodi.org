const AdmZip = require('adm-zip');
const {
  REQUIRED_DOCX_PATCH_KEYS,
  KNOWN_DOCX_PATCH_KEYS,
  DEFAULT_REPORT_ACCENT_HEX,
} = require('./reportTemplatePlaceholders');

const MAX_DOCX_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

function isSafeZipEntryName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  const parts = normalized.split('/');
  return parts.every((part) => part && part !== '..');
}

function validateZipArchive(zip) {
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) {
    return {
      ok: false,
      warnings: [`Archive contains too many entries (max ${MAX_ZIP_ENTRIES})`],
    };
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    if (!isSafeZipEntryName(entry.entryName)) {
      return {
        ok: false,
        warnings: [`Unsafe zip entry path: ${entry.entryName}`],
      };
    }
    const uncompressedSize = entry.header && Number.isFinite(entry.header.size)
      ? entry.header.size
      : 0;
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        warnings: [`Zip entry exceeds size limit: ${entry.entryName}`],
      };
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        warnings: ['Total uncompressed size exceeds limit'],
      };
    }
  }

  return { ok: true, warnings: [] };
}

/**
 * Concatenate all w:t text node contents in document order (handles split placeholders).
 */
function extractWordTextFromDocumentXml(xml) {
  if (!xml || typeof xml !== 'string') {
    return '';
  }
  const parts = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    parts.push(m[1]);
  }
  return parts.join('');
}

function listZipXmlPaths(zip) {
  return zip.getEntries().map((e) => e.entryName);
}

function getEntryText(zip, name) {
  const e = zip.getEntry(name);
  if (!e) {
    return null;
  }
  return e.getData().toString('utf8');
}

/**
 * Combined text from document, headers, footers for placeholder validation.
 */
function buildCombinedPlaceholderSearchText(zip) {
  const names = listZipXmlPaths(zip);
  const chunks = [];
  const want = (n) =>
    n === 'word/document.xml' ||
    /^word\/header\d+\.xml$/i.test(n) ||
    /^word\/footer\d+\.xml$/i.test(n);
  for (const n of names) {
    if (want(n)) {
      const xml = getEntryText(zip, n);
      if (xml) {
        chunks.push(extractWordTextFromDocumentXml(xml));
      }
    }
  }
  return chunks.join('\n');
}

/**
 * @returns {{ ok: boolean, missingKeys: string[], warnings: string[] }}
 */
function validateDocxTemplateBuffer(buffer) {
  const warnings = [];
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, missingKeys: [...REQUIRED_DOCX_PATCH_KEYS], warnings: ['Empty file'] };
  }
  if (buffer.length > MAX_DOCX_BYTES) {
    return {
      ok: false,
      missingKeys: [...REQUIRED_DOCX_PATCH_KEYS],
      warnings: [`File exceeds ${MAX_DOCX_BYTES} bytes`],
    };
  }
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    return {
      ok: false,
      missingKeys: [...REQUIRED_DOCX_PATCH_KEYS],
      warnings: ['Not a valid ZIP/DOCX archive'],
    };
  }
  const zipValidation = validateZipArchive(zip);
  if (!zipValidation.ok) {
    return {
      ok: false,
      missingKeys: [...REQUIRED_DOCX_PATCH_KEYS],
      warnings: zipValidation.warnings,
    };
  }
  if (!getEntryText(zip, 'word/document.xml')) {
    return {
      ok: false,
      missingKeys: [...REQUIRED_DOCX_PATCH_KEYS],
      warnings: ['Missing word/document.xml'],
    };
  }
  const combined = buildCombinedPlaceholderSearchText(zip);
  const missingKeys = [];
  for (const key of REQUIRED_DOCX_PATCH_KEYS) {
    const token = `{{${key}}}`;
    if (!combined.includes(token)) {
      missingKeys.push(key);
    }
  }
  const foundPlaceholders = new Set();
  const re = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
  let m;
  while ((m = re.exec(combined)) !== null) {
    foundPlaceholders.add(m[1]);
  }
  const knownSet = new Set(KNOWN_DOCX_PATCH_KEYS);
  for (const name of foundPlaceholders) {
    if (!knownSet.has(name)) {
      warnings.push(`Unknown placeholder {{${name}}} may remain after export`);
    }
  }
  return {
    ok: missingKeys.length === 0,
    missingKeys,
    warnings,
  };
}

/**
 * Normalize 6-char hex (no #); return null if invalid.
 */
function normalizeHex6(s) {
  if (typeof s !== 'string') {
    return null;
  }
  const t = s.replace(/^#/, '').trim();
  if (/^[0-9A-Fa-f]{6}$/.test(t)) {
    return t.toUpperCase();
  }
  return null;
}

/**
 * Best-effort RGB from theme/theme1.xml for accent1 (or dk1 fallback).
 */
function extractThemeAccentHex(zip) {
  const theme = getEntryText(zip, 'word/theme/theme1.xml');
  if (!theme) {
    return null;
  }
  const mScheme = theme.match(/<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/i);
  if (!mScheme) {
    return null;
  }
  const scheme = mScheme[1];
  const take = (tag) => {
    const block = scheme.match(new RegExp(`<a:${tag}[^>]*>([\\s\S]*?)</a:${tag}>`, 'i'));
    if (!block) {
      return null;
    }
    const srgb = block[1].match(/<a:srgbClr[^>]*val="([^"]+)"/i);
    if (srgb) {
      return normalizeHex6(srgb[1]);
    }
    return null;
  };
  return take('accent1') || take('accent2') || take('dk1');
}

/**
 * Direct colour on Heading1 style in styles.xml.
 */
function extractHeading1ColorFromStyles(stylesXml) {
  if (!stylesXml) {
    return null;
  }
  const m = stylesXml.match(/<w:style[^>]*w:styleId="Heading1"[^>]*>[\s\S]*?<\/w:style>/i);
  if (!m) {
    return null;
  }
  const block = m[0];
  const colors = [...block.matchAll(/<w:color[^>]*\bw:val="([^"]+)"/gi)];
  for (const c of colors) {
    const v = c[1];
    if (v && String(v).toLowerCase() !== 'auto') {
      const h = normalizeHex6(v);
      if (h) {
        return h;
      }
    }
  }
  return null;
}

/**
 * @returns {string} 6-char hex uppercase, or DEFAULT_REPORT_ACCENT_HEX
 */
function extractAccentHexFromDocxBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return DEFAULT_REPORT_ACCENT_HEX;
  }
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    return DEFAULT_REPORT_ACCENT_HEX;
  }
  const zipValidation = validateZipArchive(zip);
  if (!zipValidation.ok) {
    return DEFAULT_REPORT_ACCENT_HEX;
  }
  const stylesXml = getEntryText(zip, 'word/styles.xml');
  const fromStyle = extractHeading1ColorFromStyles(stylesXml);
  if (fromStyle) {
    return fromStyle;
  }
  const fromTheme = extractThemeAccentHex(zip);
  if (fromTheme) {
    return fromTheme;
  }
  return DEFAULT_REPORT_ACCENT_HEX;
}

module.exports = {
  validateDocxTemplateBuffer,
  extractAccentHexFromDocxBuffer,
  extractWordTextFromDocumentXml,
  normalizeHex6,
  isSafeZipEntryName,
  validateZipArchive,
  MAX_DOCX_BYTES,
};
