const test = require('node:test');
const assert = require('node:assert/strict');
const Optimizer = require('../planning2-playground-optimizer.js');

const facts = extra => Optimizer._test.normalizeVariantFacts(extra, extra.mutations || [], { selectedWeeks: ['2026-09-07'], baselineFacts: { understaffingMinutes: 240 } }, {});
const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
function centralContext(extra = {}) {
  return {
    yearMonth: '2026-09', stateKey: 'schleswig-holstein',
    getContractTargetMinutesPerMonth: employee => employee.roleKey === 'GFB' ? 2580 : employee.centralMonthTarget,
    isGfbEmployee: employee => employee.roleKey === 'GFB',
    getAbsenceMinutesForEmployee: employee => employee.centralDailyTarget,
    getPreferenceFacts: employee => ({ timePreference: employee.timePreference || 'any', flexibleWeekDistribution: employee.flexibleWeekDistribution === true }),
    hhmmToMinutes: minutes,
    getRequiredBreakMinutes: (start, end) => minutes(end) - minutes(start) > 360 ? 30 : 0,
    resolveDayEntry({ employee, isoDate, schedule, absences }) {
      const sourceEntry = schedule[isoDate]?.[employee.id] || null;
      if (isoDate === extra.holidayIso) return { type: 'holiday', minutesForMonth: employee.centralDailyTarget, sourceEntry: { name: 'central holiday' } };
      const absence = absences.find(value => value.employeeId === employee.id && value.from <= isoDate && value.to >= isoDate);
      if (absence) return { type: absence.type, minutesForMonth: employee.centralDailyTarget, sourceEntry: absence };
      if (sourceEntry?.type === 'shift') return { type: 'shift', minutesForMonth: sourceEntry.minutes, sourceEntry };
      return { type: 'off', minutesForMonth: 0, sourceEntry };
    }, ...extra
  };
}

test('coverage is lexicographically stronger than stability and justified plus', () => {
  const covered = facts({ understaffingMinutes: 0, totalUnnecessaryPlusMinutes: 180, changeCount: 8 });
  const stable = facts({ understaffingMinutes: 120, totalUnnecessaryPlusMinutes: 0, changeCount: 1 });
  assert.ok(Optimizer.compareDomainFacts(covered, stable) < 0);
});

test('equal coverage prefers less unnecessary plus and old minus makes hours useful', () => {
  assert.ok(Optimizer.compareDomainFacts(facts({ understaffingMinutes: 0, totalUnnecessaryPlusMinutes: 0 }), facts({ understaffingMinutes: 0, totalUnnecessaryPlusMinutes: 60 })) < 0);
  const plan = { schedule: { '2026-09-08': { minus: { type: 'shift', start: '09:00', end: '13:00', minutes: 240 } } }, absences: [] };
  const profile = Optimizer.evaluateVariantFacts(plan, [{ isoDate: '2026-09-08', employeeId: 'minus' }], centralContext({ sourceEmployees: [{ id: 'minus', centralMonthTarget: 300, centralDailyTarget: 50 }], carryInMinusMinutesByEmployee: { minus: 60 } }));
  assert.equal(profile.employeeBalances[0].projectedBalanceMinutes, -120);
  assert.equal(profile.totalMinusMinutes, 120);
});

test('vacation, sick and holiday credit weekly hours divided by six, off does not', () => {
  const schedule = { '2026-09-04': { a: { type: 'off' } } };
  const absences = [{ employeeId: 'a', type: 'vacation', from: '2026-09-01', to: '2026-09-01' }, { employeeId: 'a', type: 'sick', from: '2026-09-02', to: '2026-09-02' }];
  const profile = Optimizer.evaluateVariantFacts({ schedule, absences }, [], centralContext({ holidayIso: '2026-09-03', sourceEmployees: [{ id: 'a', centralDailyTarget: 300, centralMonthTarget: 1200 }] }));
  assert.equal(profile.employeeBalances[0].creditedAbsenceMinutes, 900);
});

test('GFB over budget is hard-invalid even when simulator says valid', () => {
  const session = { workingPlan: { schedule: {} }, selectedWeeks: ['2026-09-07'], locks: [] };
  const candidate = { candidateId: 'g', mutations: [{ isoDate: '2026-09-08', employeeId: 'g', after: { start: '09:00', end: '12:00' } }] };
  const result = Optimizer.run(session, { today: '2026-09-01', candidates: [candidate], simulateState: () => ({ valid: true, simulatedPlan: { schedule: {} }, domainFacts: { gfbBudgetMinutes: 2580, gfbUsedMinutes: 2640 } }) });
  assert.equal(result.variants.length, 0);
});

test('useful GFB, weekly distribution, Saturday and preferences are explicit soft levels', () => {
  assert.ok(Optimizer.compareDomainFacts(facts({ gfbUsefulUtilization: 180 }), facts({ gfbUsefulUtilization: 0 })) < 0);
  assert.ok(Optimizer.compareDomainFacts(facts({ weeklyDistributionPenalty: 0 }), facts({ weeklyDistributionPenalty: 60 })) < 0);
  assert.ok(Optimizer.compareDomainFacts(facts({ saturdayPenalty: 0 }), facts({ saturdayPenalty: 1 })) < 0);
  assert.ok(Optimizer.compareDomainFacts(facts({ preferenceViolationMinutes: 0 }), facts({ preferenceViolationMinutes: 60 })) < 0);
});

test('missing optional facts remain unknown and are not ranked as an optimal zero', () => {
  const unknown = facts({ understaffingMinutes: 0 });
  const evaluated = facts({ understaffingMinutes: 0, demandBufferEmployeeMinutes: 10, usefulAdditionalHeads: 1 });
  assert.equal(unknown.demandBufferEmployeeMinutes, null);
  assert.equal(unknown.availability.demandBufferEmployeeMinutes, false);
  assert.equal(Optimizer.compareDomainFacts(unknown, evaluated), 0);
  assert.equal(Optimizer.compareDomainFacts(evaluated, unknown), 0);
});

test('central GFB, break, preference, Saturday and flexible-week facts feed the profile', () => {
  const employees = [
    { id: 'g', roleKey: 'GFB', centralDailyTarget: 430, timePreference: 'early' },
    { id: 'fixed', roleKey: 'TZ', centralMonthTarget: 1000, centralDailyTarget: 100, timePreference: 'late', flexibleWeekDistribution: false },
    { id: 'flex', roleKey: 'TZ', centralMonthTarget: 1000, centralDailyTarget: 100, flexibleWeekDistribution: true }
  ];
  const schedule = {};
  ['05', '12', '19', '26'].forEach(day => { schedule[`2026-09-${day}`] = { g: { type: 'shift', start: '15:00', end: '19:00', minutes: 240 } }; });
  schedule['2026-09-07'] = { fixed: { type: 'shift', start: '09:00', end: '17:00', minutes: 450 }, flex: { type: 'shift', start: '09:00', end: '17:00', minutes: 450 } };
  const profile = Optimizer.evaluateVariantFacts({ schedule, absences: [] }, [], centralContext({ sourceEmployees: employees }));
  assert.equal(profile.gfbBudgetMinutes, 2580); assert.equal(profile.gfbUsedMinutes, 960);
  assert.equal(profile.unpaidPauseMinutes, 60); // two centrally break-requiring 8h shifts
  assert.ok(profile.preferenceViolationMinutes > 0); assert.ok(profile.preferenceViolations.length > 0);
  assert.ok(profile.saturdayPenalty > 0); assert.equal(profile.saturdayFacts[0].workedSaturdays, 4); assert.equal(profile.saturdayFacts[0].maxConsecutiveWorkedSaturdays, 4);
  assert.ok(profile.weeklyDistributionPenalty > 0); // flex contributes no weekly penalty
});

test('outside-scope stability loses only at the final ranking levels', () => {
  const outside = facts({ mutations: [{ isoDate: '2026-09-22' }], understaffingMinutes: 0 });
  const inside = facts({ mutations: [{ isoDate: '2026-09-08' }], understaffingMinutes: 0 });
  assert.equal(outside.outsideSelectedWeekChangeCount, 1);
  assert.ok(Optimizer.compareDomainFacts(inside, outside) < 0);
  assert.ok(Optimizer.compareDomainFacts(outside, facts({ mutations: [{ isoDate: '2026-09-08' }], understaffingMinutes: 60 })) < 0);
});

test('remaining gaps produce external-help hints without modifying the plan', () => {
  const plan = { schedule: { '2026-09-11': {} } }, before = structuredClone(plan);
  const profile = Optimizer.evaluateVariantFacts(plan, [], { yearMonth: '2026-09' }, { coverageFacts: { understaffingMinutesAfter: 180, newGaps: [{ isoDate: '2026-09-11', start: 960, end: 1140, required: 1 }] } });
  assert.deepEqual(plan, before);
  assert.deepEqual(profile.externalHelpHints, [{ isoDate: '2026-09-11', start: 960, end: 1140, people: 1 }]);
});

test('explanation facts equal variant facts, ranking is deterministic and bounded', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({ candidateId: `c${i}`, mutations: [{ isoDate: `2026-09-${String(i + 7).padStart(2, '0')}`, employeeId: `e${i}`, after: { start: '09:00', end: '12:00' } }] }));
  const session = { workingPlan: { schedule: {} }, selectedWeeks: ['2026-09-07'], locks: [] };
  const context = { today: '2026-09-01', candidates, baselineFacts: { understaffingMinutes: 300 }, simulateState(_plan, mutations) { return { valid: true, simulatedPlan: { schedule: { marker: mutations.length } }, domainFacts: { understaffingMinutes: 300 - mutations.length * 30 } }; } };
  const one = Optimizer.run(session, context, { maxSimulations: 7, beamWidth: 2 }), two = Optimizer.run(session, context, { maxSimulations: 7, beamWidth: 2 });
  assert.ok(one.variants.length <= 3); assert.ok(one.debugCounters.simulatedStateCount <= 7); assert.ok(one.debugCounters.maxFrontierSize <= 2);
  assert.deepEqual(one.variants.map(v => v.variantId), two.variants.map(v => v.variantId));
  assert.deepEqual(one.variants[0].explanationFacts, one.variants[0].variantFacts);
});
