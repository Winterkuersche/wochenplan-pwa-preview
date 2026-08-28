const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');
function extract(name) {
  const start = preview.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  let depth = 0;
  let open = false;
  for (let index = start; index < preview.length; index += 1) {
    if (preview[index] === '{') { depth += 1; open = true; }
    else if (preview[index] === '}' && --depth === 0 && open) return preview.slice(start, index + 1);
  }
  throw new Error(name);
}

function loadApi() {
  const calls = [];
  const context = vm.createContext({
    iso: date => date.toISOString().slice(0, 10),
    shiftDayIso: (dayIso, amount) => {
      const date = new Date(`${dayIso}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + amount);
      return date.toISOString().slice(0, 10);
    },
    isPlanning2Gfb: employee => employee.roleKey === 'GFB',
    resolvePlanDay: () => ({ type: 'shift' }),
    getPlanning2GfbMonthStatus: (_plan, employee, date) => {
      calls.push([employee.id, date.toISOString().slice(0, 10)]);
      return { gfbMonthActualMinutes: date.getUTCMonth() + 1, gfbMonthRemainingMinutes: 60 };
    },
    buildPlanning2OptimizationContext: (...args) => args,
    buildPlanning2OptimizationSuggestions: value => value
  });
  vm.runInContext([
    extract('planning2WeekDaysForIso'),
    extract('getPlanning2GfbMonthStatusesByIsoDate'),
    extract('getCurrentPlanning2OptimizationSuggestions'),
    'this.api={getCurrentPlanning2OptimizationSuggestions}'
  ].join(';'), context);
  return { api: context.api, calls };
}

test('cross-month week calculates each GFB budget from the suggestion date month', () => {
  const { api, calls } = loadApi();
  const result = api.getCurrentPlanning2OptimizationSuggestions({}, [{ id: 'gfb', roleKey: 'GFB' }], '2026-09-01');
  const baseStatuses = result[3];
  const statusesByDate = result[4];

  assert.equal(statusesByDate['2026-08-31'].gfb.gfbMonthActualMinutes, 8);
  for (const dayIso of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) {
    assert.equal(statusesByDate[dayIso].gfb.gfbMonthActualMinutes, 9, dayIso);
  }
  assert.equal(baseStatuses.gfb.gfbMonthActualMinutes, 9, 'fresh validation uses the requested isoDate month');
  assert.deepEqual(calls, [
    ['gfb', '2026-08-31'],
    ['gfb', '2026-09-01']
  ], 'one GFB is calculated once for each of the two calendar months');
});

test('month status caching remains separate per GFB employee', () => {
  const { api, calls } = loadApi();
  api.getCurrentPlanning2OptimizationSuggestions({}, [
    { id: 'first', roleKey: 'GFB' },
    { id: 'second', roleKey: 'GFB' }
  ], '2026-09-01');

  assert.deepEqual(calls, [
    ['first', '2026-08-31'],
    ['second', '2026-08-31'],
    ['first', '2026-09-01'],
    ['second', '2026-09-01']
  ], 'two GFB employees across two months require exactly four calculations');
});
