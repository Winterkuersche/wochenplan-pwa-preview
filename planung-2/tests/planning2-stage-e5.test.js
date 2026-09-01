const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../planning2-playground-state.js');
globalThis.Planning2PlaygroundState = State;
const History = require('../planning2-optimization-history.js');
globalThis.Planning2OptimizationHistory = History;
const Acceptance = require('../planning2-playground-acceptance.js');

const entry = (start, end) => ({ type: 'shift', start, end });
function fixture() {
  const plan = { schedule: { '2026-09-08': { anna: entry('09:00', '15:00'), chris: entry('10:00', '14:00'), dora: { type: 'vacation' } } }, monthlyPlanBaselines: { '2026-09': { immutable: true } } };
  const next = State.clone(plan);
  next.schedule['2026-09-08'].anna = entry('10:00', '16:00');
  next.schedule['2026-09-08'].ben = entry('16:00', '19:00');
  delete next.schedule['2026-09-08'].chris;
  next.schedule['2026-09-08'].dora = { type: 'sick' };
  const session = State.createSession({ month: '2026-09', plan, selectedWeeks: ['2026-09-07'], now: new Date('2026-09-01T10:00:00Z') });
  session.variants = [1, 2, 3].map(n => ({ variantId: `v${n}`, recommended: n === 1, workingPlan: n === 2 ? next : State.clone(plan), optimizationBasePlan: State.clone(plan), variantFacts: { changeCount: 4, understaffingMinutes: 30, employeesInMinus: 1, employeesInPlus: 2, gfbRemainingMinutes: 120, employeeBalances: [{ employeeId: 'anna', targetMinutes: 300, plannedMinutes: 320, creditMinutes: 0, projectedBalanceMinutes: 20 }], warnings: ['soft'] }, explanationFacts: { reason: 'snapshot' }, externalHelpHints: ['AH prüfen'], hardConstraintResult: { allowed: true, violations: [] } }));
  session.selectedVariantId = 'v2'; session.locks = [{ id: 'l1', scope: 'shift', employeeId: 'anna', isoDate: '2026-09-08' }];
  return { plan, next, session };
}
function adapter(plan, initial = []) {
  let current = State.clone(plan), history = State.clone(initial), fail = false;
  return { readCurrentPlan: () => State.clone(current), readOptimizationHistory: () => State.clone(history), async commitAcceptance({ nextPlan, nextHistory }) { if (fail) throw Error('disk full'); current = State.clone(nextPlan); history = State.clone(nextHistory); }, get plan() { return current; }, get history() { return history; }, set fail(value) { fail = value; } };
}
const valid = plan => ({ hardConstraintResult: { allowed: true, violations: [] }, checkedPlan: plan });

test('nothing is accepted automatically and any of three variants can be selected explicitly', async () => {
  const { plan, session } = fixture(), repo = adapter(plan); let discarded = false;
  assert.deepEqual(repo.plan, plan); session.selectedVariantId = 'v3';
  const result = await Acceptance.accept({ session, adapter: repo, revalidate: valid, discardPlayground: () => { discarded = true; } });
  assert.equal(result.ok, true); assert.deepEqual(repo.plan, session.variants[2].workingPlan); assert.equal(discarded, true);
});

test('hard invalid blocks, soft warnings do not, and fresh validation runs before commit', async () => {
  const { plan, session } = fixture(), repo = adapter(plan); let calls = 0, discarded = false;
  let result = await Acceptance.accept({ session, adapter: repo, revalidate() { calls++; return { hardConstraintResult: { allowed: false, violations: ['fresh'] } }; }, discardPlayground: () => { discarded = true; } });
  assert.equal(result.code, 'HARD_INVALID'); assert.equal(calls, 1); assert.deepEqual(repo.plan, plan); assert.equal(discarded, false);
  result = await Acceptance.accept({ session, adapter: repo, revalidate() { calls++; return valid(); }, discardPlayground: () => { discarded = true; } });
  assert.equal(result.ok, true); assert.equal(calls, 2); assert.equal(repo.history[0].warnings[0], 'soft');
});

test('missing selection, validation errors and changed current plan preserve playground', async () => {
  const { plan, session } = fixture(); let discarded = false;
  session.selectedVariantId = ''; assert.equal((await Acceptance.accept({ session, adapter: adapter(plan), revalidate: valid, discardPlayground() {} })).code, 'NO_VARIANT');
  session.selectedVariantId = 'v2'; assert.equal((await Acceptance.accept({ session, adapter: adapter(plan), revalidate() { throw Error('validator'); }, discardPlayground() {} })).code, 'VALIDATION_ERROR');
  const changed = State.clone(plan); changed.schedule.x = {};
  const result = await Acceptance.accept({ session, adapter: adapter(changed), revalidate: valid, discardPlayground: () => { discarded = true; } });
  assert.equal(result.code, 'PLAN_CONFLICT'); assert.match(result.message, /seit Start/); assert.equal(discarded, false);
});

test('commit failure performs no acceptance and preserves playground', async () => {
  const { plan, session } = fixture(), repo = adapter(plan); repo.fail = true; let discarded = false;
  const result = await Acceptance.accept({ session, adapter: repo, revalidate: valid, discardPlayground: () => { discarded = true; } });
  assert.equal(result.code, 'STORAGE_ERROR'); assert.deepEqual(repo.plan, plan); assert.deepEqual(repo.history, []); assert.equal(discarded, false);
});

test('records are versioned, appended and immutable after later live changes', async () => {
  const { plan, next, session } = fixture(), repo1 = adapter(plan); await Acceptance.accept({ session, adapter: repo1, revalidate: valid, discardPlayground() {} });
  const first = State.clone(repo1.history[0]); repo1.plan.schedule['2026-09-08'].anna.start = '12:00';
  assert.deepEqual(repo1.history[0], first); assert.equal(first.version, 1); assert.equal(first.label, 'Optimierung 1');
  const session2 = State.createSession({ month: '2026-09', plan: repo1.plan, selectedWeeks: ['2026-09-07'] }); session2.variants = [{ ...session.variants[1], variantId: 'new', workingPlan: next }]; session2.selectedVariantId = 'new';
  const repo2 = adapter(repo1.plan, repo1.history); await Acceptance.accept({ session: session2, adapter: repo2, revalidate: valid, discardPlayground() {} });
  assert.equal(repo2.history.length, 2); assert.deepEqual(repo2.history[0], first); assert.equal(repo2.history[1].version, 2);
});

test('structured diff detects added, changed, removed and status changes', () => {
  const { plan, next } = fixture(), changes = History.planChanges(plan, next);
  assert.deepEqual(new Set(changes.map(x => x.changeType)), new Set(Object.values(History.CHANGE)));
  for (const change of changes) { assert.ok(change.employeeId); assert.ok(change.isoDate); assert.ok('before' in change); assert.ok('after' in change); }
});

test('snapshot includes E3 facts, weeks, outside changes, locks, help and leaves baseline untouched', async () => {
  const { plan, session } = fixture(); session.selectedWeeks = ['2026-09-14']; const baseline = State.clone(plan.monthlyPlanBaselines), repo = adapter(plan);
  const result = await Acceptance.accept({ session, adapter: repo, revalidate: valid, discardPlayground() {} });
  assert.deepEqual(result.record.selectedWeeks, ['2026-09-14']); assert.equal(result.record.outsideSelectedWeekChanges.length, 4); assert.equal(result.record.locks.length, 1);
  assert.deepEqual(result.record.variantFacts, session.variants[1].variantFacts); assert.deepEqual(result.record.explanationFacts, { reason: 'snapshot' }); assert.deepEqual(result.record.externalHelpHints, ['AH prüfen']);
  assert.deepEqual(repo.plan.monthlyPlanBaselines, baseline);
  session.variants[1].variantFacts.changeCount = 999; session.locks[0].scope = 'week'; assert.equal(repo.history[0].variantFacts.changeCount, 4); assert.equal(repo.history[0].locks[0].scope, 'shift');
});

test('storage history repository preserves other months and deep clones reads', () => {
  const data = new Map(), storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }, repo = History.createStorageRepository(storage, 'h');
  repo.writeOptimizationHistory('2026-08', [{ month: '2026-08', version: 1 }]); repo.writeOptimizationHistory('2026-09', [{ month: '2026-09', version: 1, facts: { x: 1 } }]);
  const read = repo.readOptimizationHistory('2026-09'); read[0].facts.x = 2;
  assert.equal(repo.readOptimizationHistory('2026-09')[0].facts.x, 1); assert.equal(repo.readOptimizationHistory('2026-08').length, 1);
});

function localHarness(plan, options = {}) {
  const values = new Map([['plan', JSON.stringify(plan)]]), writes = [];
  let failHistoryWrites = options.failHistoryWrites || 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push(key); if (key === 'history' && failHistoryWrites-- > 0) throw Error('history unavailable'); values.set(key, value); },
    removeItem: key => values.delete(key)
  };
  const historyRepository = History.createStorageRepository(storage, 'history');
  const localAdapter = Acceptance.createLocalStorageAdapter({ storage, planKey: 'plan', historyRepository, journalKey: 'journal' });
  return { values, writes, storage, historyRepository, localAdapter, stopFailing() { failHistoryWrites = 0; } };
}

test('journal recovers plan-write plus history-write failure as one consistent pair', async () => {
  const { plan, next, session } = fixture(), local = localHarness(plan, { failHistoryWrites: 1 }); let discarded = false;
  const failed = await Acceptance.accept({ session, adapter: local.localAdapter, revalidate: valid, discardPlayground: () => { discarded = true; } });
  assert.equal(failed.code, 'STORAGE_ERROR'); assert.equal(discarded, false); assert.ok(local.values.has('journal'), 'prepared pair remains recoverable');
  local.stopFailing();
  assert.deepEqual(local.localAdapter.readCurrentPlan(), next);
  assert.equal(local.localAdapter.readOptimizationHistory('2026-09').length, 1);
  assert.equal(local.values.has('journal'), false);
});

test('successful commit plus cleanup failure remains successful and retry is idempotent', async () => {
  const { plan, next, session } = fixture(), local = localHarness(plan); let cleanupCalls = 0;
  const discard = () => { cleanupCalls++; if (cleanupCalls === 1) throw Error('remove denied'); };
  const first = await Acceptance.accept({ session, adapter: local.localAdapter, revalidate: valid, discardPlayground: discard });
  assert.equal(first.ok, true); assert.equal(first.warnings[0].code, 'PLAYGROUND_CLEANUP_FAILED'); assert.deepEqual(local.localAdapter.readCurrentPlan(), next);
  assert.equal(local.localAdapter.readOptimizationHistory('2026-09').length, 1);
  const retry = await Acceptance.accept({ session, adapter: local.localAdapter, revalidate: valid, discardPlayground: discard });
  assert.equal(retry.ok, true); assert.equal(retry.alreadyCommitted, true); assert.equal(local.localAdapter.readOptimizationHistory('2026-09').length, 1);
});

test('double tap of the same acceptance creates exactly one version', async () => {
  const { plan, session } = fixture(), local = localHarness(plan);
  const results = await Promise.all([1, 2].map(() => Acceptance.accept({ session, adapter: local.localAdapter, revalidate: valid, discardPlayground() {} })));
  assert.ok(results.every(result => result.ok)); const history = local.localAdapter.readOptimizationHistory('2026-09');
  assert.equal(history.length, 1); assert.equal(history[0].version, 1);
});

test('adapter checks expected signature immediately before writing', async () => {
  const { plan, session } = fixture(), local = localHarness(plan); let discarded = false;
  const originalCommit = local.localAdapter.commitAcceptance.bind(local.localAdapter);
  local.localAdapter.commitAcceptance = input => { const changed = State.clone(plan); changed.schedule.concurrent = {}; local.values.set('plan', JSON.stringify(changed)); return originalCommit(input); };
  const result = await Acceptance.accept({ session, adapter: local.localAdapter, revalidate: valid, discardPlayground: () => { discarded = true; } });
  assert.equal(result.code, 'PLAN_CONFLICT'); assert.equal(local.localAdapter.readOptimizationHistory('2026-09').length, 0); assert.equal(local.values.has('journal'), false); assert.equal(discarded, false);
});

test('fresh revalidation facts become the immutable acceptance snapshot', async () => {
  const { plan, session } = fixture(), local = localHarness(plan);
  const fresh = { variantFacts: { changeCount: 17, understaffingMinutes: 99, warnings: ['fresh'] }, explanationFacts: { reason: 'fresh' }, externalHelpHints: ['fresh AH'], hardConstraintResult: { allowed: true, violations: [] } };
  const result = await Acceptance.accept({ session, adapter: local.localAdapter, revalidate: () => fresh, discardPlayground() {} });
  assert.equal(result.record.variantFacts.changeCount, 17); assert.deepEqual(result.record.explanationFacts, { reason: 'fresh' }); assert.deepEqual(result.record.externalHelpHints, ['fresh AH']);
  assert.notEqual(result.record.variantFacts.changeCount, session.variants[1].variantFacts.changeCount);
});

test('a distinct successful acceptance after old history receives N plus one', async () => {
  const { plan, session } = fixture(), firstStore = localHarness(plan);
  await Acceptance.accept({ session, adapter: firstStore.localAdapter, revalidate: valid, discardPlayground() {} });
  const current = firstStore.localAdapter.readCurrentPlan(), history = firstStore.localAdapter.readOptimizationHistory('2026-09');
  const secondStore = localHarness(current); secondStore.historyRepository.writeOptimizationHistory('2026-09', history);
  const second = State.createSession({ month: '2026-09', plan: current, selectedWeeks: ['2026-09-07'], now: new Date('2026-09-02T10:00:00Z') });
  const changed = State.clone(current); changed.schedule['2026-09-09'] = { anna: entry('09:00', '12:00') };
  second.variants = [{ ...session.variants[1], variantId: 'v-new', workingPlan: changed }]; second.selectedVariantId = 'v-new';
  const result = await Acceptance.accept({ session: second, adapter: secondStore.localAdapter, revalidate: valid, discardPlayground() {} });
  assert.equal(result.record.version, 2); assert.deepEqual(secondStore.localAdapter.readOptimizationHistory('2026-09').map(x => x.label), ['Optimierung 1', 'Optimierung 2']);
});
