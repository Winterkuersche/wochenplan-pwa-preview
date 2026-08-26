const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts(['date-utils.js', 'month-engine.js']);

test('month grid for March 2026 starts on Monday and ends on Sunday', () => {
  const weeks = ctx.buildMonthWeeks(2026, 2); // March
  assert.equal(weeks[0][0].iso, '2026-02-23');
  assert.equal(weeks[weeks.length - 1][6].iso, '2026-04-05');
});

test('february leap year includes 29th day in month meta', () => {
  const meta = ctx.getMonthMeta(2024, 1); // February
  assert.equal(meta.firstOfMonthIso, '2024-02-01');
  assert.equal(meta.lastOfMonthIso, '2024-02-29');
});

test('active week can start in previous month and still include 7 contiguous days', () => {
  const weeks = ctx.buildMonthWeeks(2026, 2); // March
  const firstWeek = weeks[0];

  assert.equal(firstWeek[0].iso, '2026-02-23');
  assert.equal(firstWeek[6].iso, '2026-03-01');
  assert.equal(firstWeek.filter((day) => day.inCurrentMonth).length, 1);
});

test('month switch keeps week boundaries stable for adjacent months', () => {
  const marchWeeks = ctx.buildMonthWeeks(2026, 2);
  const aprilWeeks = ctx.buildMonthWeeks(2026, 3);

  const marchLastWeek = marchWeeks[marchWeeks.length - 1];
  const aprilFirstWeek = aprilWeeks[0];

  assert.equal(marchLastWeek[0].iso, '2026-03-30');
  assert.equal(marchLastWeek[6].iso, '2026-04-05');
  assert.equal(aprilFirstWeek[0].iso, '2026-03-30');
  assert.equal(aprilFirstWeek[6].iso, '2026-04-05');
  assert.equal(marchLastWeek.filter((day) => day.inCurrentMonth).length, 2);
  assert.equal(aprilFirstWeek.filter((day) => day.inCurrentMonth).length, 5);
});

test('getMonthPlanFromYearMonth resolves strict YYYY-MM values', () => {
  const monthPlan = ctx.getMonthPlanFromYearMonth('2026-03');
  assert.equal(monthPlan.meta.firstOfMonthIso, '2026-03-01');
  assert.equal(monthPlan.weeks[0][0].iso, '2026-02-23');
  assert.equal(ctx.getMonthPlanFromYearMonth('2026-3'), null);
});
