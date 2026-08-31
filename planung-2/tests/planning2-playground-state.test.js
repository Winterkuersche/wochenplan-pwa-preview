const test = require('node:test');
const assert = require('node:assert/strict');
const Playground = require('../planning2-playground-state.js');
const NOW = new Date('2026-08-31T12:00:00Z');
const plan = { weekFrom: '2026-08-31', schedule: { '2026-09-01': { ada: { type: 'shift', start: '09:00', end: '17:00' } } }, absences: [] };
const fresh = () => Playground.createSession({ month: '2026-09', plan, selectedWeeks: ['2026-08-31'], now: NOW });

test('start creates an isolated, exact working copy with a stable session id', () => { const session = fresh(); assert.deepEqual(session.workingPlan, plan); assert.notEqual(session.workingPlan, plan); session.workingPlan.schedule['2026-09-01'].ada.start = '10:00'; assert.equal(plan.schedule['2026-09-01'].ada.start, '09:00'); assert.match(session.id, /^p2pg_2026-09_/); });
test('past and today are immutable, future is editable and automatically fixed', () => { const session = fresh(); assert.equal(Playground.setWorkingEntry(session, 'ada', '2026-08-31', null, { now: NOW }).reason, 'past-or-today'); const result = Playground.setWorkingEntry(session, 'ada', '2026-09-01', { type: 'off' }, { now: NOW }); assert.equal(result.changed, true); assert.equal(result.automaticLock.origin, 'automatic-manual'); assert.equal(Playground.getConstraint(session, 'ada', '2026-09-01', NOW).locked, true); });
test('automatic fixing can be released and unchanged shifts can be manually fixed', () => { const session = fresh(); const changed = Playground.setWorkingEntry(session, 'ada', '2026-09-01', { type: 'off' }, { now: NOW }); assert.equal(Playground.removeLock(session, changed.automaticLock.id), true); assert.equal(Playground.getConstraint(session, 'ada', '2026-09-01', NOW).locked, false); const lock = Playground.addLock(session, { scope: 'shift', employeeId: 'ada', isoDate: '2026-09-02' }); assert.equal(lock.origin, 'manual'); assert.equal(Playground.getConstraint(session, 'ada', '2026-09-02', NOW).locked, true); });
test('day, week, employee-week and employee-period scopes act as hard constraints', () => { for (const value of [{ scope: 'day', isoDate: '2026-09-02' }, { scope: 'week', weekId: '2026-08-31' }, { scope: 'employee-week', employeeId: 'ada', weekId: '2026-08-31' }, { scope: 'employee-period', employeeId: 'ada' }]) { const session = fresh(); Playground.addLock(session, value); assert.equal(Playground.getConstraint(session, 'ada', '2026-09-02', NOW).locked, true, value.scope); } });
test('selection is advisory and outside changes are marked', () => { const session = fresh(); Playground.setSelectedWeeks(session, []); const result = Playground.setWorkingEntry(session, 'ada', '2026-09-01', { type: 'off' }, { now: NOW }); assert.equal(result.changed, true); assert.equal(result.outsideSelectedWeek, true); });
test('repository reloads state and discard removes only playground storage', () => { const values = new Map([['live-plan', JSON.stringify(plan)]]), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, repo = Playground.createRepository(storage), session = fresh(); repo.save(session); assert.deepEqual(repo.load(), session); repo.discard(); assert.equal(repo.load(), null); assert.equal(values.get('live-plan'), JSON.stringify(plan)); });

test('editor commit replaces only the working copy and fixes only a real change', () => {
  const session = fresh();
  const editorCopy = Playground.clone(session.workingPlan);
  editorCopy.schedule['2026-09-01'].ada = { type: 'shift', code: 'F3', start: '09:00', end: '12:00' };
  const result = Playground.commitWorkingPlan(session, 'ada', '2026-09-01', editorCopy, { now: NOW });
  assert.equal(result.changed, true);
  assert.equal(result.automaticLock.origin, 'automatic-manual');
  assert.equal(session.workingPlan.schedule['2026-09-01'].ada.code, 'F3');
  assert.equal(plan.schedule['2026-09-01'].ada.start, '09:00');
  assert.equal(plan.schedule['2026-09-01'].ada.code, undefined);

  Playground.removeLock(session, result.automaticLock.id);
  const unchanged = Playground.commitWorkingPlan(session, 'ada', '2026-09-01', Playground.clone(session.workingPlan), { now: NOW });
  assert.deepEqual(unchanged, { changed: false, reason: 'unchanged' });
  assert.equal(session.locks.length, 0);
});

test('discarding an isolated editor copy changes no plan and creates no fixation', () => {
  const session = fresh();
  const before = JSON.stringify(session.workingPlan);
  const abandonedEditorCopy = Playground.clone(session.workingPlan);
  abandonedEditorCopy.schedule['2026-09-01'].ada.end = '19:00';
  assert.equal(JSON.stringify(session.workingPlan), before);
  assert.equal(session.locks.length, 0);
});
