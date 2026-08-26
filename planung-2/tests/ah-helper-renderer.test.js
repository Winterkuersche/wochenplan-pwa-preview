const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunctionSource(script, functionName) {
  const marker = `function ${functionName}`;
  const start = script.indexOf(marker);
  if (start < 0) return '';

  let depth = 0;
  let bodyStarted = false;
  for (let i = start; i < script.length; i += 1) {
    const ch = script[i];
    if (ch === '{') {
      depth += 1;
      bodyStarted = true;
    } else if (ch === '}') {
      depth -= 1;
      if (bodyStarted && depth === 0) {
        return script.slice(start, i + 1);
      }
    }
  }

  return '';
}

function loadOverviewCellTextHelper(overrides = {}) {
  const fnSource = extractFunctionSource(appScript, 'getOverviewWeekPlannerCellText');
  assert.ok(fnSource, 'getOverviewWeekPlannerCellText should exist in app.js');

  const context = vm.createContext({
    ENTRY_STATUS: {
      WORK: 'work',
      EXTERNAL: 'external-help',
      VACATION: 'vacation',
      SICK: 'sick'
    },
    getResolvedStatus: (resolved) => resolved?.status || '',
    formatHMToQuarterLabel: (value) => value,
    getExternalHelpCompactDisplay: () => '',
    getStatusShortLabel: () => '',
    ...overrides
  });

  vm.runInContext(`${fnSource}; this.getOverviewWeekPlannerCellText = getOverviewWeekPlannerCellText;`, context, {
    filename: 'app.js'
  });

  return context.getOverviewWeekPlannerCellText;
}

function loadMonthHelpers() {
  return loadScripts(['status-utils.js', 'time-utils.js', 'month-engine.js']);
}

test('AH mit branch + minutes zeigt AH, Ziel und Stunden', () => {
  const ctx = loadMonthHelpers();

  const html = ctx.getExternalHelpCompactDisplay({
    type: 'external-help',
    branch: 'Filiale Nord',
    minutes: 180
  });

  assert.match(html, /AH/);
  assert.match(html, /Filiale Nord/);
  assert.match(html, /3:00/);
  assert.match(html, /ahCellSeparator/);
});

test('AH ohne Ziel bleibt stabil ohne leeres Trennzeichen', () => {
  const ctx = loadMonthHelpers();

  const html = ctx.getExternalHelpCompactDisplay({
    type: 'external-help',
    minutes: 120
  });

  assert.match(html, /AH/);
  assert.match(html, /2:00/);
  assert.doesNotMatch(html, /ahCellSeparator/);
});

test('AH ohne Minuten zeigt keine falsche Stundenanzeige', () => {
  const ctx = loadMonthHelpers();

  const html = ctx.getExternalHelpCompactDisplay({
    type: 'external-help',
    branch: 'Filiale Süd'
  });

  assert.match(html, /AH/);
  assert.match(html, /Filiale Süd/);
  assert.doesNotMatch(html, />\d+:\d{2}</);
  assert.doesNotMatch(html, /ahCellSeparator/);
});

test('normale Schicht (type: shift) bleibt unverändert', () => {
  const ctx = loadMonthHelpers();

  const text = ctx.getMonthCellText({
    type: 'shift',
    sourceEntry: {
      type: 'shift',
      start: '09:00',
      end: '17:00'
    }
  });

  assert.equal(text, '09:00-17:00');
});

test('Monatsrenderer nutzt den zentralen AH-Helperpfad', () => {
  const ctx = loadMonthHelpers();
  const resolved = {
    type: 'external-help',
    sourceEntry: { type: 'external-help', branch: 'Filiale West', minutes: 75 }
  };

  const text = ctx.getMonthCellText(resolved);

  assert.equal(text, ctx.getExternalHelpCompactDisplay(resolved));
});

test('Übersichtsrenderer nutzt denselben zentralen AH-Helperpfad', () => {
  const getOverviewWeekPlannerCellText = loadOverviewCellTextHelper({
    getExternalHelpCompactDisplay: () => '__AH_HELPER__'
  });

  const text = getOverviewWeekPlannerCellText({
    status: 'external-help',
    sourceEntry: { type: 'external-help' }
  });

  assert.equal(text, '__AH_HELPER__');
});