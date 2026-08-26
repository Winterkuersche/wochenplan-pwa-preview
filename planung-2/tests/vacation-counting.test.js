const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function loadVacationCounter(contextOverrides = {}) {
  const match = appScript.match(
    /function getUsedVacationDaysFromScheduleForEmployee\(employeeId, year = new Date\(\)\.getFullYear\(\)\) \{[\s\S]*?\n\}\n\nfunction refreshEmployeeVacationCounters/
  );

  assert.ok(match, 'getUsedVacationDaysFromScheduleForEmployee function should be present in app.js');

  const functionSource = match[0].replace(/\n\nfunction refreshEmployeeVacationCounters$/, '');

  const context = vm.createContext({
    state: { schedule: {} },
    isWorkdayForVacation: () => true,
    isVacationScheduleEntry: () => false,
    Date,
    ...contextOverrides
  });

  vm.runInContext(`${functionSource}\nthis.getUsedVacationDaysFromScheduleForEmployee = getUsedVacationDaysFromScheduleForEmployee;`, context, {
    filename: 'app.js'
  });

  return context.getUsedVacationDaysFromScheduleForEmployee;
}

test('vacation counting excludes Schleswig-Holstein holiday from schedule usage', () => {
  const vacationCounter = loadVacationCounter({
    state: {
      schedule: {
        '2026-04-06': { e1: { type: 'vacation' } },
        '2026-04-07': { e1: { type: 'vacation' } },
        '2026-04-08': { e1: { type: 'vacation' } },
        '2026-04-09': { e1: { type: 'vacation' } },
        '2026-04-10': { e1: { type: 'vacation' } },
        '2026-04-11': { e1: { type: 'vacation' } }
      }
    },
    isVacationScheduleEntry: (entry) => entry?.type === 'vacation',
    isWorkdayForVacation: (isoDate, options = {}) => {
      const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
      if (day === 0) return false; // Sunday
      if (options.considerHolidays && isoDate === '2026-04-06') return false; // Ostermontag (SH)
      return true;
    }
  });

  assert.equal(vacationCounter('e1', 2026), 5);
});

test('vacation counting still counts normal non-holiday workdays from schedule', () => {
  const vacationCounter = loadVacationCounter({
    state: {
      schedule: {
        '2026-04-07': { e1: { type: 'vacation' } },
        '2026-04-08': { e1: { type: 'vacation' } }
      }
    },
    isVacationScheduleEntry: (entry) => entry?.type === 'vacation',
    isWorkdayForVacation: (isoDate, options = {}) => {
      const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
      if (day === 0) return false;
      if (options.considerHolidays && isoDate === '2026-04-06') return false;
      return true;
    }
  });

  assert.equal(vacationCounter('e1', 2026), 2);
});
