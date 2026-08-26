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
    if (preview[index] === '{') {
      depth += 1;
      opened = true;
    } else if (preview[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return preview.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadCoverage(resolvedByEmployee) {
  const calls = [];
  const context = vm.createContext({
    iso: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    mins: (value) => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    },
    hm: (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`,
    getResolvedDayEntry: (params) => {
      calls.push(params);
      return resolvedByEmployee[params.employee.id];
    }
  });
  vm.runInContext(
    `${extractFunction('coverage')};this.coverage=coverage`,
    context
  );
  return { coverage: context.coverage, calls };
}

function shift(start, end) {
  return { type: 'shift', sourceEntry: { type: 'shift', start, end } };
}

test('coverage uses every employee resolved shift and refreshes after a changed shift', () => {
  const resolved = {
    opener: shift('08:55', '19:10'),
    early: shift('09:00', '18:00'),
    late: shift('15:00', '18:00')
  };
  const { coverage, calls } = loadCoverage(resolved);
  const employees = [{ id: 'opener' }, { id: 'early' }, { id: 'late' }];
  const plan = { schedule: {}, absences: [] };
  const day = new Date(2026, 7, 27);

  assert.deepEqual(Array.from(coverage(employees, plan, day)), [false, '18:00–19:10 <2']);

  resolved.late = shift('15:00', '19:00');
  assert.deepEqual(Array.from(coverage(employees, plan, day)), [true, '✓ Besetzung']);
  assert.equal(calls.length, 6, 'each check resolves every employee again');
  assert.equal(calls[0].isoDate, '2026-08-27');
  assert.equal(calls[0].schedule, plan.schedule);
  assert.equal(calls[0].absences, plan.absences);
});

test('coverage excludes resolved non-working states including external help', () => {
  const resolved = {
    opener: shift('08:55', '19:10'),
    vacation: { type: 'vacation', sourceEntry: { start: '09:00', end: '19:10' } },
    sick: { type: 'sick', sourceEntry: { start: '09:00', end: '19:10' } },
    external: { type: 'external-help', sourceEntry: { start: '09:00', end: '19:10' } }
  };
  const { coverage } = loadCoverage(resolved);
  const employees = Object.keys(resolved).map((id) => ({ id }));

  assert.deepEqual(
    Array.from(coverage(employees, { schedule: {}, absences: [] }, new Date(2026, 7, 27))),
    [false, '9:00–19:10 <2']
  );
});

test('coverage keeps the 60-minute tolerance through the 19:10 closing check', () => {
  const resolved = {
    opener: shift('08:55', '19:10'),
    second: shift('09:00', '19:00')
  };
  const { coverage } = loadCoverage(resolved);
  const employees = [{ id: 'opener' }, { id: 'second' }];

  assert.deepEqual(
    Array.from(coverage(employees, { schedule: {}, absences: [] }, new Date(2026, 7, 27))),
    [true, '✓ Besetzung'],
    'the ten minutes from 19:00 to 19:10 remain within tolerance'
  );
});
