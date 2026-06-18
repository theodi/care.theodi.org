const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { jsonToCsv } = require('../lib/jsonToCsv');

describe('jsonToCsv', () => {
  it('escapes commas, quotes, and newlines', () => {
    const rows = [
      {
        consequence: 'Risk "A"',
        outcome: 'line\nbreak',
        action: { description: 'Do, it', stakeholder: 'Bob' },
      },
    ];

    const csv = jsonToCsv(rows, [
      'consequence',
      'outcome',
      'action.description',
      'action.stakeholder',
    ]);

    assert.match(csv, /"Risk ""A"""/);
    assert.match(csv, /"line\nbreak"/);
    assert.match(csv, /"Do, it"/);
  });
});
