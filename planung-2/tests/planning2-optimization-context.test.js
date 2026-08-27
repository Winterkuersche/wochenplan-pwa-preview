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
function loadApi() {
  const context = vm.createContext({
    iso: date => date.toISOString().slice(0, 10),
    pad: value => String(value).padStart(2, '0'),
    mins: value => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; },
    hm: value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
  });
  vm.runInContext([
    'function resolvedShiftTimes(resolved){let entry=resolved?.sourceEntry;return resolved?.type==="shift"?{start:entry.start,end:entry.end}:null}',
    extractFunction('evaluateResolvedDayCoverage'),
    extractFunction('isPlanning2Gfb'),
    extractFunction('getPlanning2EmployeeFreeDayStatus'),
    extractFunction('getPlanning2WeeklyEmployeeSummary'),
    extractFunction('getPlanning2EmployeeWeekEvaluation'),
    extractFunction('buildPlanning2OptimizationContext'),
    extractFunction('formatPlanning2Difference'),
    'this.api={getPlanning2EmployeeWeekEvaluation,buildPlanning2OptimizationContext,formatPlanning2Difference}'
  ].join(';'), context);
  return context.api;
}
const days = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(2026, 7, 24 + index)));
const shift = (start, end, minutesForMonth) => ({ type: 'shift', minutesForMonth, sourceEntry: { type: 'shift', start, end } });
const emptyWeek = () => Array.from({ length: 6 }, () => ({ type: 'empty', minutesForMonth: 0 }));

test('week evaluation consistently exposes the central summary and free-day status', () => {
  const resolved = emptyWeek();
  resolved[0] = shift('09:00', '19:00', 1740);
  resolved[3] = { type: 'off', minutesForMonth: 0 };
  const evaluation = loadApi().getPlanning2EmployeeWeekEvaluation({ roleKey: 'TZ', target: '30:00' }, days, resolved);
  assert.equal(evaluation.weeklyActualMinutes, evaluation.summary.actualMinutes);
  assert.equal(evaluation.weeklyTargetMinutes, evaluation.summary.targetMinutes);
  assert.equal(evaluation.differenceMinutes, -60);
  assert.equal(evaluation.isUnderTarget, true);
  assert.equal(evaluation.isOverTarget, false);
  assert.equal(evaluation.hasRegularFreeDay, evaluation.freeDay.hasRegularFreeDay);
  assert.equal(evaluation.hasRegularFreeDay, true);
  assert.equal(evaluation.isGfb, false);
});

test('signed weekly differences format under, exact, and over target for the UI', () => {
  const api = loadApi();
  assert.equal(api.formatPlanning2Difference(-60), '−1:00');
  assert.equal(api.formatPlanning2Difference(0), '±0:00');
  assert.equal(api.formatPlanning2Difference(90), '+1:30');
});

test('optimization context carries coverage windows, roles, shifts, and evaluations without mutation', () => {
  const employees = [
    { id: 'tl', name: 'Teamleitung', roleKey: 'TL', functionKey: 'SV', target: '30:00' },
    { id: 'gfb', name: 'Aushilfe', roleKey: 'GFB', target: '10:00' }
  ];
  const first = emptyWeek();
  const second = emptyWeek();
  first[0] = shift('09:00', '12:00', 180);
  second[0] = shift('10:00', '12:00', 120);
  first[1] = { type: 'off', minutesForMonth: 0 };
  const resolved = [first, second];
  const before = JSON.stringify({ employees, resolved });

  const context = loadApi().buildPlanning2OptimizationContext(employees, days, resolved);

  assert.equal(JSON.stringify({ employees, resolved }), before, 'input plan data must remain unchanged');
  assert.deepEqual(Array.from(context.days[0].understaffingWindows, gap => [gap.start, gap.end]), [[535, 540], [720, 1150]]);
  assert.equal(context.employees[0].roleKey, 'TL');
  assert.equal(context.employees[0].functionKey, 'SV');
  assert.equal(context.employees[0].shifts[0].start, '09:00');
  assert.equal(context.employees[0].evaluation.hasRegularFreeDay, true);
  assert.equal(context.employees[1].evaluation.isGfb, true);
  assert.equal(context.employees[1].evaluation.weeklyTargetMinutes, null);
  assert.equal(context.employees[1].evaluation.differenceMinutes, 0);
});
