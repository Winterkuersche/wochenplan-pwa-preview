const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadRealPlanning2Domain() {
  const context = vm.createContext({ console, structuredClone, Date, JSON, Math, Object, Array, Map, Set, Number, String, Boolean, RegExp });
  context.globalThis = context;
  for (const file of [
    'holidays.js', 'time-utils.js', 'employee-availability.js', 'shift-rules.js', 'date-utils.js',
    'shift-utils.js', 'status-utils.js', 'contract-models.js', 'absences.js',
    'planning2-domain-helpers.js', 'day-resolution.js', 'planning2-playground-optimizer.js'
  ]) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

test('E3 evaluates a working-plan copy with the real project domain helpers', () => {
  const api = loadRealPlanning2Domain();
  const early = { id: 'early', roleKey: 'TZ', contractModel: 'TZ30', target: '30:00', timePreference: 'early', flexibleWeekDistribution: false };
  const gfb = { id: 'gfb', roleKey: 'GFB', target: '10:00', timePreference: 'any', flexibleWeekDistribution: true };
  const longShift = api.buildFlexibleShiftEntry('09:00', '17:00');
  const gfbShift = api.buildFlexibleShiftEntry('09:00', '12:00');
  assert.equal(longShift.breakMinutes, 60);
  assert.equal(longShift.minutes, 420);

  const plan = {
    stateKey: 'schleswig-holstein',
    schedule: {
      '2026-10-01': { early: longShift },
      '2026-10-06': { early: { type: 'off', status: 'off' } },
      '2026-10-07': { gfb: gfbShift }
    },
    absences: [
      { id: 'u', employeeId: 'early', type: 'vacation', from: '2026-10-02', to: '2026-10-02' },
      { id: 'k', employeeId: 'early', type: 'sick', from: '2026-10-05', to: '2026-10-05' }
    ]
  };
  const profile = api.Planning2PlaygroundOptimizer.evaluateVariantFacts(plan, [], {
    yearMonth: '2026-10', stateKey: 'schleswig-holstein', sourceEmployees: [early, gfb]
  });
  const normal = profile.employeeBalances.find(value => value.employeeId === 'early');
  assert.equal(normal.targetMinutes, 7830);
  assert.equal(normal.plannedMinutes, 420);
  assert.equal(normal.creditedAbsenceMinutes, 1200); // vacation + sick + both real October holidays
  assert.equal(profile.unpaidPauseMinutes, 60);
  assert.equal(profile.gfbBudgetMinutes, 2580);
  assert.equal(profile.gfbUsedMinutes, 380); // shift plus the two central GFB holiday credits
  assert.equal(profile.preferenceViolations.length, 0);
  assert.equal(profile.weeklyDistributionPenalty > 0, true);
  assert.equal(profile.availability.demandBufferEmployeeMinutes, false);
});

test('Saturday facts retain the maximum run when the final Saturday is free', () => {
  const api = loadRealPlanning2Domain();
  const employee = { id: 'a', roleKey: 'TZ', contractModel: 'TZ20', target: '20:00', timePreference: 'any' };
  const shift = api.buildFlexibleShiftEntry('09:00', '12:00');
  const schedule = {};
  for (const isoDate of ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22']) schedule[isoDate] = { a: shift };
  schedule['2026-08-29'] = { a: { type: 'off', status: 'off' } };
  const profile = api.Planning2PlaygroundOptimizer.evaluateVariantFacts({ schedule, absences: [] }, [], { yearMonth: '2026-08', sourceEmployees: [employee] });
  assert.deepEqual(JSON.parse(JSON.stringify(profile.saturdayFacts[0])), {
    employeeId: 'a', workedSaturdays: 4, currentConsecutiveWorkedSaturdays: 0, maxConsecutiveWorkedSaturdays: 4
  });
  assert.equal(profile.saturdayPenalty, 1);
});
