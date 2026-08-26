const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const previousWorkdayMatch = appScript.match(/function getPreviousRelevantWorkdayIso\(isoDate\) \{[\s\S]*?\n\}/);
const normalizeCarryoverStartMatch = appScript.match(/function normalizeShiftStartForCarryoverEligibility\(value\) \{[\s\S]*?\n\}/);
const carryoverEligibilityMatch = appScript.match(/function isCarryoverMorningEligibleShift\(entry\) \{[\s\S]*?\n\}/);
const carryoverWarningMatch = appScript.match(/function hasMissingCarryoverCoverageForIso\(iso\) \{[\s\S]*?\n\}/);

assert.ok(previousWorkdayMatch, 'getPreviousRelevantWorkdayIso should exist in app.js');
assert.ok(normalizeCarryoverStartMatch, 'normalizeShiftStartForCarryoverEligibility should exist in app.js');
assert.ok(carryoverEligibilityMatch, 'isCarryoverMorningEligibleShift should exist in app.js');
assert.ok(carryoverWarningMatch, 'hasMissingCarryoverCoverageForIso should exist in app.js');

function buildContext({ employees, schedule }) {
  const state = {
    employees: employees.map((emp) => ({ ...emp })),
    schedule: structuredClone(schedule || {})
  };

  const context = vm.createContext({
    state,
    shiftIsoDateByDays: (isoDate, dayOffset) => {
      const date = new Date(`${isoDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dayOffset);
      return date.toISOString().slice(0, 10);
    },
    isEmployeeActiveInMonth: (employee, yearMonth) => {
      const from = employee.activeFromMonth || '';
      const to = employee.activeToMonth || '';
      if (from && yearMonth < from) return false;
      if (to && yearMonth > to) return false;
      return true;
    },
    getScheduleEntry: (employeeId, isoDate) => {
      const entry = state.schedule?.[isoDate]?.[employeeId];
      return entry ? { ...entry } : null;
    },
    isSundayIsoDate: (isoDate) => {
      const date = new Date(`${isoDate}T00:00:00Z`);
      return date.getUTCDay() === 0;
    }
  });

  vm.runInContext(
    `${previousWorkdayMatch[0]}; ${normalizeCarryoverStartMatch[0]}; ${carryoverEligibilityMatch[0]}; ${carryoverWarningMatch[0]}; this.hasMissingCarryoverCoverageForIso = hasMissingCarryoverCoverageForIso;`,
    context,
    { filename: 'app.js' }
  );

  return {
    hasMissingCarryoverCoverageForIso: context.hasMissingCarryoverCoverageForIso
  };
}

test('warns when saturday 19:10 team has no one scheduled on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' },
        e2: { type: 'shift', end: '18:00' }
      },
      '2026-04-13': {
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), true);
});

test('does not warn when at least one saturday 19:10 worker is scheduled on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' },
        e2: { type: 'shift', end: '18:00' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), false);
});

test('warns when saturday 19:10 worker is only in late shift (13:00) on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '13:00', end: '21:00' },
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), true);
});

test('does not warn when saturday 19:10 worker starts exactly at 09:00 on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '13:00', end: '21:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), false);
});

test('warns in weekday sequence when previous-day 19:10 worker has only late shift next day', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-14': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-15': {
        e1: { type: 'shift', start: '13:00', end: '21:00' },
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-15'), true);
});

test('does not warn in weekday sequence when previous-day 19:10 worker starts exactly at 09:00 next day', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-14': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-15': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '13:00', end: '21:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-15'), false);
});

test('warns when saturday 19:10 worker starts at 09:15 on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '09:15', end: '17:15' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), true);
});

test('warns when saturday 19:10 worker starts at 09:30 on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '09:30', end: '17:30' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), true);
});

test('warns when saturday 19:10 worker starts at 10:00 on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '10:00', end: '16:00' }
      }
    }
  });

  assert.equal(ctx.hasMissingCarryoverCoverageForIso('2026-04-13'), true);
});
