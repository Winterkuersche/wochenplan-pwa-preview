const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts(['manual-month-utils.js']);

test('parseManualMonthBulkInput parses valid rows and keeps last value per month', () => {
  const result = ctx.parseManualMonthBulkInput(`
2026-01 150:30
2026-02;148:00
2026-01\t151:00
`);

  assert.deepEqual(JSON.parse(JSON.stringify(result.values)), {
    '2026-01': 9060,
    '2026-02': 8880
  });
  assert.equal(result.lineErrors.length, 0);
});

test('parseManualMonthBulkInput returns line error for invalid format', () => {
  const result = ctx.parseManualMonthBulkInput(`
2026-01 150:00
foo
`);

  assert.deepEqual(JSON.parse(JSON.stringify(result.values)), {
    '2026-01': 9000
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.lineErrors)), [
    'Zeile 3: Bitte Format YYYY-MM HH:MM verwenden.'
  ]);
});

test('parseManualMonthBulkInput rejects invalid months clearly', () => {
  const result = ctx.parseManualMonthBulkInput(`
2026-13 10:00
2026-1 10:00
`);

  assert.deepEqual(JSON.parse(JSON.stringify(result.values)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(result.lineErrors)), [
    'Zeile 2: Bitte Format YYYY-MM HH:MM verwenden.',
    'Zeile 3: Bitte Format YYYY-MM HH:MM verwenden.'
  ]);
});

test('parseManualMonthBulkInput trims lines and rejects invalid minute ranges', () => {
  const result = ctx.parseManualMonthBulkInput(`
  2026-03    140:15
2026-04 140:60
`);

  assert.deepEqual(JSON.parse(JSON.stringify(result.values)), {
    '2026-03': 8415
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.lineErrors)), [
    'Zeile 3: Bitte Format YYYY-MM HH:MM verwenden.'
  ]);
});
