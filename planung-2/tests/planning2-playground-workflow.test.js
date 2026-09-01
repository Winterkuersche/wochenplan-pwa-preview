const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../planning2-playground-state.js');
const Workflow = require('../planning2-playground-workflow.js');
const Packages = require('../planning2-mutation-packages.js');

const livePlan = { schedule: { '2026-09-01': { a: { type: 'shift', start: '09:00', end: '15:00' } } } };
const session = () => State.createSession({ month: '2026-09', plan: livePlan, selectedWeeks: ['2026-08-31'], now: new Date('2026-08-01T00:00:00Z') });
const variant = (id, start = '10:00', allowed = true) => ({ variantId: id, workingPlan: { schedule: { '2026-09-01': { a: { type: 'shift', start, end: '16:00' } } } }, variantFacts: { understaffingMinutes: 0, externalHelpHints: [] }, hardConstraintResult: { allowed, violations: allowed ? [] : [{ rule: 'REAL_FREE_DAY_REQUIRED' }] } });

test('optimization runs only when explicitly invoked and retains at most three ranked variants', async () => {
  const value = session(); let calls = 0;
  assert.equal(value.variants.length, 0);
  await Workflow.optimize(value, () => { calls += 1; return { status: 'success', variants: [variant('best'), variant('two'), variant('three'), variant('four')] }; }, {});
  assert.equal(calls, 1); assert.equal(value.variants.length, 3); assert.equal(value.variants[0].recommended, true); assert.equal(value.selectedVariantId, 'best');
});

test('selection and edits remain isolated from the live plan', () => {
  const value = session(); Workflow.replaceVariants(value, [variant('one'), variant('two', '11:00')]);
  Workflow.selectVariant(value, 'two');
  const edited = State.clone(value.workingPlan); edited.schedule['2026-09-01'].a.start = '12:00';
  State.commitWorkingPlan(value, 'a', '2026-09-01', edited, { now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(value.variants[1].workingPlan.schedule['2026-09-01'].a.start, '12:00');
  assert.equal(livePlan.schedule['2026-09-01'].a.start, '09:00');
  assert.equal(value.locks[0].scope, 'shift');
});

test('running and failed optimization retain old variants, working copy and locks', async () => {
  const value = session(); Workflow.replaceVariants(value, [variant('old')]); State.addLock(value, { scope: 'week', weekId: '2026-08-31' });
  let release; const pending = Workflow.optimize(value, () => new Promise(resolve => { release = resolve; }), {});
  await Promise.resolve(); assert.equal(value.optimization.status, 'running'); assert.equal(value.selectedVariantId, 'old'); assert.equal(value.locks.length, 1);
  release({ status: 'cancelled' }); await pending;
  assert.equal(value.optimization.status, 'error'); assert.equal(value.selectedVariantId, 'old'); assert.equal(value.locks.length, 1);
});

test('successful replacement is atomic and from-here uses edited plan plus locks', async () => {
  const value = session(); Workflow.replaceVariants(value, [variant('old')]); State.addLock(value, { scope: 'employee-period', employeeId: 'a' });
  let input; await Workflow.optimize(value, candidate => { input = candidate; return { status: 'success', variants: [variant('new')] }; }, {}, { fromHere: true });
  assert.equal(input.source, 'variant:old'); assert.equal(input.workingPlan.schedule['2026-09-01'].a.start, '10:00'); assert.equal(input.locks.length, 1); assert.equal(value.selectedVariantId, 'new');
});

test('hard-invalid manual variant is visible in state and cannot optimize from here', async () => {
  const value = session(); Workflow.replaceVariants(value, [variant('bad', '10:00', false)]); let calls = 0;
  const result = await Workflow.optimize(value, () => { calls += 1; }, {}, { fromHere: true });
  assert.equal(result.status, 'invalid'); assert.equal(calls, 0); assert.equal(value.variants[0].hardConstraintResult.violations[0].rule, 'REAL_FREE_DAY_REQUIRED');
});

test('manual reevaluation persists E3 facts and external help remains a hint', () => {
  const value = session(); Workflow.replaceVariants(value, [variant('one')]);
  Workflow.reevaluateSelected(value, () => ({ variantFacts: { employeesInMinus: 2 }, explanationFacts: { changeCount: 1 }, externalHelpHints: [{ people: 1 }], hardConstraintResult: { allowed: true, violations: [] } }));
  assert.equal(value.variants[0].variantFacts.employeesInMinus, 2); assert.equal(value.variants[0].externalHelpHints.length, 1); assert.equal(value.workingPlan.schedule['2026-09-01'].external, undefined);
});

test('from-here generations revalidate only against their immediate optimization base', async () => {
  const value = session(), original = JSON.stringify(value.basePlan);
  Workflow.replaceVariants(value, [variant('round-1')], value.workingPlan);
  const firstEdit = State.clone(value.workingPlan); firstEdit.schedule['2026-09-01'].a.start = '11:00';
  State.commitWorkingPlan(value, 'a', '2026-09-01', firstEdit, { now: new Date('2026-08-01T00:00:00Z') });
  await Workflow.optimize(value, () => ({ status: 'success', variants: [variant('round-2', '12:00')] }), {}, { fromHere: true });
  const secondBase = value.variants[0].optimizationBasePlan;
  assert.equal(secondBase.schedule['2026-09-01'].a.start, '11:00');
  const secondEdit = State.clone(value.workingPlan); secondEdit.schedule['2026-09-01'].a.end = '17:00';
  State.commitWorkingPlan(value, 'a', '2026-09-01', secondEdit, { now: new Date('2026-08-01T00:00:00Z') });
  let receivedBase, receivedPlan;
  Workflow.reevaluateSelected(value, (plan, base) => { receivedPlan = plan; receivedBase = base; return { hardConstraintResult: { allowed: true, violations: [] } }; });
  assert.deepEqual(receivedBase, secondBase); assert.equal(receivedPlan.schedule['2026-09-01'].a.end, '17:00');
  assert.equal(Workflow.planMutations(receivedBase, receivedPlan).length, 1);
  assert.equal(JSON.stringify(value.basePlan), original); assert.equal(value.locks.length, 1); assert.equal(livePlan.schedule['2026-09-01'].a.end, '15:00');
});

test('exact manual plan diff retains every status entry instead of collapsing it to null', () => {
  const before = { schedule: { '2026-09-02': { a: { type: 'off', status: 'off', code: 'FR' } } } };
  for (const after of [{ type: 'vacation' }, { type: 'sick' }, { type: 'external-help', branch: 'Kiel' }, { type: 'ag-free' }]) {
    const mutations = Workflow.planMutations(before, { schedule: { '2026-09-02': { a: after } } });
    assert.deepEqual(mutations[0].before, before.schedule['2026-09-02'].a); assert.deepEqual(mutations[0].after, after);
  }
});

test('all E1 lock levels constrain the E4 commit path and can be released', () => {
  const definitions = [{ scope: 'shift', employeeId: 'a', isoDate: '2026-09-01' }, { scope: 'day', isoDate: '2026-09-01' }, { scope: 'employee-week', employeeId: 'a', weekId: '2026-08-31' }, { scope: 'week', weekId: '2026-08-31' }, { scope: 'employee-period', employeeId: 'a' }];
  for (const definition of definitions) {
    const value = session(); Workflow.replaceVariants(value, [variant('one')]); const lock = State.addLock(value, definition);
    const edit = State.clone(value.workingPlan); edit.schedule['2026-09-01'].a.end = '17:00';
    assert.equal(State.commitWorkingPlan(value, 'a', '2026-09-01', edit, { now: new Date('2026-08-01T00:00:00Z') }).changed, false, definition.scope);
    assert.equal(State.removeLock(value, lock.id), true); assert.equal(State.getConstraint(value, 'a', '2026-09-01', new Date('2026-08-01T00:00:00Z')).locked, false);
  }
});

test('cancel, no-op and repeating an identical edit create no additional lock', () => {
  const value = session(); Workflow.replaceVariants(value, [variant('one')]);
  const abandoned = State.clone(value.workingPlan); abandoned.schedule['2026-09-01'].a.end = '18:00'; // editor cancel: no commit
  assert.equal(value.locks.length, 0);
  assert.equal(State.commitWorkingPlan(value, 'a', '2026-09-01', State.clone(value.workingPlan), { now: new Date('2026-08-01T00:00:00Z') }).reason, 'unchanged');
  const edit = State.clone(value.workingPlan); edit.schedule['2026-09-01'].a.end = '17:00';
  assert.equal(State.commitWorkingPlan(value, 'a', '2026-09-01', edit, { now: new Date('2026-08-01T00:00:00Z') }).changed, true);
  assert.equal(State.commitWorkingPlan(value, 'a', '2026-09-01', State.clone(value.workingPlan), { now: new Date('2026-08-01T00:00:00Z') }).reason, 'unchanged');
  assert.equal(value.locks.length, 1);
});

test('repository reload restores edited selection, variants, locks, weeks and optimization state', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, item) => values.set(key, item), removeItem: key => values.delete(key) };
  const repo = State.createRepository(storage), value = session(); Workflow.replaceVariants(value, [variant('one'), variant('two')]); Workflow.selectVariant(value, 'two');
  const edit = State.clone(value.workingPlan); edit.schedule['2026-09-01'].a.end = '18:00'; State.commitWorkingPlan(value, 'a', '2026-09-01', edit, { now: new Date('2026-08-01T00:00:00Z') });
  value.optimization = { status: 'error', error: 'offline' }; State.setSelectedWeeks(value, ['2026-08-31', '2026-09-07']); repo.save(value);
  const restored = State.createRepository(storage).load();
  assert.equal(restored.selectedVariantId, 'two'); assert.equal(restored.workingPlan.schedule['2026-09-01'].a.end, '18:00'); assert.equal(restored.variants[1].workingPlan.schedule['2026-09-01'].a.end, '18:00');
  assert.equal(restored.locks.length, 1); assert.deepEqual(restored.selectedWeeks, ['2026-08-31', '2026-09-07']); assert.equal(restored.optimization.status, 'error');
});

test('hydrate upgrades an E1 session without changing its original comparison plan', () => {
  const legacy = { version: 1, workingPlan: State.clone(livePlan), selectedWeeks: ['2026-08-31'], locks: [], variants: [{ ...variant('legacy'), optimizationBasePlan: undefined }], selectedVariantId: 'legacy' };
  const restored = State.hydrate(legacy);
  assert.deepEqual(restored.basePlan, livePlan); assert.deepEqual(restored.variants[0].optimizationBasePlan, livePlan);
  assert.deepEqual(restored.workingPlan, restored.variants[0].workingPlan); assert.equal(restored.optimization.status, 'idle');
});

test('real free-day validation keeps the invalid manual plan and blocks from-here', async () => {
  const dates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const shift = { type: 'shift', start: '09:00', end: '15:00' }, base = { schedule: Object.fromEntries(dates.map(date => [date, { a: date === '2026-09-12' ? { type: 'off', status: 'off' } : shift }])) };
  const edited = State.clone(base); edited.schedule['2026-09-12'].a = shift;
  const context = { sourcePlan: base, employees: [{ employeeId: 'a', evaluation: { isGfb: false } }], sourceEmployees: [{ id: 'a' }], days: dates.map(isoDate => ({ isoDate, resolvedEntries: [{ type: isoDate === '2026-09-12' ? 'off' : 'shift' }], coverage: { gaps: [] } })), evaluateCoverage: () => ({ gaps: [] }) };
  const validation = Packages.simulatePlanning2MutationPackage(context, { packageType: 'PLAYGROUND_MANUAL', mutations: Workflow.planMutations(base, edited) });
  assert.equal(validation.valid, false); assert.ok(validation.constraintResults.violations.some(item => item.rule === 'REAL_FREE_DAY_REQUIRED'));
  const value = State.createSession({ month: '2026-09', plan: base, selectedWeeks: ['2026-09-07'], now: new Date('2026-08-01T00:00:00Z') }); Workflow.replaceVariants(value, [{ ...variant('invalid'), workingPlan: edited }], base);
  Workflow.reevaluateSelected(value, () => ({ hardConstraintResult: validation.constraintResults })); let calls = 0;
  assert.equal((await Workflow.optimize(value, () => { calls += 1; }, {}, { fromHere: true })).status, 'invalid'); assert.equal(calls, 0); assert.deepEqual(value.workingPlan, edited);
});
