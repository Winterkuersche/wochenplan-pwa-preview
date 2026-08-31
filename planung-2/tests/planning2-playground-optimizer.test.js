const test = require('node:test');
const assert = require('node:assert/strict');
const Optimizer = require('../planning2-playground-optimizer.js');

const plan = { schedule: { '2026-08-30': { a: { type: 'shift', start: '09:00', end: '12:00' } }, '2026-08-31': { a: { type: 'shift', start: '09:00', end: '12:00' } } }, marker: 'live' };
const candidate = (id, isoDate, employeeId = 'a', score = 30, extra = {}) => ({ candidateId: id, problemId: 'gap', employeeId, isoDate, mutations: [{ isoDate, employeeId, before: null, after: { start: '09:00', end: '12:00', score } }], ...extra });
const session = () => ({ workingPlan: structuredClone(plan), selectedWeeks: ['2026-08-31'], locks: [] });
function context(candidates, invalidIds = []) {
  return { today: '2026-08-31', candidates, baselineFacts: { understaffingMinutes: 120 }, simulateState(baseline, mutations) {
    if (mutations.some(m => invalidIds.includes(m.after?.id))) return { valid: false };
    const result = structuredClone(baseline); result.schedule ||= {};
    mutations.forEach(m => { result.schedule[m.isoDate] ||= {}; result.schedule[m.isoDate][m.employeeId] = { type: 'shift', ...m.after }; });
    const improvement = mutations.reduce((sum, m) => sum + Number(m.after?.score || 0), 0);
    return { valid: true, simulatedPlan: result, coverageFacts: { understaffingMinutesAfter: Math.max(0, 120 - improvement), worsenedMinutes: 0 }, rankingFacts: { monthEffect: 0 } };
  } };
}

test('run is isolated from both the live plan and the complete session input', () => {
  const value = session(), before = structuredClone(value), liveBefore = structuredClone(plan);
  const result = Optimizer.run(value, context([candidate('one', '2026-09-01')]));
  assert.deepEqual(value, before); assert.deepEqual(plan, liveBefore);
  assert.notEqual(result.variants[0].workingPlan, value.workingPlan);
});

test('past, today, and every manual lock scope are hard constraints', () => {
  const dates = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-08'];
  const value = session(); value.locks = [
    { scope: 'shift', employeeId: 'b', isoDate: '2026-09-01' },
    { scope: 'day', isoDate: '2026-09-02' },
    { scope: 'employee-week', employeeId: 'd', weekId: '2026-08-31' },
    { scope: 'week', weekId: '2026-09-07' },
    { scope: 'employee-period', employeeId: 'f' }
  ];
  const values = [candidate('past', dates[0]), candidate('today', dates[1]), candidate('shift', dates[2], 'b'), candidate('day', dates[3], 'c'), candidate('ew', dates[3], 'd'), candidate('week', dates[4], 'e'), candidate('period', '2026-09-03', 'f'), candidate('ok', '2026-09-03', 'z')];
  const result = Optimizer.run(value, context(values), { maxCandidatesPerGroup: 20 });
  assert.equal(result.variants.length, 1); assert.deepEqual(result.variants[0].affectedEmployeeIds, ['z']);
  assert.deepEqual(result.variants[0].workingPlan.schedule['2026-08-30'], plan.schedule['2026-08-30']);
  assert.deepEqual(result.variants[0].workingPlan.schedule['2026-08-31'], plan.schedule['2026-08-31']);
});

test('outside selected weeks are permitted and reported', () => {
  const result = Optimizer.run(session(), context([candidate('outside', '2026-09-08')]));
  assert.deepEqual(result.variants[0].outsideSelectedWeeks, ['2026-09-08']);
});

test('invalid and structurally identical states never reach results', () => {
  const bad = candidate('bad', '2026-09-01'); bad.mutations[0].after.id = 'invalid';
  const a = candidate('a', '2026-09-02'), duplicate = candidate('duplicate', '2026-09-02');
  const result = Optimizer.run(session(), context([bad, a, duplicate], ['invalid']), { maxCandidatesPerGroup: 10 });
  assert.equal(result.variants.length, 1); assert.equal(result.variants[0].hardConstraintResult.allowed, true);
});

test('Pareto pruning removes dominated states', () => {
  const mk = (id, facts) => ({ id, facts, planSignature: id });
  const kept = Optimizer._test.prune([mk('best', { understaffing: 0, coverageWorsened: 0, monthEffect: 0, constraintRisk: 0, changes: 1 }), mk('worse', { understaffing: 10, coverageWorsened: 0, monthEffect: 0, constraintRisk: 0, changes: 2 })], 10);
  assert.deepEqual(kept.map(value => value.id), ['best']);
});

test('an hours delta is not invented as month effect for Pareto pruning', () => {
  const small = candidate('small-hours', '2026-09-01'), large = candidate('large-hours', '2026-09-02');
  const result = Optimizer.run(session(), {
    ...context([small, large]),
    simulateState(baseline, mutations) {
      const resultPlan = structuredClone(baseline);
      mutations.forEach(mutation => { resultPlan.schedule[mutation.isoDate] = { [mutation.employeeId]: { type: 'shift', ...mutation.after } }; });
      const deltaMinutes = mutations[0].isoDate === '2026-09-01' ? 30 : 300;
      return { valid: true, simulatedPlan: resultPlan, coverageFacts: { understaffingMinutesAfter: 60, worsenedMinutes: 0 }, hoursFacts: { a: { deltaMinutes } } };
    }
  }, { maxDepth: 1, maxCandidatesPerGroup: 5 });
  assert.equal(result.variants.length, 2);
  assert.ok(result.variants.every(value => value.rankingFacts.hasMonthEffect === false));
});

test('bounded dependency pool protects a later package candidate from the normal cap', () => {
  const normal = candidate('a-normal-best', '2026-09-01'); normal.coverageEffect = 100;
  const dependency = candidate('z-required-package', '2026-09-02', 'b', 100, { requiresPackage: true });
  let packageInputIds = [];
  const result = Optimizer.run(session(), {
    ...context([normal, dependency]),
    generatePackages(_context, candidates) {
      packageInputIds = candidates.map(value => value.candidateId);
      const retained = candidates.find(value => value.candidateId === dependency.candidateId);
      return { packages: retained ? [{ packageId: 'dependency-package', sourceCandidateIds: [retained.candidateId], mutations: retained.mutations }] : [] };
    }
  }, { maxCandidatesPerGroup: 1, maxDependencyCandidates: 2, maxDepth: 1 });
  assert.deepEqual(packageInputIds, ['a-normal-best', 'z-required-package']);
  assert.ok(result.variants.some(value => value.appliedPackageIds.includes('dependency-package')));
  assert.equal(result.debugCounters.protectedDependencyCount, 1);
});

test('required follow-ups remain an atomic unit', () => {
  const primary = candidate('with-follow-up', '2026-09-01');
  primary.requiredFollowUpMutations = [{ isoDate: '2026-09-02', employeeId: 'b', before: null, after: { start: '12:00', end: '16:00', score: 20 } }];
  const result = Optimizer.run(session(), context([primary]), { maxDepth: 1 });
  assert.equal(result.variants[0].appliedMutations.length, 2);
  assert.deepEqual(result.variants[0].affectedIsoDates, ['2026-09-01', '2026-09-02']);
});

test('frontier, simulation budget, deterministic order and result count are bounded', () => {
  const values = Array.from({ length: 12 }, (_, index) => candidate(`c${index}`, `2026-09-${String(index + 1).padStart(2, '0')}`, `e${index}`, index + 1));
  const config = { maxCandidatesPerGroup: 20, beamWidth: 2, maxDepth: 4, maxSimulations: 9, maxResults: 3 };
  const first = Optimizer.run(session(), context(values), config), second = Optimizer.run(session(), context(values), config);
  assert.ok(first.debugCounters.maxFrontierSize <= 2); assert.ok(first.debugCounters.simulatedStateCount <= 9); assert.ok(first.variants.length <= 3);
  assert.deepEqual(first.variants.map(v => v.variantId), second.variants.map(v => v.variantId));
  assert.equal(first.variants[0].recommended, true); assert.ok(first.variants.slice(1).every(v => !v.recommended));
});

test('nearly identical results are not artificially diversified', () => {
  const only = candidate('only', '2026-09-01');
  const result = Optimizer.run(session(), context([only, structuredClone(only)]), { maxResults: 3 });
  assert.equal(result.variants.length, 1);
});

test('representative selection retains specialist candidates before applying the cap', () => {
  const values = [candidate('coverage', '2026-09-01'), candidate('hours', '2026-09-01'), candidate('stable', '2026-09-01')];
  values.forEach((value, index) => { value.mutations[0].after.variant = index; });
  values[0].coverageEffect = 100; values[1].hoursEffectMinutes = 5; values[2].disruptionFacts = { mutationCount: 0 };
  const selected = Optimizer._test.representativeSelection(values, 3);
  assert.deepEqual(new Set(selected.map(value => value.candidateId)), new Set(['coverage', 'hours', 'stable']));
});
