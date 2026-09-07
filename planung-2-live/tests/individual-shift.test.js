const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');

function buildContext() {
  return loadScripts(['time-utils.js', 'shift-rules.js', 'shift-utils.js']);
}

function addPlanEntryNormalizer(ctx) {
  const source = fs.readFileSync('app.js', 'utf8');
  const normalizer = source.match(/function normalizePlanEntry\(entry\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalizer);
  ctx.getWarnedUnknownShiftCodesSet = () => new Set();
  vm.runInContext(`${normalizer}; this.normalizePlanEntry = normalizePlanEntry;`, ctx);
}

test('individual shift converts net work and optional break into the calculated end', () => {
  const ctx = buildContext();
  const cases = [
    ['09:00', 360, 0, '15:00'],
    ['11:00', 360, 60, '18:00'],
    ['08:45', 330, 30, '14:45']
  ];

  for (const [start, work, pause, end] of cases) {
    const entry = ctx.buildIndividualShiftEntry(start, work, pause);
    assert.ok(entry);
    assert.equal(entry.start, start);
    assert.equal(entry.end, end);
    assert.equal(entry.minutes, work, 'pause must not count as work/branch minutes');
    assert.equal(entry.pause, pause);
    assert.equal(entry.breakMinutes, pause);
    assert.equal(entry.type, 'shift');
    assert.equal(entry.code, 'FLEX');
    assert.equal(entry.meta.ruleCode, 'FLEX');
  }
});

test('manual 08:55 opener remains a normal FLEX entry with net hours preserved', () => {
  const ctx = buildContext();
  const entry = ctx.buildIndividualShiftEntry('08:55', 360, 5);

  assert.ok(entry);
  assert.equal(entry.code, 'FLEX');
  assert.equal(entry.start, '08:55');
  assert.equal(entry.end, '15:00');
  assert.equal(entry.minutes, 360);
  assert.equal(entry.pause, 5);
});

test('individual shift uses central FLEX break and quarter-hour constraints', () => {
  const ctx = buildContext();

  assert.equal(ctx.buildIndividualShiftEntry('09:00', 375, 0), null, 'over-six-hour presence needs the central break');
  assert.equal(ctx.buildIndividualShiftEntry('09:10', 360, 0)?.start, '09:15', 'start uses central quarter normalization');
  assert.equal(ctx.buildIndividualShiftEntry('09:00', 350, 0)?.minutes, 345, 'work is normalized centrally');
});

test('individual shift can represent a central 19:10 carryover-qualifying FLEX entry', () => {
  const ctx = buildContext();
  const entry = ctx.buildIndividualCheckoutShiftEntry('13:00');

  assert.ok(entry);
  assert.equal(entry.end, '19:10');
  assert.equal(entry.minutes, 360);
  assert.equal(entry.pause, 10);
  assert.equal(entry.meta.source, 'individual-checkout-shift');
});

test('individual checkout path reuses central 19:10 break additions', () => {
  const ctx = buildContext();
  const entry = ctx.buildIndividualCheckoutShiftEntry('12:45');

  assert.equal(entry.end, '19:10');
  assert.equal(entry.pause, 70);
  assert.equal(entry.minutes, 315);
  assert.equal(ctx.buildIndividualCheckoutShiftEntry('08:55'), null, 'automatic opener start is not accepted by checkout quick entry');
});

test('individual checkout entry survives the normal save normalization path', () => {
  const ctx = loadScripts(['time-utils.js', 'status-utils.js', 'shift-rules.js', 'shift-utils.js']);
  addPlanEntryNormalizer(ctx);
  const entry = ctx.normalizePlanEntry(ctx.buildIndividualCheckoutShiftEntry('13:00'));

  assert.equal(entry.type, 'shift');
  assert.equal(entry.code, 'FLEX');
  assert.equal(entry.end, '19:10');
  assert.equal(entry.pause, 10);
  assert.equal(entry.minutes, 360);
});

test('central Flex UI exposes 08:55 only for the manual early context', () => {
  const source = fs.readFileSync('month-view.js', 'utf8');
  const flexRenderer = source.match(/function renderMonthFallbackFlexEditor[\s\S]*?\n\}/)?.[0] || '';

  assert.match(flexRenderer, /context === "early"/);
  assert.match(flexRenderer, /openerOption\.value = String\(8 \* 60 \+ 55\)/);
  assert.match(flexRenderer, /start === "08:55"/);
});

test('automatic 08:55 pause restores its previous value without replacing a manual pause', () => {
  const source = fs.readFileSync('month-view.js', 'utf8');
  const flexRenderer = source.match(/function renderMonthFallbackFlexEditor[\s\S]*?\n\}/)?.[0] || '';

  assert.match(flexRenderer, /pauseBeforeAutomaticOpener = selects\.pause\.value/);
  assert.match(flexRenderer, /automaticallyAppliedOpenerPause = true/);
  assert.match(flexRenderer, /selects\.pause\.value = pauseBeforeAutomaticOpener/);
  assert.match(flexRenderer, /openerPauseManuallyOverridden = true/);
  assert.match(flexRenderer, /if \(automaticallyAppliedOpenerPause\)/);
});

test('central Flex UI defaults its start based on the entry context', () => {
  const source = fs.readFileSync('month-view.js', 'utf8');
  const defaultStartHelper = source.match(/function getMonthFallbackFlexDefaultStartMinutes\(context\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(defaultStartHelper);
  const ctx = vm.createContext({});
  vm.runInContext(`${defaultStartHelper}; this.getDefaultStart = getMonthFallbackFlexDefaultStartMinutes;`, ctx);

  assert.equal(ctx.getDefaultStart('early'), 9 * 60);
  assert.equal(ctx.getDefaultStart('late'), 13 * 60);
  assert.equal(ctx.getDefaultStart('main'), 9 * 60);
});

test('central Flex UI defaults to six work hours, zero work minutes and no break', () => {
  const source = fs.readFileSync('month-view.js', 'utf8');
  const individualRenderer = source.match(/function renderMonthFallbackFlexEditor[\s\S]*?\n\}/)?.[0] || '';

  assert.match(individualRenderer, /key: "start"[^\n]+value: getMonthFallbackFlexDefaultStartMinutes\(context\)/);
  assert.match(individualRenderer, /key: "pause"[^\n]+value: 0/);
  assert.match(individualRenderer, /option\.selected = hours === 6/);
  assert.match(individualRenderer, /for \(const minutes of \[0, 15, 30, 45\]\)/);
  assert.match(individualRenderer, /<strong>15:00<\/strong>/);
});

test('central Flex UI composes hour and minute selections for the central shift builder', () => {
  const source = fs.readFileSync('month-view.js', 'utf8');
  const individualRenderer = source.match(/function renderMonthFallbackFlexEditor[\s\S]*?\n\}/)?.[0] || '';

  assert.match(
    individualRenderer,
    /Number\(selects\.workHours\.value\) \* 60 \+ Number\(selects\.workMinutes\.value\)/
  );
  assert.match(
    individualRenderer,
    /buildIndividualShiftEntry\(start, selectedWorkMinutes, Number\(selects\.pause\.value\)\)/
  );
});

test('existing fixed, late, full and FLEX builders keep their established break values', () => {
  const ctx = buildContext();

  assert.deepEqual(
    ['F3', 'F4', 'F5', 'F6'].map((code) => ctx.buildEarlyShiftEntry(code).pause),
    [0, 0, 0, 0]
  );
  assert.equal(ctx.buildFoShiftEntry('15:00').pause, 5);
  assert.equal(ctx.buildLateShiftEntry('13:00', true).pause, 10);
  assert.equal(ctx.buildFullShiftEntry(false).pause, 60);
  assert.equal(ctx.buildFullShiftEntry(true).pause, 70);
  assert.equal(ctx.buildFlexibleShiftEntry('09:00', '15:00').pause, 0);
  assert.equal(ctx.buildFlexibleShiftEntry('09:00', '15:15').pause, 60);
});
