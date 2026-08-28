const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');
function extractFunction(name) {
  const start = preview.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < preview.length; index += 1) {
    if (preview[index] === '{') { depth += 1; opened = true; }
    else if (preview[index] === '}' && --depth === 0 && opened) return preview.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
function loadApi(resolvePlanDay = () => ({ minutesForMonth: 0 })) {
  const context = vm.createContext({
    iso: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    mins: value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; },
    resolvePlanDay
  });
  vm.runInContext([
    extractFunction('isPlanning2Gfb'),
    extractFunction('getPlanning2EmployeeFreeDayStatus'),
    extractFunction('getPlanning2WeeklyEmployeeSummary'),
    extractFunction('getPlanning2BranchDayMinutes'),
    extractFunction('getPlanning2BranchWeekMinutes'),
    extractFunction('getPlanning2GfbMonthStatus'),
    extractFunction('getPlanning2GfbMonthMinutes'),
    'this.api={getPlanning2EmployeeFreeDayStatus,getPlanning2WeeklyEmployeeSummary,getPlanning2BranchDayMinutes,getPlanning2BranchWeekMinutes,getPlanning2GfbMonthStatus,getPlanning2GfbMonthMinutes}'
  ].join(';'), context);
  return context.api;
}
const days = Array.from({ length: 6 }, (_, i) => new Date(2026, 7, 24 + i));
const entry = (type, minutesForMonth = 0) => ({ type, minutesForMonth });

test('only a resolved regular off day satisfies the normal employee free-day rule', () => {
  const api = loadApi();
  const employee = { id: 'normal', roleKey: 'TZ', target: '30:00' };
  for (const type of ['vacation', 'sick', 'holiday', 'external-help']) {
    const resolved = Array.from({ length: 6 }, () => entry('shift', 300));
    resolved[2] = entry(type);
    const status = api.getPlanning2EmployeeFreeDayStatus(employee, days, resolved);
    assert.equal(status.hasRegularFreeDay, false, `${type} must not count as regular free`);
    assert.equal(status.reason, 'Kein regulärer freier Tag');
  }
  const resolved = Array.from({ length: 6 }, () => entry('shift', 300));
  resolved[3] = entry('off');
  const status = api.getPlanning2EmployeeFreeDayStatus(employee, days, resolved);
  assert.equal(status.hasRegularFreeDay, true);
  assert.equal(status.isoDate, '2026-08-27');
  assert.equal(status.weekday, 4);
});

test('normal weekly summary reports under, exact, and over target', () => {
  const api = loadApi();
  const employee = { roleKey: 'TZ', target: '30:00' };
  for (const [actual, difference, under, over] of [[1740, -60, true, false], [1800, 0, false, false], [1890, 90, false, true]]) {
    const summary = api.getPlanning2WeeklyEmployeeSummary(employee, days, [entry('shift', actual)]);
    assert.equal(summary.actualMinutes, actual);
    assert.equal(summary.targetMinutes, 1800);
    assert.equal(summary.differenceMinutes, difference);
    assert.equal(summary.isUnderTarget, under);
    assert.equal(summary.isOverTarget, over);
  }
});

test('weekly actual uses resolved minutes for vacation, sick, holiday, and off', () => {
  const api = loadApi();
  const resolved = [entry('shift', 480), entry('vacation', 360), entry('sick', 300), entry('holiday', 240), entry('off', 0), entry('external-help', 120)];
  const summary = api.getPlanning2WeeklyEmployeeSummary({ target: '30:00' }, days, resolved);
  assert.equal(summary.actualMinutes, 1500);
  assert.deepEqual(Array.from(summary.daily, day => day.minutes), [480, 360, 300, 240, 0, 120]);
});

test('GFB has actual time but no artificial weekly target evaluation', () => {
  const api = loadApi();
  for (const actual of [60, 3000]) {
    const summary = api.getPlanning2WeeklyEmployeeSummary({ roleKey: ' gfb ', target: '40:00' }, days, [entry('shift', actual)]);
    assert.equal(summary.actualMinutes, actual);
    assert.equal(summary.targetMinutes, null);
    assert.equal(summary.differenceMinutes, 0);
    assert.equal(summary.isGfb, true);
    assert.equal(summary.isUnderTarget, false);
    assert.equal(summary.isOverTarget, false);
  }
});

test('weekly and monthly GFB actuals refresh from resolved values and multiple GFB add together', () => {
  const minutes = { a: 120, b: 180, normal: 999 };
  const api = loadApi((plan, employee) => ({ type: 'shift', minutesForMonth: minutes[employee.id] }));
  const employees = [{ id: 'a', roleKey: 'GFB' }, { id: 'b', roleKey: 'gfb' }, { id: 'normal', roleKey: 'TZ' }];
  assert.equal(api.getPlanning2GfbMonthMinutes({}, employees, new Date(2026, 1, 1)), 28 * 300);
  assert.equal(api.getPlanning2WeeklyEmployeeSummary(employees[0], days, [entry('shift', minutes.a)]).actualMinutes, 120);
  minutes.a = 240;
  assert.equal(api.getPlanning2WeeklyEmployeeSummary(employees[0], days, [entry('shift', minutes.a)]).actualMinutes, 240);
  assert.equal(api.getPlanning2GfbMonthMinutes({}, employees, new Date(2026, 1, 1)), 28 * 420);
});

test('normal employees and GFB remain independent in the same calculation', () => {
  const api = loadApi();
  const normal = api.getPlanning2WeeklyEmployeeSummary({ roleKey: 'TZ', target: '10:00' }, days, [entry('shift', 540)]);
  const gfb = api.getPlanning2WeeklyEmployeeSummary({ roleKey: 'GFB', target: '10:00' }, days, [entry('shift', 900)]);
  assert.equal(normal.differenceMinutes, -60);
  assert.equal(normal.isUnderTarget, true);
  assert.equal(gfb.actualMinutes, 900);
  assert.equal(gfb.differenceMinutes, 0);
});

test('personal GFB month statuses remain separate and refresh from central day resolution', () => {
  const minutes = { a: 90, b: 150 };
  const api = loadApi((plan, employee) => ({ type: 'shift', minutesForMonth: minutes[employee.id] || 0 }));
  const month = new Date(2026, 1, 1);
  const first = api.getPlanning2GfbMonthStatus({}, { id: 'a', roleKey: 'GFB' }, month);
  const second = api.getPlanning2GfbMonthStatus({}, { id: 'b', roleKey: 'GFB' }, month);
  assert.equal(first.gfbMonthActualMinutes, 28 * 90);
  assert.equal(first.gfbMonthLimitMinutes, 2580);
  assert.equal(first.gfbMonthRemainingMinutes, 60);
  assert.equal(second.gfbMonthActualMinutes, 28 * 150);
  assert.equal(second.gfbMonthDifferenceMinutes, 2580 - 28 * 150);
  assert.equal(second.gfbMonthRemainingMinutes, 0);
  minutes.a = 60;
  assert.equal(api.getPlanning2GfbMonthStatus({}, { id: 'a', roleKey: 'GFB' }, month).gfbMonthActualMinutes, 28 * 60);
  assert.equal(api.getPlanning2GfbMonthStatus({}, { id: 'b', roleKey: 'GFB' }, month).gfbMonthActualMinutes, 28 * 150);
});

test('branch day counts only resolved local shift minutes and matches the corresponding week sum', () => {
  const api = loadApi();
  const day = [
    { type: 'shift', minutesForBranch: 480, minutes: 510 },
    { type: 'shift', minutesForBranch: 315, minutes: 360 },
    { type: 'vacation', minutesForBranch: 0, minutesForMonth: 360 },
    { type: 'sick', minutesForBranch: 0, minutesForMonth: 300 },
    { type: 'off', minutesForBranch: 0 },
    { type: 'holiday', minutesForBranch: 0, minutesForMonth: 240 },
    { type: 'external-help', minutesForBranch: 0, minutesForMonth: 120 }
  ];
  assert.equal(api.getPlanning2BranchDayMinutes(day), 795);
  assert.equal(api.getPlanning2BranchWeekMinutes([day]), 795);
});

test('branch week counts only real local shifts', () => {
  const api = loadApi();
  const resolved = [[
    { type: 'shift', minutesForMonth: 480, minutesForBranch: 480 },
    { type: 'vacation', minutesForMonth: 360, minutesForBranch: 0 },
    { type: 'sick', minutesForMonth: 300, minutesForBranch: 0 },
    { type: 'off', minutesForMonth: 0, minutesForBranch: 0 },
    { type: 'holiday', minutesForMonth: 240, minutesForBranch: 0 },
    { type: 'external-help', minutesForMonth: 120, minutesForBranch: 0 }
  ]];
  assert.equal(api.getPlanning2BranchWeekMinutes(resolved), 480);
  resolved[0][0] = { type: 'shift', minutesForMonth: 540, minutesForBranch: 540 };
  assert.equal(api.getPlanning2BranchWeekMinutes(resolved), 540);
});

test('personal GFB month status preserves a negative difference above 43 hours', () => {
  const api = loadApi(() => ({ type: 'shift', minutesForMonth: 90 }));
  const status = api.getPlanning2GfbMonthStatus({}, { id: 'over', roleKey: 'GFB' }, new Date(2026, 1, 1));
  assert.equal(status.gfbMonthActualMinutes, 2520);
  assert.equal(status.gfbMonthDifferenceMinutes, 60);
  assert.equal(status.gfbMonthRemainingMinutes, 60);
  const over = loadApi(() => ({ type: 'shift', minutesForMonth: 100 })).getPlanning2GfbMonthStatus({}, { id: 'over', roleKey: 'GFB' }, new Date(2026, 1, 1));
  assert.equal(over.gfbMonthActualMinutes, 2800);
  assert.equal(over.gfbMonthDifferenceMinutes, -220);
  assert.equal(over.gfbMonthRemainingMinutes, 0);
});
