const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function sliceFunctionSource(script, startToken, endToken) {
  const startIndex = script.indexOf(startToken);
  const endIndex = script.indexOf(endToken, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return '';
  return script.slice(startIndex, endIndex).trim();
}

function loadOverwriteDecisionHelpers(contextOverrides = {}) {
  const decideSrc = sliceFunctionSource(
    appScript,
    'function decideMutationForIsoRange',
    '\n\nfunction resolveDayOverwriteDecision'
  );
  const resolveSrc = sliceFunctionSource(
    appScript,
    'function resolveDayOverwriteDecision',
    '\n\nfunction removeAbsenceCoverageForRange'
  );
  const textSrc = sliceFunctionSource(
    appScript,
    'function getOverwriteConfirmationText',
    '\n\nfunction requestOverwriteConfirmation'
  );
  const confirmSrc = sliceFunctionSource(
    appScript,
    'function requestOverwriteConfirmation',
    '\n\nfunction updateEmployeeDay'
  );

  assert.ok(decideSrc && resolveSrc && textSrc && confirmSrc, 'overwrite helper functions should exist in app.js');

  const context = vm.createContext({
    APP_META: { stateKey: 'SH' },
    state: { absences: [] },
    eachIsoDateInRange: (fromIso, toIso = fromIso) => {
      if (!fromIso || !toIso || fromIso > toIso) return [];
      const out = [];
      let current = new Date(`${fromIso}T00:00:00Z`);
      const end = new Date(`${toIso}T00:00:00Z`);
      while (current <= end) {
        out.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
      return out;
    },
    getHolidayByDate: () => null,
    getPlanEntry: () => null,
    isShiftEntry: (entry) => entry?.type === 'shift',
    getPriorityAbsenceForEmployeeOnDate: (absences, employeeId, isoDate) => (
      absences.find((entry) => (
        entry.employeeId === employeeId &&
        isoDate >= entry.from &&
        isoDate <= entry.to
      )) || null
    ),
    confirm: () => true,
    ...contextOverrides
  });

  vm.runInContext(`
${decideSrc}
${resolveSrc}
${textSrc}
${confirmSrc}
this.decideMutationForIsoRange = decideMutationForIsoRange;
this.resolveDayOverwriteDecision = resolveDayOverwriteDecision;
this.requestOverwriteConfirmation = requestOverwriteConfirmation;
`, context, { filename: 'app.js' });

  return context;
}

function loadMutationApiHelpers(contextOverrides = {}) {
  const decideSrc = sliceFunctionSource(
    appScript,
    'function decideMutationForIsoRange',
    '\n\nfunction resolveDayOverwriteDecision'
  );
  const resolveSrc = sliceFunctionSource(
    appScript,
    'function resolveDayOverwriteDecision',
    '\n\nfunction removeAbsenceCoverageForRange'
  );
  const removeAbsenceCoverageSrc = sliceFunctionSource(
    appScript,
    'function removeAbsenceCoverageForRange',
    '\n\nfunction clearShiftCoverageForRange'
  );
  const clearShiftCoverageSrc = sliceFunctionSource(
    appScript,
    'function clearShiftCoverageForRange',
    '\n\nfunction getOverwriteConfirmationText'
  );
  const textSrc = sliceFunctionSource(
    appScript,
    'function getOverwriteConfirmationText',
    '\n\nfunction requestOverwriteConfirmation'
  );
  const confirmSrc = sliceFunctionSource(
    appScript,
    'function requestOverwriteConfirmation',
    '\n\nfunction updateEmployeeDay'
  );
  const setShiftSrc = sliceFunctionSource(
    appScript,
    'function setShift',
    '\n\nfunction setExternalHelp'
  );
  const setAbsenceSrc = sliceFunctionSource(
    appScript,
    'function setAbsence',
    '\n\nfunction removeAbsence'
  );
  const clearDaySrc = sliceFunctionSource(
    appScript,
    'function clearDay',
    '\nfunction commitPlanChange'
  );

  assert.ok(
    decideSrc && resolveSrc && removeAbsenceCoverageSrc && clearShiftCoverageSrc &&
    textSrc && confirmSrc && setShiftSrc && setAbsenceSrc && clearDaySrc,
    'mutation API helper functions should exist in app.js'
  );

  const context = vm.createContext({
    APP_META: { stateKey: 'SH' },
    ENTRY_STATUS: { WORK: 'work', EXTERNAL: 'external' },
    state: { absences: [], schedule: {} },
    eachIsoDateInRange: (fromIso, toIso = fromIso) => {
      if (!fromIso || !toIso || fromIso > toIso) return [];
      const out = [];
      let current = new Date(`${fromIso}T00:00:00Z`);
      const end = new Date(`${toIso}T00:00:00Z`);
      while (current <= end) {
        out.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
      return out;
    },
    getHolidayByDate: () => null,
    getPlanEntry: () => null,
    isShiftEntry: (entry) => entry?.type === 'shift',
    getPriorityAbsenceForEmployeeOnDate: (absences, employeeId, isoDate) => (
      absences.find((entry) => (
        entry.employeeId === employeeId &&
        isoDate >= entry.from &&
        isoDate <= entry.to
      )) || null
    ),
    replaceAbsenceCoverage: (absences, employeeId, fromIso, toIso, replacementType = null) => {
      if (!replacementType) {
        return (absences || []).filter((entry) => (
          entry.employeeId !== employeeId ||
          entry.to < fromIso ||
          entry.from > toIso
        ));
      }

      const remaining = (absences || []).filter((entry) => (
        entry.employeeId !== employeeId ||
        entry.to < fromIso ||
        entry.from > toIso
      ));

      return [...remaining, { employeeId, from: fromIso, to: toIso, type: replacementType, note: '' }];
    },
    normalizeAbsences: (absences) => Array.isArray(absences) ? [...absences] : [],
    clearPlanEntry: () => {},
    setScheduleEntry: () => {},
    syncVacationScheduleFromAbsences: () => {},
    commitPlanChange: () => {},
    requestOverwriteConfirmation: () => true,
    normalizeShiftCode: (value) => value,
    buildLateShiftEntry: () => ({ type: 'shift', mode: 'late' }),
    buildFullShiftEntry: () => ({ type: 'shift', mode: 'full' }),
    buildEarlyShiftEntry: () => ({ type: 'shift', mode: 'early' }),
    confirm: () => true,
    ...contextOverrides
  });

  vm.runInContext(`
${decideSrc}
${resolveSrc}
${removeAbsenceCoverageSrc}
${clearShiftCoverageSrc}
${textSrc}
${confirmSrc}
${setShiftSrc}
${setAbsenceSrc}
${clearDaySrc}
this.decideMutationForIsoRange = decideMutationForIsoRange;
this.setShift = setShift;
this.setAbsence = setAbsence;
this.clearDay = clearDay;
`, context, { filename: 'app.js' });

  return context;
}


const ctx = loadScripts(['date-utils.js', 'time-utils.js', 'absences.js']);

const baseEntry = {
  id: 'abs-1',
  employeeId: 'emp_1',
  type: 'vacation',
  from: '2026-03-10',
  to: '2026-03-20',
  note: ''
};

test('subtractRangeFromAbsenceEntry removes full overlap', () => {
  const result = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-01', '2026-03-31');
  assert.equal(result.length, 0);
});

test('subtractRangeFromAbsenceEntry trims start', () => {
  const result = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-01', '2026-03-12');
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));
  assert.deepEqual(ranges, [['2026-03-13', '2026-03-20']]);
});

test('subtractRangeFromAbsenceEntry trims end', () => {
  const result = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-18', '2026-03-31');
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));
  assert.deepEqual(ranges, [['2026-03-10', '2026-03-17']]);
});

test('subtractRangeFromAbsenceEntry splits middle overlap', () => {
  const result = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-14', '2026-03-16');
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));
  assert.deepEqual(ranges, [
    ['2026-03-10', '2026-03-13'],
    ['2026-03-17', '2026-03-20']
  ]);
});

test('subtractRangeFromAbsenceEntry keeps non-overlapping entry', () => {
  const result = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-04-01', '2026-04-10');
  assert.equal(result.length, 1);
  assert.equal(result[0], baseEntry);
});

test('subtractRangeFromAbsenceEntry trims correctly at month start boundary', () => {
  const entry = {
    ...baseEntry,
    from: '2026-03-01',
    to: '2026-03-10'
  };
  const result = ctx.subtractRangeFromAbsenceEntry(entry, '2026-03-01', '2026-03-01');
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));
  assert.deepEqual(ranges, [['2026-03-02', '2026-03-10']]);
});

test('subtractRangeFromAbsenceEntry trims correctly at month end boundary', () => {
  const entry = {
    ...baseEntry,
    from: '2026-03-21',
    to: '2026-03-31'
  };
  const result = ctx.subtractRangeFromAbsenceEntry(entry, '2026-03-31', '2026-03-31');
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));
  assert.deepEqual(ranges, [['2026-03-21', '2026-03-30']]);
});

test('subtractRangeFromAbsenceEntry keeps directly adjacent ranges unchanged', () => {
  const resultBefore = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-01', '2026-03-09');
  const resultAfter = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-21', '2026-03-31');

  assert.equal(resultBefore.length, 1);
  assert.equal(resultBefore[0], baseEntry);
  assert.equal(resultAfter.length, 1);
  assert.equal(resultAfter[0], baseEntry);
});

test('subtractRangeFromAbsenceEntry preserves absence type for vacation and sick', () => {
  const sickEntry = {
    ...baseEntry,
    id: 'abs-2',
    type: 'sick'
  };

  const vacationResult = ctx.subtractRangeFromAbsenceEntry(baseEntry, '2026-03-14', '2026-03-16');
  const sickResult = ctx.subtractRangeFromAbsenceEntry(sickEntry, '2026-03-14', '2026-03-16');

  assert.deepEqual(JSON.parse(JSON.stringify(vacationResult.map((x) => x.type))), ['vacation', 'vacation']);
  assert.deepEqual(JSON.parse(JSON.stringify(sickResult.map((x) => x.type))), ['sick', 'sick']);
});

test('normalizeAbsences merges overlapping and directly adjacent ranges for same employee and type', () => {
  const input = [
    { employeeId: 'emp_1', type: 'vacation', from: '2026-04-06', to: '2026-04-08', note: '' },
    { employeeId: 'emp_1', type: 'vacation', from: '2026-04-09', to: '2026-04-12', note: '' },
    { employeeId: 'emp_1', type: 'vacation', from: '2026-04-18', to: '2026-04-18', note: '' }
  ];

  const result = ctx.normalizeAbsences(input);
  const ranges = JSON.parse(JSON.stringify(result.map((x) => [x.from, x.to])));

  assert.deepEqual(ranges, [
    ['2026-04-06', '2026-04-12'],
    ['2026-04-18', '2026-04-18']
  ]);
});

test('replaceAbsenceCoverage clears both absence types for a shift override range and preserves remaining segments', () => {
  const input = [
    { employeeId: 'emp_1', type: 'vacation', from: '2026-04-10', to: '2026-04-15', note: '' },
    { employeeId: 'emp_1', type: 'sick', from: '2026-04-12', to: '2026-04-14', note: '' },
    { employeeId: 'emp_2', type: 'vacation', from: '2026-04-12', to: '2026-04-12', note: '' }
  ];

  const result = ctx.replaceAbsenceCoverage(input, 'emp_1', '2026-04-12', '2026-04-13', null);
  const normalized = JSON.parse(JSON.stringify(
    result
      .map((x) => [x.employeeId, x.type, x.from, x.to])
      .sort((a, b) => a.join('|').localeCompare(b.join('|')))
  ));

  assert.deepEqual(normalized, [
    ['emp_1', 'sick', '2026-04-14', '2026-04-14'],
    ['emp_1', 'vacation', '2026-04-10', '2026-04-11'],
    ['emp_1', 'vacation', '2026-04-14', '2026-04-15'],
    ['emp_2', 'vacation', '2026-04-12', '2026-04-12']
  ]);
});

test('replaceAbsenceCoverage replaces vacation with sick only in target range', () => {
  const input = [
    { employeeId: 'emp_1', type: 'vacation', from: '2026-05-01', to: '2026-05-10', note: '' }
  ];

  const result = ctx.replaceAbsenceCoverage(input, 'emp_1', '2026-05-04', '2026-05-06', 'sick');
  const normalized = JSON.parse(JSON.stringify(
    result
      .map((x) => [x.type, x.from, x.to])
      .sort((a, b) => a.join('|').localeCompare(b.join('|')))
  ));

  assert.deepEqual(normalized, [
    ['sick', '2026-05-04', '2026-05-06'],
    ['vacation', '2026-05-01', '2026-05-03'],
    ['vacation', '2026-05-07', '2026-05-10']
  ]);
});


test('resolveDayOverwriteDecision requires confirmation for shift on vacation and absence split remains intact', () => {
  const helpers = loadOverwriteDecisionHelpers({
    state: {
      absences: [
        { employeeId: 'emp_1', type: 'vacation', from: '2026-06-01', to: '2026-06-05', note: '' }
      ]
    }
  });

  const decision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-06-03',
    nextType: 'shift'
  });

  assert.equal(decision.decision, 'confirm');
  assert.equal(decision.reason, 'replace-absence-with-shift');
  assert.equal(decision.affectedDays, 1);

  const splitResult = ctx.replaceAbsenceCoverage(
    [{ employeeId: 'emp_1', type: 'vacation', from: '2026-06-01', to: '2026-06-05', note: '' }],
    'emp_1',
    '2026-06-03',
    '2026-06-03',
    null
  );

  const ranges = JSON.parse(JSON.stringify(splitResult.map((x) => [x.type, x.from, x.to])));
  assert.deepEqual(ranges, [
    ['vacation', '2026-06-01', '2026-06-02'],
    ['vacation', '2026-06-04', '2026-06-05']
  ]);
});

test('resolveDayOverwriteDecision requires confirmation for sick on vacation', () => {
  const helpers = loadOverwriteDecisionHelpers({
    state: {
      absences: [
        { employeeId: 'emp_1', type: 'vacation', from: '2026-07-10', to: '2026-07-12', note: '' }
      ]
    }
  });

  const decision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-07-11',
    toIso: '2026-07-11',
    nextType: 'absence',
    nextAbsenceType: 'sick'
  });

  assert.equal(decision.decision, 'confirm');
  assert.equal(decision.reason, 'replace-vacation-with-sick');
  assert.equal(decision.affectedDays, 1);
});

test('resolveDayOverwriteDecision requires confirmation for vacation on sick', () => {
  const helpers = loadOverwriteDecisionHelpers({
    state: {
      absences: [
        { employeeId: 'emp_1', type: 'sick', from: '2026-07-10', to: '2026-07-12', note: '' }
      ]
    }
  });

  const decision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-07-11',
    toIso: '2026-07-11',
    nextType: 'absence',
    nextAbsenceType: 'vacation'
  });

  assert.equal(decision.decision, 'confirm');
  assert.equal(decision.reason, 'replace-sick-with-vacation');
  assert.equal(decision.affectedDays, 1);
});

test('resolveDayOverwriteDecision allows shift on existing shift without confirmation', () => {
  const helpers = loadOverwriteDecisionHelpers({
    getPlanEntry: () => ({ type: 'shift', mode: 'early', minutes: 360 })
  });

  const decision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-08-03',
    nextType: 'shift'
  });

  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason, 'ok');
  assert.equal(decision.shiftCoverageDays, 1);
});

test('direct-day mutation remains blocked on holiday but absence-range is allowed', () => {
  const helpers = loadOverwriteDecisionHelpers({
    getHolidayByDate: (_stateKey, isoDate) => (isoDate === '2026-12-25' ? { name: '1. Weihnachtstag' } : null)
  });

  const mutation = helpers.decideMutationForIsoRange('2026-12-25', '2026-12-25', 'direct-day');
  assert.equal(mutation.allow, false);
  assert.equal(mutation.reason, 'holiday');

  const absenceRangeMutation = helpers.decideMutationForIsoRange('2026-12-24', '2026-12-26', 'absence-range');
  assert.equal(absenceRangeMutation.allow, true);

  const decision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-12-25',
    nextType: 'absence',
    nextAbsenceType: 'vacation',
    mutationKind: 'direct-day'
  });
  assert.equal(decision.decision, 'deny');
  assert.equal(decision.reason, 'holiday');

  const absenceRangeDecision = helpers.resolveDayOverwriteDecision({
    employeeId: 'emp_1',
    fromIso: '2026-12-24',
    toIso: '2026-12-26',
    nextType: 'absence',
    nextAbsenceType: 'vacation',
    mutationKind: 'absence-range'
  });
  assert.equal(absenceRangeDecision.decision, 'allow');
  assert.equal(absenceRangeDecision.reason, 'ok');
});

test('decideMutationForIsoRange denies unknown mutation kinds', () => {
  const helpers = loadOverwriteDecisionHelpers();
  const mutation = helpers.decideMutationForIsoRange('2026-12-24', '2026-12-26', 'unexpected-kind');
  assert.equal(mutation.allow, false);
  assert.equal(mutation.reason, 'invalid-mutation-kind');
});

test('setAbsence vacation/sick over holiday range succeeds, while direct holiday day mutations stay blocked', () => {
  const commits = [];
  const removedShiftRanges = [];
  const savedScheduleEntries = [];
  const clearedPlanDays = [];
  const syncCalls = [];
  const helper = loadMutationApiHelpers({
    getHolidayByDate: (_stateKey, isoDate) => (isoDate === '2026-12-25' ? { name: '1. Weihnachtstag' } : null),
    clearPlanEntry: (employeeId, isoDate) => clearedPlanDays.push([employeeId, isoDate]),
    setScheduleEntry: (employeeId, isoDate, entry) => savedScheduleEntries.push([employeeId, isoDate, entry]),
    replaceAbsenceCoverage: (absences, employeeId, fromIso, toIso, replacementType = null) => {
      if (replacementType === null) {
        removedShiftRanges.push([employeeId, fromIso, toIso]);
        return (absences || []).filter((entry) => (
          entry.employeeId !== employeeId ||
          entry.to < fromIso ||
          entry.from > toIso
        ));
      }
      const remaining = (absences || []).filter((entry) => (
        entry.employeeId !== employeeId ||
        entry.to < fromIso ||
        entry.from > toIso
      ));
      return [...remaining, { id: `new-${replacementType}-${fromIso}`, employeeId, from: fromIso, to: toIso, type: replacementType, note: '' }];
    },
    normalizeAbsences: (absences) => Array.isArray(absences) ? [...absences] : [],
    getPriorityAbsenceForEmployeeOnDate: (absences, employeeId, isoDate) => (
      absences.find((entry) => entry.employeeId === employeeId && isoDate >= entry.from && isoDate <= entry.to) || null
    ),
    syncVacationScheduleFromAbsences: (...args) => syncCalls.push(args),
    commitPlanChange: () => commits.push('commit')
  });

  const vacation = helper.setAbsence('emp_1', '2026-12-24', '2026-12-26', 'vacation', '', { commit: false });
  assert.ok(vacation);
  assert.equal(vacation.type, 'vacation');

  const sick = helper.setAbsence('emp_1', '2026-12-24', '2026-12-26', 'sick', '', { commit: false });
  assert.ok(sick);
  assert.equal(sick.type, 'sick');

  const shiftApplied = helper.setShift('emp_1', '2026-12-25', { type: 'shift', mode: 'early' });
  assert.equal(shiftApplied, false);

  const dayCleared = helper.clearDay('emp_1', '2026-12-25', { commit: false });
  assert.equal(dayCleared, false);

  assert.equal(savedScheduleEntries.length, 0);
  assert.equal(removedShiftRanges.length, 0);
  assert.equal(clearedPlanDays.length, 6);
  assert.equal(syncCalls.length, 0);
  assert.equal(commits.length, 0);
});

test('setShift on holiday is denied as direct-day mutation', () => {
  const helper = loadMutationApiHelpers({
    getHolidayByDate: (_stateKey, isoDate) => (isoDate === '2026-12-25' ? { name: '1. Weihnachtstag' } : null)
  });

  const shiftApplied = helper.setShift('emp_1', '2026-12-25', { type: 'shift', mode: 'early' });
  assert.equal(shiftApplied, false);
});

test('clearDay on holiday is denied as direct-day mutation', () => {
  const helper = loadMutationApiHelpers({
    getHolidayByDate: (_stateKey, isoDate) => (isoDate === '2026-12-25' ? { name: '1. Weihnachtstag' } : null)
  });

  const dayCleared = helper.clearDay('emp_1', '2026-12-25', { commit: false });
  assert.equal(dayCleared, false);
});

test('replaceAbsenceCoverage supports partial replacement in multi-day ranges and keeps untouched edges', () => {
  const result = ctx.replaceAbsenceCoverage(
    [{ employeeId: 'emp_1', type: 'vacation', from: '2026-09-01', to: '2026-09-10', note: '' }],
    'emp_1',
    '2026-09-04',
    '2026-09-06',
    'sick'
  );

  const normalized = JSON.parse(JSON.stringify(
    result
      .map((x) => [x.type, x.from, x.to])
      .sort((a, b) => a.join('|').localeCompare(b.join('|')))
  ));

  assert.deepEqual(normalized, [
    ['sick', '2026-09-04', '2026-09-06'],
    ['vacation', '2026-09-01', '2026-09-03'],
    ['vacation', '2026-09-07', '2026-09-10']
  ]);
});
