const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');

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
    `${extractFunction('resolvePlanDay')};${extractFunction('resolvedShiftTimes')};${extractFunction('coverage')};this.coverage=coverage`,
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

  assert.deepEqual(Array.from(coverage(employees, plan, day)), [false, '19:10: zweite Person fehlt']);

  resolved.late = shift('15:00', '19:10');
  assert.deepEqual(Array.from(coverage(employees, plan, day)), [true, '✓ Besetzung']);
  assert.equal(calls.length, 6, 'each check resolves every employee again');
  assert.equal(calls[0].isoDate, '2026-08-27');
  assert.equal(calls[0].schedule, plan.schedule);
  assert.equal(calls[0].absences, plan.absences);
});

test('persisted planning 2 edit is the entry used by coverage on the next render', () => {
  const dayIso = '2026-08-27';
  const employees = [{ id: 'opener' }, { id: 'early' }, { id: 'late' }];
  const stored = new Map();
  const renderedCoverage = [];
  const renderedLateCells = [];
  const editorFields = {
    editType: { value: 'L' },
    editStart: { value: '14:00' },
    editEnd: { value: '19:00' },
    editCheckout: { value: '19:00' },
    editBranch: { value: '' }
  };
  const realResolution = loadScripts([
    'holidays.js',
    'time-utils.js',
    'shift-rules.js',
    'date-utils.js',
    'shift-utils.js',
    'status-utils.js',
    'absences.js',
    'day-resolution.js'
  ]);
  const context = vm.createContext({
    TEST_PLAN: 'planning-2-test-plan',
    PREVIEW_MASTER: 'planning-2-master',
    active: () => true,
    LIVE_PLAN: 'live-plan',
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value)
    },
    iso: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    mins: (value) => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    },
    hm: (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`,
    getResolvedDayEntry: realResolution.getResolvedDayEntry,
    getBusinessRequiredBreakMinutes: realResolution.getBusinessRequiredBreakMinutes,
    getWorkedMinutesFromRange: realResolution.getWorkedMinutesFromRange,
    document: { getElementById: (id) => editorFields[id] },
    toast: () => {},
    closeEditor: () => {}
  });

  vm.runInContext([
    extractFunction('load'),
    extractFunction('save'),
    extractFunction('clone'),
    extractFunction('getTestPlan'),
    extractFunction('removeAbsenceDay'),
    extractFunction('clearDay'),
    extractFunction('putEntry'),
    extractFunction('makeShift'),
    extractFunction('resolvePlanDay'),
    extractFunction('resolvedShiftTimes'),
    extractFunction('coverage'),
    extractFunction('cell'),
    extractFunction('shiftDayIso'),
    extractFunction('previousRelevantWorkday'),
    extractFunction('nextRelevantWorkday'),
    extractFunction('carryoverRolePriority'),
    extractFunction('planning2ResolvedWorkShift'),
    extractFunction('rankCarryoverCandidates'),
    extractFunction('updatePlanning2ShiftStart'),
    extractFunction('applyPlanning2EarlyStartCarryover'),
    extractFunction('closingWorkload'),
    extractFunction('extendClosingShift'),
    extractFunction('applyPlanning2ClosingAutofix'),
    extractFunction('persist'),
    extractFunction('saveCustom'),
    `editing={eid:'late',dayIso:'${dayIso}'}`,
    `render=()=>{const plan=getTestPlan(),day=new Date(2026,7,27),resolved=resolvePlanDay(plan,employees[2],day);renderedCoverage.push(Array.from(coverage(employees,plan,day)));renderedLateCells.push(Array.from(cell(resolved)))}`,
    'this.api={getTestPlan,saveCustom}'
  ].join(';'), context);
  context.employees = employees;
  context.renderedCoverage = renderedCoverage;
  context.renderedLateCells = renderedLateCells;

  stored.set('planning-2-master', JSON.stringify({ employees }));
  stored.set('planning-2-test-plan', JSON.stringify({
    schedule: {
      [dayIso]: {
        opener: { type: 'shift', start: '08:55', end: '19:10' },
        early: { type: 'shift', start: '09:00', end: '18:00' },
        late: { type: 'shift', status: 'work', code: 'L', shiftKey: 'L', mode: 'late', start: 'L', end: '14:00' }
      }
    },
    absences: []
  }));

  vm.runInContext('render()', context);
  assert.deepEqual(Array.from(renderedCoverage[0]), [false, '19:10: zweite Person fehlt']);
  const legacyResolved = realResolution.getResolvedDayEntry({
    employee: employees[2],
    isoDate: dayIso,
    schedule: context.api.getTestPlan().schedule,
    absences: [],
    stateKey: 'schleswig-holstein'
  });
  assert.equal(legacyResolved.sourceEntry.start, 'L');
  assert.equal(legacyResolved.sourceEntry.end, '14:00');

  assert.equal(vm.runInContext("JSON.stringify(editing)", context), JSON.stringify({ eid: 'late', dayIso }));
  assert.equal(vm.runInContext("document.getElementById('editStart').value", context), '14:00');
  vm.runInContext("saveCustom()", context);

  assert.equal(JSON.parse(stored.get('planning-2-test-plan')).schedule[dayIso].late.start, '14:00');
  assert.equal(JSON.parse(stored.get('planning-2-test-plan')).schedule[dayIso].late.end, '19:10');
  assert.deepEqual(Array.from(renderedLateCells[1]), ['14:00–19:10', 'L', 'shift']);
  assert.deepEqual(Array.from(renderedCoverage[1]), [true, '✓ Besetzung']);
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
    [false, '19:10: zweite Person fehlt']
  );
});

test('coverage prioritizes a missing 08:55 opener', () => {
  const resolved = {
    first: shift('09:00', '19:10'),
    second: shift('09:00', '19:10')
  };
  const { coverage } = loadCoverage(resolved);

  assert.deepEqual(
    Array.from(coverage([{ id: 'first' }, { id: 'second' }], { schedule: {}, absences: [] }, new Date(2026, 7, 27))),
    [false, '08:55 fehlt']
  );
});

test('coverage identifies morning, afternoon, and evening understaffing', () => {
  const cases = [
    ['Vormittag', '09:00', '10:05', 'Unterbesetzung am Vormittag · 9:00–10:05 <2'],
    ['Nachmittag', '13:00', '14:05', 'Unterbesetzung am Nachmittag · 13:00–14:05 <2'],
    ['Abend', '18:00', '19:10', '19:10: zweite Person fehlt']
  ];

  for (const [section, gapStart, gapEnd, expected] of cases) {
    const resolved = {
      opener: shift('08:55', '19:10'),
      beforeGap: shift('09:00', gapStart),
      afterGap: shift(gapEnd, '19:10')
    };
    const { coverage } = loadCoverage(resolved);
    assert.deepEqual(
      Array.from(coverage(Object.keys(resolved).map((id) => ({ id })), { schedule: {}, absences: [] }, new Date(2026, 7, 27))),
      [false, expected],
      `${section} should be named in the warning`
    );
  }
});

test('coverage reports sufficient staffing for a fully covered day', () => {
  const resolved = {
    opener: shift('08:55', '19:10'),
    second: shift('09:00', '19:10')
  };
  const { coverage } = loadCoverage(resolved);

  assert.deepEqual(
    Array.from(coverage([{ id: 'opener' }, { id: 'second' }], { schedule: {}, absences: [] }, new Date(2026, 7, 27))),
    [true, '✓ Besetzung']
  );
});

test('coverage enforces two real employees through 19:10 without the old tolerance', () => {
  const day = new Date(2026, 3, 8);
  const resolved = {
    opener: shift('08:55', '19:10'),
    second: shift('09:00', '19:00')
  };
  const { coverage } = loadCoverage(resolved);

  assert.deepEqual(
    Array.from(coverage(Object.keys(resolved).map((id) => ({ id })), { schedule: {}, absences: [] }, day)),
    [false, '19:10: zweite Person fehlt']
  );
});
