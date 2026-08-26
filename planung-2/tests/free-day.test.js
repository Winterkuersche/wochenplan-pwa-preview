const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

function buildContext() {
  return loadScripts(['day-resolution.js'], {
    ENTRY_STATUS: {
      EMPTY: 'empty',
      OFF: 'off',
      WORK: 'work',
      EXTERNAL: 'external',
      VACATION: 'vacation',
      SICK: 'sick'
    },
    getEntryStatus: (entry) => entry?.status || 'empty',
    getPriorityAbsenceForEmployeeOnDate: () => null,
    isSundayIsoDate: () => false,
    getHolidayByDate: () => null,
    getAbsenceMinutesForEmployee: () => 0,
    getStatusShortLabel: () => '',
    isShiftEntry: (entry) => entry?.type === 'shift',
    getShiftDisplayLabel: () => 'Shift'
  });
}

test('planned Frei day resolves as off with zero minutes', () => {
  const ctx = buildContext();
  const resolved = ctx.getResolvedDayEntry({
    employee: { id: 'e1' },
    isoDate: '2026-04-15',
    schedule: {
      '2026-04-15': {
        e1: { type: 'off', status: 'off', label: 'FR', minutes: 0 }
      }
    },
    absences: [],
    stateKey: 'de-nw'
  });

  assert.equal(resolved.type, 'off');
  assert.equal(resolved.status, 'off');
  assert.equal(resolved.label, 'FR');
  assert.equal(resolved.minutesForMonth, 0);
  assert.equal(resolved.minutesForBranch, 0);
});

test('planned Frei day is not resolved as shift', () => {
  const ctx = buildContext();
  const resolved = ctx.getResolvedDayEntry({
    employee: { id: 'e1' },
    isoDate: '2026-04-16',
    schedule: {
      '2026-04-16': {
        e1: { type: 'off', status: 'off', label: 'FR', minutes: 0 }
      }
    },
    absences: [],
    stateKey: 'de-nw'
  });

  assert.notEqual(resolved.type, 'shift');
});
