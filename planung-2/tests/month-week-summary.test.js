const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts([
  'date-utils.js',
  'time-utils.js',
  'status-utils.js',
  'shift-rules.js',
  'shift-utils.js',
  'absences.js',
  'holidays.js',
  'day-resolution.js',
  'month-engine.js'
]);

test('short week summaries expose compact visible text and complete accessible details', () => {
  const viewCtx = loadScripts([
    'date-utils.js',
    'time-utils.js',
    'month-engine.js',
    'month-view.js'
  ], {
    document: {
      getElementById: () => null,
      addEventListener: () => {},
      body: { style: {}, dataset: {} }
    },
    state: { activeMonth: '2026-08' },
    getEmployeeBranchMinutesForWeek: () => 360,
    getEmployeeTargetMinutesForWeek: () => 480
  });
  const days = currentMonthDays('2026-08');
  const html = viewCtx.buildMonthWeekSummaryRow(days, [{ id: 'e1' }], { includeSummaryColumns: false });

  assert.match(html, /monthWeekSummaryCellCompact[^>]*colspan="2"/);
  assert.match(html, /<span class="monthWeekSummaryCompact">KW 31 · 6 h<\/span>/);
  assert.match(html, /title="KW 31 · Einsatz 6 h · MA-Soll 8 h · Filial-Soll/);
});

function currentMonthDays(yearMonth) {
  return ctx.getMonthPlanFromYearMonth(yearMonth).weeks
    .flat()
    .filter((day) => day.inCurrentMonth);
}

function createSummaryOptions(schedule, absences) {
  return {
    getActualMinutes(employee, days) {
      return days.reduce((sum, day) => sum + ctx.getResolvedDayEntry({
        employee,
        isoDate: day.iso,
        schedule,
        absences,
        stateKey: 'SH'
      }).minutesForBranch, 0);
    },
    getTargetMinutes(employee, days) {
      const dailyTarget = ctx.getAbsenceMinutesForEmployee(employee);
      return days.reduce((sum, day) => (
        ctx.isSundayIsoDate(day.iso) ? sum : sum + dailyTarget
      ), 0);
    }
  };
}

test('groups a complete visible Monday-to-Sunday week and aggregates multiple employees', () => {
  const employees = [
    { id: 'e1', target: '30:00' },
    { id: 'e2', target: '20:00' }
  ];
  const flexShiftWithBreak = ctx.buildFlexibleShiftEntry('09:00', '17:00');
  assert.equal(flexShiftWithBreak.pause, 60);
  assert.equal(flexShiftWithBreak.minutes, 420);

  const schedule = {
    '2026-08-03': { e1: flexShiftWithBreak },
    '2026-08-06': { e1: { type: 'off', status: 'off', label: 'FR' } }
  };
  const absences = [
    { employeeId: 'e1', type: 'vacation', from: '2026-08-04', to: '2026-08-04' },
    { employeeId: 'e2', type: 'sick', from: '2026-08-05', to: '2026-08-05' }
  ];

  const summaries = ctx.getMonthWeekSummaries(
    currentMonthDays('2026-08'),
    employees,
    createSummaryOptions(schedule, absences)
  );
  const fullWeek = summaries.find((summary) => summary.week === 32);

  assert.deepEqual(JSON.parse(JSON.stringify(fullWeek.days.map((day) => day.iso))), [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
    '2026-08-07', '2026-08-08', '2026-08-09'
  ]);
  assert.equal(fullWeek.actualMinutes, 420);
  assert.equal(fullWeek.targetMinutes, (300 + 200) * 6);
  assert.equal(fullWeek.branchTargetMinutes, 159 * 60);
});

test('counts only visible month days in a calendar week cut at the month start', () => {
  const employees = [{ id: 'e1', target: '30:00' }, { id: 'e2', target: '20:00' }];
  const schedule = {
    '2026-08-01': { e2: ctx.buildFlexibleShiftEntry('09:00', '13:00') }
  };

  const firstWeek = ctx.getMonthWeekSummaries(
    currentMonthDays('2026-08'),
    employees,
    createSummaryOptions(schedule, [])
  )[0];

  assert.equal(firstWeek.week, 31);
  assert.deepEqual(JSON.parse(JSON.stringify(firstWeek.days.map((day) => day.iso))), ['2026-08-01', '2026-08-02']);
  assert.equal(firstWeek.actualMinutes, 240);
  assert.equal(firstWeek.targetMinutes, 300 + 200);
  assert.equal(firstWeek.branchTargetMinutes, (159 * 60) / 6);
});

test('counts only visible month days in a calendar week cut at the month end', () => {
  const employees = [{ id: 'e1', target: '30:00' }, { id: 'e2', target: '20:00' }];
  const absences = [
    { employeeId: 'e1', type: 'vacation', from: '2026-08-31', to: '2026-08-31' }
  ];

  const summaries = ctx.getMonthWeekSummaries(
    currentMonthDays('2026-08'),
    employees,
    createSummaryOptions({}, absences)
  );
  const lastWeek = summaries[summaries.length - 1];

  assert.equal(lastWeek.week, 36);
  assert.deepEqual(JSON.parse(JSON.stringify(lastWeek.days.map((day) => day.iso))), ['2026-08-31']);
  assert.equal(lastWeek.actualMinutes, 0);
  assert.equal(lastWeek.targetMinutes, 300 + 200);
  assert.equal(lastWeek.branchTargetMinutes, (159 * 60) / 6);
  assert.equal(ctx.formatMinutesAsDecimalHours(lastWeek.actualMinutes), '0');
  assert.equal(ctx.formatMinutesAsDecimalHours(300), '5');
  assert.equal(ctx.formatMinutesAsDecimalHours(90), '1,5');
});

test('counts branch shifts but excludes external-help hours from the weekly total', () => {
  const employees = [{ id: 'e1', target: '30:00' }];
  const schedule = {
    '2026-08-03': { e1: ctx.buildFlexibleShiftEntry('09:00', '17:00') },
    '2026-08-04': {
      e1: { type: 'external-help', status: 'external', label: 'AH', branch: 'Kiel', minutes: 480 }
    },
    '2026-08-05': { e1: ctx.buildFlexibleShiftEntry('09:00', '13:00') }
  };

  const fullWeek = ctx.getMonthWeekSummaries(
    currentMonthDays('2026-08'),
    employees,
    createSummaryOptions(schedule, [])
  ).find((summary) => summary.week === 32);

  assert.equal(fullWeek.actualMinutes, 420 + 240);
});

test('ISO calendar-week logic handles week-year boundaries', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.getIsoCalendarWeek(new Date(2027, 0, 1)))),
    { year: 2026, week: 53 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.getIsoCalendarWeek(new Date(2027, 0, 4)))),
    { year: 2027, week: 1 }
  );
});
