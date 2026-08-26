const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts([
  'version.js',
  'time-utils.js',
  'date-utils.js',
  'status-utils.js',
  'shift-rules.js',
  'shift-utils.js',
  'absences.js',
  'holidays.js',
  'day-resolution.js',
  'backup-utils.js'
], {
  MASTER_KEY: 'wochenplan_master_v1',
  PLAN_KEY: 'wochenplan_plan_v1',
  UI_KEY: 'wochenplan_ui_v1'
});

test('Smoke A: Mitarbeiter + Schicht setzt Ist-Minuten und Delta-Basis', () => {
  const employee = { id: 'emp-1', target: '30:00' };
  const isoDate = '2026-03-16';
  const shift = ctx.buildEarlyShiftEntry('G');

  const resolved = ctx.getResolvedDayEntry({
    employee,
    isoDate,
    schedule: { [isoDate]: { [employee.id]: shift } },
    absences: [],
    stateKey: 'SH'
  });

  assert.equal(resolved.type, 'shift');
  assert.ok(resolved.minutesForMonth > 0, 'geplante Schicht soll Ist-Minuten liefern');

  const targetPerDay = ctx.getDailyTargetMinutesFromWeeklyHHMM(employee.target);
  const delta = resolved.minutesForMonth - targetPerDay;
  assert.ok(Number.isFinite(delta), 'Delta muss berechenbar sein');
});

test('Smoke B: Urlaub/Krank trimmen und löschen liefert korrekte Reste', () => {
  const vacation = ctx.createAbsenceEntry({
    id: 'vac-1',
    employeeId: 'emp-1',
    type: 'vacation',
    from: '2026-03-10',
    to: '2026-03-14'
  });

  const trimmed = ctx.subtractRangeFromAbsenceEntry(vacation, '2026-03-12', '2026-03-13');
  assert.equal(trimmed.length, 2);
  assert.equal(
    JSON.stringify(trimmed.map((entry) => `${entry.from}:${entry.to}`)),
    JSON.stringify(['2026-03-10:2026-03-11', '2026-03-14:2026-03-14'])
  );

  const deleted = ctx.subtractRangeFromAbsenceEntry(vacation, '2026-03-01', '2026-03-31');
  assert.equal(deleted.length, 0);
});

test('Smoke C: Backup export/import inkl. Legacy-Format bleibt stabil', () => {
  const currentPayload = {
    storage: {
      wochenplan_master_v1: { employees: [] },
      wochenplan_plan_v1: {},
      wochenplan_ui_v1: {}
    }
  };

  const legacyPayload = {
    master: { employees: [] },
    plan: {},
    uiState: {}
  };

  const currentResult = ctx.validateAndNormalizeBackupData(currentPayload);
  assert.equal(currentResult.error, '');
  assert.equal(typeof currentResult.backup?.storage, 'object');

  const legacyResult = ctx.validateAndNormalizeBackupData(legacyPayload);
  assert.equal(legacyResult.error, '');
  assert.equal(typeof legacyResult.backup?.storage, 'object');
});
