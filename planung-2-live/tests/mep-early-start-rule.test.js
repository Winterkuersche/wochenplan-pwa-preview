const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const previousWorkdayMatch = appScript.match(/function getPreviousRelevantWorkdayIso\(isoDate\) \{[\s\S]*?\n\}/);
const normalizeCarryoverStartMatch = appScript.match(/function normalizeShiftStartForCarryoverEligibility\(value\) \{[\s\S]*?\n\}/);
const carryoverEligibilityMatch = appScript.match(/function isCarryoverMorningEligibleShift\(entry\) \{[\s\S]*?\n\}/);
const applyRuleMatch = appScript.match(/function applyMepEarlyStartCarryoverRule\(isoDate, options = \{\}\) \{[\s\S]*?\n\}/);
const applyRangeRuleMatch = appScript.match(/function applyMepEarlyStartRuleForRange\(fromIso, toIso, options = \{\}\) \{[\s\S]*?\n\}/);

assert.ok(previousWorkdayMatch, 'getPreviousRelevantWorkdayIso should exist in app.js');
assert.ok(normalizeCarryoverStartMatch, 'normalizeShiftStartForCarryoverEligibility should exist in app.js');
assert.ok(carryoverEligibilityMatch, 'isCarryoverMorningEligibleShift should exist in app.js');
assert.ok(applyRuleMatch, 'applyMepEarlyStartCarryoverRule should exist in app.js');
assert.ok(applyRangeRuleMatch, 'applyMepEarlyStartRuleForRange should exist in app.js');

function buildContext({ employees, schedule }) {
  const state = {
    employees: employees.map((emp) => ({ ...emp })),
    schedule: structuredClone(schedule || {})
  };
  let commitCount = 0;

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
    getPlanEntry: (employeeId, isoDate) => {
      const entry = state.schedule?.[isoDate]?.[employeeId];
      return entry ? { ...entry } : null;
    },
    updateEmployeeDay: (employeeId, isoDate, updater) => {
      const current = state.schedule?.[isoDate]?.[employeeId];
      const next = updater(current ? { ...current } : null);
      if (!next) return null;
      if (!state.schedule[isoDate]) state.schedule[isoDate] = {};
      state.schedule[isoDate][employeeId] = { ...next };
      return state.schedule[isoDate][employeeId];
    },
    commitPlanChange: () => {
      commitCount += 1;
    }
  });

  vm.runInContext(
    `${previousWorkdayMatch[0]}; ${normalizeCarryoverStartMatch[0]}; ${carryoverEligibilityMatch[0]}; ${applyRuleMatch[0]}; ${applyRangeRuleMatch[0]}; this.applyMepEarlyStartCarryoverRule = applyMepEarlyStartCarryoverRule; this.applyMepEarlyStartRuleForRange = applyMepEarlyStartRuleForRange;`,
    context,
    { filename: 'app.js' }
  );

  return {
    applyRule: context.applyMepEarlyStartCarryoverRule,
    applyRuleForRange: context.applyMepEarlyStartRuleForRange,
    state,
    getCommitCount: () => commitCount
  };
}

test('sets exactly one 08:55 when a worker had 19:10 on previous day', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' },
        e2: { type: 'shift', end: '18:00' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00', pause: 30, minutes: 450, mode: 'fixed', code: 'FO' },
        e2: { type: 'shift', start: '09:30', end: '17:15', pause: 30, minutes: 450, mode: 'fixed', code: 'FO' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.end, '17:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '09:30');
  assert.equal(ctx.getCommitCount(), 1);
});

test('individual previous-day FLEX shift triggers unchanged opener priority', () => {
  const shifts = loadScripts(['time-utils.js', 'shift-rules.js', 'shift-utils.js']);
  const individualLate = shifts.buildIndividualCheckoutShiftEntry('13:00');
  assert.equal(individualLate.end, '19:10');
  const ctx = buildContext({
    employees: [{ id: 'regular' }, { id: 'sv', roleKey: 'SV' }, { id: 'tl', roleKey: 'TL' }],
    schedule: {
      '2026-04-10': {
        regular: structuredClone(individualLate),
        sv: structuredClone(individualLate),
        tl: structuredClone(individualLate)
      },
      '2026-04-11': {
        regular: { type: 'shift', start: '09:00', end: '15:00' },
        sv: { type: 'shift', start: '09:00', end: '15:00' },
        tl: { type: 'shift', start: '09:00', end: '15:00' }
      }
    }
  });

  assert.equal(ctx.applyRule('2026-04-11'), 'tl');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].sv.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].regular.start, '09:00');
});

test('stronger MA responsibility continuity wins even from lower employee-list position', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', start: '13:00', end: '19:10' },
        e2: { type: 'shift', start: '09:00', end: '19:10' },
        e3: { type: 'shift', end: '18:00' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '09:00', end: '19:10' },
        e3: { type: 'shift', start: '09:00', end: '17:00' }
      },
      '2026-04-13': {
        e2: { type: 'shift', start: '09:00', end: '19:10' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e2');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '08:55');
});

test('responsibility selection is independent of employee-list order', () => {
  const schedule = {
    '2026-04-09': { steady: { type: 'shift', start: '09:00', end: '19:10' } },
    '2026-04-10': {
      brief: { type: 'shift', start: '13:00', end: '19:10' },
      steady: { type: 'shift', start: '09:00', end: '19:10' }
    },
    '2026-04-11': {
      brief: { type: 'shift', start: '09:00', end: '17:00' },
      steady: { type: 'shift', start: '09:00', end: '17:00' }
    }
  };
  const forward = buildContext({ employees: [{ id: 'brief' }, { id: 'steady' }], schedule });
  const reversed = buildContext({ employees: [{ id: 'steady' }, { id: 'brief' }], schedule });

  assert.equal(forward.applyRule('2026-04-11'), 'steady');
  assert.equal(reversed.applyRule('2026-04-11'), 'steady');
});

test('continuous MA responsibility block wins on every shared candidate morning regardless of employee order', () => {
  const schedule = {
    '2026-04-06': {
      b: { type: 'shift', start: '09:00', end: '19:10' },
      c: { type: 'shift', start: '13:00', end: '19:10' }
    },
    '2026-04-07': {
      b: { type: 'shift', start: '09:00', end: '19:10' },
      c: { type: 'shift', start: '09:00', end: '19:10' }
    },
    '2026-04-08': {
      b: { type: 'shift', start: '09:00', end: '19:10' },
      c: { type: 'shift', start: '09:00', end: '17:00' }
    },
    '2026-04-09': {
      b: { type: 'shift', start: '09:00', end: '19:10' },
      c: { type: 'shift', start: '09:00', end: '17:00' }
    }
  };

  for (const employees of [[{ id: 'c' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]]) {
    const ctx = buildContext({ employees, schedule });

    assert.equal(ctx.applyRule('2026-04-07'), 'b');
    assert.equal(ctx.state.schedule['2026-04-07'].b.start, '08:55');
    assert.equal(ctx.state.schedule['2026-04-07'].c.start, '09:00');
    assert.equal(ctx.applyRule('2026-04-08'), 'b');
    assert.equal(ctx.state.schedule['2026-04-08'].b.start, '08:55');
    assert.equal(ctx.state.schedule['2026-04-08'].c.start, '09:00');
  }
});

test('selects TL only when TL had 19:10 on previous day', () => {
  const initialSchedule = {
    '2026-04-10': {
      tl: { type: 'shift', end: '19:10' },
      e1: { type: 'shift', end: '19:10' }
    },
    '2026-04-11': {
      tl: { type: 'shift', start: '09:00', end: '17:00' },
      e1: { type: 'shift', start: '08:55', end: '17:00' }
    }
  };
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'e1' }],
    schedule: initialSchedule
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'tl');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:00');
  assert.equal(ctx.getCommitCount(), 1);
});

test('selects SV only when SV had 19:10 on previous day', () => {
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'sv', roleKey: 'SV' }, { id: 'e1' }],
    schedule: {
      '2026-04-10': {
        sv: { type: 'shift', end: '19:10' },
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        sv: { type: 'shift', start: '09:00', end: '17:00' },
        e1: { type: 'shift', start: '08:55', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'sv');
  assert.equal(ctx.state.schedule['2026-04-11'].sv.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:00');
});

test('does not select TL when TL had no 19:10 on previous day', () => {
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'e1' }],
    schedule: {
      '2026-04-10': {
        tl: { type: 'shift', end: '18:00' },
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        tl: { type: 'shift', start: '08:55', end: '17:00' },
        e1: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
});

test('does not select SV when SV had no 19:10 on previous day', () => {
  const ctx = buildContext({
    employees: [{ id: 'sv', roleKey: 'SV' }, { id: 'e1' }],
    schedule: {
      '2026-04-10': {
        sv: { type: 'shift', end: '18:00' },
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        sv: { type: 'shift', start: '08:55', end: '17:00' },
        e1: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].sv.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
});

test('recognizes SV variants from function fields (e.g. "Stv")', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1', functionKey: ' Stv ' }, { id: 'e2' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' },
        e2: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '08:55', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '09:00');
});

test('does not select SV variant from function fields without own previous-day 19:10', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1', functionKey: 'Stv' }, { id: 'e2' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '18:00' },
        e2: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '08:55', end: '17:00' },
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e2');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '08:55');
});

test('uses a stable id tie-break when same-role continuity is equal', () => {
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'sv', roleKey: 'SV' }, { id: 'e2' }, { id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' },
        e2: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '09:00');
});

test('prioritizes within eligible candidates as TL > SV > others', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'sv', roleKey: 'SV' }, { id: 'tl', roleKey: 'TL' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' },
        sv: { type: 'shift', end: '19:10' },
        tl: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '08:55', end: '17:00' },
        sv: { type: 'shift', start: '08:55', end: '17:00' },
        tl: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'tl');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].sv.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:00');
});

test('does not select TL with previous-day 19:10 when today starts at 13:00', () => {
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'e1' }],
    schedule: {
      '2026-04-10': {
        tl: { type: 'shift', end: '19:10' },
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        tl: { type: 'shift', start: '13:00', end: '21:00' },
        e1: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '13:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
});

test('does not set 08:55 when only candidate has late shift start 13:00', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', mode: 'late', code: 'L', start: '13:00', end: '19:10' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, null);
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '13:00');
  assert.equal(ctx.getCommitCount(), 0);
});

test('does not set 08:55 when only candidate starts at 10:00', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', mode: 'full', code: 'G', start: '10:00', end: '16:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, null);
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '10:00');
  assert.equal(ctx.getCommitCount(), 0);
});

test('keeps early/day shifts eligible for 08:55 carryover', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', mode: 'full', code: 'G', start: '09:00', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
  assert.equal(ctx.getCommitCount(), 1);
});

test('does not set 08:55 when only candidate starts at 09:15', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:15', end: '17:00' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');
  assert.equal(selectedId, null);
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:15');
});

test('does not set 08:55 when only candidate starts at 09:30', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:30', end: '17:30' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-11');
  assert.equal(selectedId, null);
  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '09:30');
});

test('resets additional 08:55 starts on same day to 09:00', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '08:55', end: '16:00' },
        e3: { type: 'shift', start: '08:55', end: '15:00' }
      }
    }
  });

  ctx.applyRule('2026-04-11');

  assert.equal(ctx.state.schedule['2026-04-11'].e1.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].e2.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-11'].e3.start, '09:00');
});

test('applies reconciliation for a date range with a single commit', () => {
  const ctx = buildContext({
    employees: [{ id: 'tl', roleKey: 'TL' }, { id: 'sv', roleKey: 'SV' }, { id: 'e3' }],
    schedule: {
      '2026-04-10': {
        tl: { type: 'shift', end: '19:10' },
        sv: { type: 'shift', end: '18:00' },
        e3: { type: 'shift', end: '18:00' }
      },
      '2026-04-11': {
        tl: { type: 'shift', start: '09:00', end: '17:00' },
        sv: { type: 'shift', start: '08:55', end: '16:00' },
        e3: { type: 'shift', start: '09:00', end: '17:00' }
      },
      '2026-04-12': {
        tl: { type: 'shift', start: '09:00', end: '17:00' },
        sv: { type: 'shift', start: '08:55', end: '17:00' },
        e3: { type: 'shift', start: '09:00', end: '17:00' }
      },
      '2026-04-13': {
        tl: { type: 'shift', start: '08:55', end: '17:00' },
        sv: { type: 'shift', start: '09:00', end: '17:00' },
        e3: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const result = ctx.applyRuleForRange('2026-04-11', '2026-04-13');

  assert.equal(result.changed, true);
  assert.equal(result.changedDays, 1);
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].sv.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-12'].tl.start, '09:00');
  assert.equal(ctx.state.schedule['2026-04-12'].sv.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-13'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-13'].sv.start, '09:00');
  assert.equal(ctx.getCommitCount(), 1);
});

test('does not commit when range reconciliation makes no changes', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }],
    schedule: {
      '2026-04-10': {
        e1: { type: 'shift', end: '18:00' }
      },
      '2026-04-11': {
        e1: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  const result = ctx.applyRuleForRange('2026-04-11', '2026-04-11');

  assert.equal(result.changed, false);
  assert.equal(result.changedDays, 0);
  assert.equal(ctx.getCommitCount(), 0);
});

test('uses previous relevant workday for monday so saturday 19:10 enables 08:55 on monday', () => {
  const ctx = buildContext({
    employees: [{ id: 'e1' }, { id: 'e2' }],
    schedule: {
      '2026-04-11': {
        e1: { type: 'shift', end: '19:10' }
      },
      '2026-04-13': {
        e1: { type: 'shift', start: '09:00', end: '17:00' },
        e2: { type: 'shift', start: '09:15', end: '17:15' }
      }
    }
  });

  const selectedId = ctx.applyRule('2026-04-13');

  assert.equal(selectedId, 'e1');
  assert.equal(ctx.state.schedule['2026-04-13'].e1.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-13'].e2.start, '09:15');
});

test('TL role beats an MA with a longer responsibility chain', () => {
  const ctx = buildContext({
    employees: [{ id: 'ma' }, { id: 'tl', roleKey: 'TL' }],
    schedule: {
      '2026-04-09': { ma: { type: 'shift', start: '09:00', end: '19:10' } },
      '2026-04-10': {
        ma: { type: 'shift', start: '09:00', end: '19:10' },
        tl: { type: 'shift', start: '13:00', end: '19:10' }
      },
      '2026-04-11': {
        ma: { type: 'shift', start: '09:00', end: '19:10' },
        tl: { type: 'shift', start: '09:00', end: '17:00' }
      },
      '2026-04-13': { ma: { type: 'shift', start: '09:00', end: '19:10' } }
    }
  });

  assert.equal(ctx.applyRule('2026-04-11'), 'tl');
  assert.equal(ctx.state.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].ma.start, '09:00');
});

test('SV/STV role beats an MA when no eligible TL exists', () => {
  const ctx = buildContext({
    employees: [{ id: 'ma' }, { id: 'stv', funktion: 'STV' }],
    schedule: {
      '2026-04-09': { ma: { type: 'shift', start: '09:00', end: '19:10' } },
      '2026-04-10': {
        ma: { type: 'shift', start: '09:00', end: '19:10' },
        stv: { type: 'shift', start: '13:00', end: '19:10' }
      },
      '2026-04-11': {
        ma: { type: 'shift', start: '09:00', end: '19:10' },
        stv: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.applyRule('2026-04-11'), 'stv');
  assert.equal(ctx.state.schedule['2026-04-11'].stv.start, '08:55');
  assert.equal(ctx.state.schedule['2026-04-11'].ma.start, '09:00');
});

test('another eligible candidate takes over when the previous key holder is unavailable in the morning', () => {
  const ctx = buildContext({
    employees: [{ id: 'holder' }, { id: 'backup' }],
    schedule: {
      '2026-04-10': {
        holder: { type: 'shift', start: '09:00', end: '19:10' },
        backup: { type: 'shift', start: '09:00', end: '19:10' }
      },
      '2026-04-11': {
        holder: { type: 'absence', code: 'U' },
        backup: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.applyRule('2026-04-11'), 'backup');
  assert.equal(ctx.state.schedule['2026-04-11'].backup.start, '08:55');
});

test('a later 09:00-19:10 run starts a new responsibility chain after an absence', () => {
  const ctx = buildContext({
    employees: [{ id: 'returning' }, { id: 'other' }],
    schedule: {
      '2026-04-10': { returning: { type: 'absence', code: 'K' } },
      '2026-04-11': {
        returning: { type: 'shift', start: '09:00', end: '19:10' },
        other: { type: 'shift', start: '09:00', end: '19:10' }
      },
      '2026-04-13': {
        returning: { type: 'shift', start: '09:00', end: '19:10' },
        other: { type: 'shift', start: '13:00', end: '19:10' }
      },
      '2026-04-14': {
        returning: { type: 'shift', start: '09:00', end: '19:10' },
        other: { type: 'shift', start: '09:00', end: '17:00' }
      }
    }
  });

  assert.equal(ctx.applyRule('2026-04-14'), 'returning');
  const starts = Object.values(ctx.state.schedule['2026-04-14']).map((entry) => entry.start);
  assert.equal(starts.filter((start) => start === '08:55').length, 1);
});
