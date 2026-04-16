/**
 * Patch keys for docx.patchDocument — must match placeholders {{key}} in the Word template
 * and the `patches` object keys in lib/docxBuilder.js (including the legacy typo).
 */
const REQUIRED_DOCX_PATCH_KEYS = [
  'doctitle',
  'title',
  'author',
  'footertitle',
  'date',
  'footerdate',
  'objectives',
  'aiAssistedNotice',
  'intendedConsequences',
  'positiveUnintendedConsequences',
  'dataUsed',
  'stakeholders',
  'riskBandSplitChart',
  'riskMatrixChart',
  'riskCountsSummary',
  'riskEntryMatrix',
  'topRisks',
  'aiProvenance',
  'glossaryAppendix',
  'unintendedConsequneces',
];

const DEFAULT_REPORT_ACCENT_HEX = '072589';

module.exports = {
  REQUIRED_DOCX_PATCH_KEYS,
  DEFAULT_REPORT_ACCENT_HEX,
};
