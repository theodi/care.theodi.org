/**
 * Patch keys for docx.patchDocument — must match placeholders {{key}} in the Word template
 * and the `patches` object keys in lib/docxBuilder.js (including the legacy typo).
 */
const REQUIRED_DOCX_PATCH_KEYS = [
  'doctitle',
  'title',
  'author',
  'date',
  'objectives',
  'aiAssistedNotice',
  'intendedConsequences',
  'positiveUnintendedConsequences',
  'dataUsed',
  'stakeholders',
  'riskEntryMatrix',
  'aiProvenance',
  'glossaryAppendix',
  'unintendedConsequneces',
];

/** Placeholders CARE can fill when present; uploads are valid without them. */
const OPTIONAL_DOCX_PATCH_KEYS = [
  'footertitle',
  'footerdate',
  'riskBandSplitChart',
  'riskMatrixChart',
  'riskCountsSummary',
  'topRisks',
];

const KNOWN_DOCX_PATCH_KEYS = [...REQUIRED_DOCX_PATCH_KEYS, ...OPTIONAL_DOCX_PATCH_KEYS];

const DEFAULT_REPORT_ACCENT_HEX = '072589';

module.exports = {
  REQUIRED_DOCX_PATCH_KEYS,
  OPTIONAL_DOCX_PATCH_KEYS,
  KNOWN_DOCX_PATCH_KEYS,
  DEFAULT_REPORT_ACCENT_HEX,
};
