function getNestedValue(obj, fieldPath) {
  return fieldPath.split('.').reduce((current, key) => {
    if (current == null) {
      return undefined;
    }
    return current[key];
  }, obj);
}

function escapeCsvField(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function jsonToCsv(rows, fields) {
  const header = fields.map(escapeCsvField).join(',');
  const lines = (Array.isArray(rows) ? rows : []).map((row) =>
    fields.map((field) => escapeCsvField(getNestedValue(row, field))).join(',')
  );
  return [header, ...lines].join('\n');
}

module.exports = {
  jsonToCsv,
};
