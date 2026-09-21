const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const {
  validateZipArchive,
  isSafeZipEntryName,
} = require('../lib/reportTemplateValidation');

describe('reportTemplateValidation zip hardening', () => {
  it('accepts normal docx entry paths', () => {
    assert.equal(isSafeZipEntryName('word/document.xml'), true);
  });

  it('rejects traversal and absolute paths', () => {
    assert.equal(isSafeZipEntryName('../word/document.xml'), false);
    assert.equal(isSafeZipEntryName('/etc/passwd'), false);
  });

  it('validates safe archives', () => {
    const safeZip = new AdmZip();
    safeZip.addFile('word/document.xml', Buffer.from('<w:document/>'));
    assert.equal(validateZipArchive(safeZip).ok, true);
  });

  it('rejects archives with too many entries', () => {
    const largeZip = new AdmZip();
    for (let i = 0; i < 501; i += 1) {
      largeZip.addFile(`word/part${i}.xml`, Buffer.from('<w:document/>'));
    }
    assert.equal(validateZipArchive(largeZip).ok, false);
  });
});
