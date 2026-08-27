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
    extractFunction('getPlanning2GfbMonthMinutes'),
    'this.api={getPlanning2EmployeeFreeDayStatus,getPlanning2WeeklyEmployeeSummary,getPlanning2GfbMonthMinutes}'
  ].join(';'), context);
  return context.api;
}
const days = Array.from({ length: 6 }, (_, i) => new Date(2026, 7, 24 + i));
const entry = (type, minutesForMonth = 0) => ({ type, minutesForMonth });

test('only a resolved regular off day satisfies the normal employee free-day rule', () => {
  const api = loadApi();
  const employee = { id: 'normal', roleKey: 'TZ', target: '30:00' };
  for (const type of ['vacation', 'sick', 'external-help']) {
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
