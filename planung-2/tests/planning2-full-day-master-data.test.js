const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

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

test('employee master UI exposes an explicitly labelled Planning 2 full-day checkbox', () => {
  const render = extract('renderTeamSetup');
  assert.match(render, /planning2FullDayInput\.type = "checkbox"/);
  assert.match(render, /planning2FullDayInput\.checked = emp\.planning2FullDayCandidate === true/);
  assert.match(render, /planning2FullDayLabel\.textContent = "Planung 2 Ganztag"/);
  assert.match(render, /emp\.planning2FullDayCandidate = planning2FullDayInput\.checked/);
  assert.match(render, /saveAppStateDebounced\(\)/);
  assert.match(styles, /\.teamCheckboxField/);
});

test('new employees are not full-day candidates until explicitly selected', () => {
  assert.match(extract('createEmptyEmployee'), /planning2FullDayCandidate: false/);
});
