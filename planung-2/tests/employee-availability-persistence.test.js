const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const preview = fs.readFileSync('planung2-preview.html', 'utf8');

function extract(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < app.length; index += 1) {
    if (app[index] === '{') { depth += 1; opened = true; }
    else if (app[index] === '}' && --depth === 0 && opened) return app.slice(start, index + 1);
  }
  throw new Error(name);
}

test('employee normalization and master persistence retain availability and preference facts', () => {
  for (const source of [extract('normalizeEmployee'), extract('saveMasterData'), extract('defaultMasterState')]) {
    assert.match(source, /availability: normalizeEmployeeAvailability/);
    assert.match(source, /timePreference: normalizeEmployeeTimePreference/);
    assert.match(source, /flexibleWeekDistribution:/);
  }
});

test('backup import normalizes restored employees and Planning 2 transfer keeps master data', () => {
  assert.match(extract('importBackupFromObject'), /normalizeEmployee\(employee, index\)/);
  assert.match(extract('collectPlanning2TransferSnapshot'), /master: loadJson\(MASTER_KEY, defaultMasterState\(\)\)/);
  assert.match(preview, /let master=clone\(source\.master\)/);
});

test('iPhone layout stacks availability controls and keeps touch-sized inputs', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.availabilityOverrideRow/);
  assert.match(styles, /min-height: 44px/);
});
