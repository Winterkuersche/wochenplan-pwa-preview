const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');
function extractFunction(name) {
  const start = preview.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  for (let index = preview.indexOf('{', start); index < preview.length; index += 1) {
    if (preview[index] === '{') depth += 1;
    if (preview[index] === '}' && --depth === 0) return preview.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
function loadRule() {
  const names = ['mins', 'shiftDayIso', 'previousRelevantWorkday', 'nextRelevantWorkday',
    'carryoverRolePriority', 'planning2ResolvedWorkShift', 'rankCarryoverCandidates', 'updatePlanning2ShiftStart',
    'applyPlanning2EarlyStartCarryover', 'closingWorkload', 'extendClosingShift', 'restoreClosingShift',
    'alignPreviousClosingTeam', 'applyPlanning2ClosingAutofix',
    'applyPlanning2SavedDayAutofixes'];
  const context = loadScripts(['holidays.js', 'time-utils.js', 'shift-rules.js', 'date-utils.js', 'shift-utils.js', 'status-utils.js', 'absences.js', 'day-resolution.js']);
  vm.runInContext(`${names.map(extractFunction).join(';')} ;this.applyRule=applyPlanning2ClosingAutofix;this.applySavedDay=applyPlanning2SavedDayAutofixes;`, context);
  return context;
}
const rules = loadRule();
const applyRule = rules.applyRule;
const applySavedDay = rules.applySavedDay;
const employee = (id, roleKey = 'MA') => ({ id, roleKey, target: '40:00' });
const shift = (start, end, mode = 'flex') => ({ type: 'shift', start, end, mode, code: mode, minutes: 600, pause: 0 });
const planFor = (today, tomorrow = {}) => ({ schedule: { '2026-04-10': today, '2026-04-11': tomorrow } });
const savedFridayPlan = (thursday, friday) => ({ schedule: { '2026-04-09': thursday, '2026-04-10': friday }, absences: [] });

test('saving a new Friday G shift applies Thursday 19:10 carryover', () => {
  const plan = savedFridayPlan({ a: shift('09:00', '19:10') }, { a: shift('09:00', '19:00', 'G') });
  applySavedDay(plan, [employee('a')], '2026-04-10');
  assert.equal(plan.schedule['2026-04-10'].a.start, '08:55');
  assert.equal(plan.schedule['2026-04-10'].a.pause, 65);
  assert.equal(plan.schedule['2026-04-10'].a.minutes, 540);
});

test('saved F6 and Flex shifts qualify by their resolved 09:00 start', () => {
  for (const code of ['F6', 'FLEX']) {
    const plan = savedFridayPlan({ a: shift('13:00', '19:10') }, { a: shift('09:00', '15:00', code) });
    applySavedDay(plan, [employee('a')], '2026-04-10');
    assert.equal(plan.schedule['2026-04-10'].a.start, '08:55', code);
    assert.equal(plan.schedule['2026-04-10'].a.pause, 5, code);
    assert.equal(plan.schedule['2026-04-10'].a.breakMinutes, 5, code);
    assert.equal(plan.schedule['2026-04-10'].a.minutes, 360, code);
  }
});

test('saving Friday G, F6, or Flex reselects the already completed Thursday closing team', () => {
  for (const [code, end] of [['G', '19:00'], ['F6', '15:00'], ['FLEX', '16:00']]) {
    const plan = savedFridayPlan(
      {
        a: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
        b: { ...shift('13:00', '19:10'), planning2AutoCloser: true },
        c: shift('09:00', '19:00')
      },
      { c: shift('09:00', end, code) }
    );

    applySavedDay(plan, [employee('a'), employee('b'), employee('c')], '2026-04-10');

    assert.equal(plan.schedule['2026-04-09'].c.end, '19:10', code);
    assert.equal(plan.schedule['2026-04-09'].c.planning2AutoCloser, true, code);
    assert.equal(Object.values(plan.schedule['2026-04-09']).filter(value => value.end === '19:10').length, 2, code);
    assert.equal(['a', 'b'].filter(id => plan.schedule['2026-04-09'][id].end === '19:00').length, 1, code);
    assert.equal(plan.schedule['2026-04-10'].c.start, '08:55', code);
    assert.equal(plan.schedule['2026-04-10'].c.minutes, code === 'G' ? 540 : 360, code);
  }
});

test('saving an explicit early shift reassigns the previous closing team to that employee', () => {
  const plan = savedFridayPlan(
    {
      a: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
      b: shift('13:00', '19:10'),
      early: shift('09:00', '19:00')
    },
    { early: shift('08:55', '15:00', 'FO') }
  );

  applySavedDay(plan, [employee('a'), employee('b'), employee('early')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-09'].a.end, '19:00');
  assert.equal(plan.schedule['2026-04-09'].b.end, '19:10');
  assert.equal(plan.schedule['2026-04-09'].early.end, '19:10');
  assert.equal(plan.schedule['2026-04-10'].early.start, '08:55');
  assert.equal(plan.schedule['2026-04-10'].early.planning2AutoOpener, undefined);
});

test('changing the explicit early employee switches the previous closing assignment', () => {
  const plan = savedFridayPlan(
    {
      a: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
      b: shift('09:00', '19:00'),
      fixed: shift('13:00', '19:10')
    },
    {
      a: { ...shift('09:00', '15:00'), planning2AutoOpener: true },
      b: shift('08:55', '15:00', 'FO')
    }
  );

  applySavedDay(plan, [employee('a'), employee('b'), employee('fixed')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-09'].a.end, '19:00');
  assert.equal(plan.schedule['2026-04-09'].b.end, '19:10');
  assert.deepEqual(Object.entries(plan.schedule['2026-04-10']).filter(([, value]) => value.start === '08:55').map(([id]) => id), ['b']);
});

test('a consciously saved early shift replaces the old automatic closer and opener', () => {
  const plan = savedFridayPlan(
    {
      automatic: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
      manual: shift('13:00', '19:10'),
      conscious: shift('09:00', '19:00')
    },
    {
      automatic: { ...shift('08:55', '15:00', 'F6'), mode: 'early', planning2AutoOpener: true },
      conscious: { ...shift('08:55', '15:00', 'FO'), mode: 'early' }
    }
  );

  applySavedDay(plan, [employee('automatic'), employee('manual'), employee('conscious')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-09'].automatic.end, '19:00');
  assert.equal(plan.schedule['2026-04-09'].manual.end, '19:10');
  assert.equal(plan.schedule['2026-04-09'].conscious.end, '19:10');
  assert.equal(plan.schedule['2026-04-10'].automatic.start, '09:00');
  assert.equal(plan.schedule['2026-04-10'].automatic.planning2AutoOpener, undefined);
  assert.equal(plan.schedule['2026-04-10'].conscious.start, '08:55');
  assert.equal(plan.schedule['2026-04-10'].conscious.planning2AutoOpener, undefined);
  assert.equal(Object.values(plan.schedule['2026-04-09']).filter(value => value.end === '19:10').length, 2);
  assert.equal(Object.values(plan.schedule['2026-04-10']).filter(value => value.start === '08:55').length, 1);
});

test('an automatic F6 opener is not explicit merely because its mode is early', () => {
  const plan = savedFridayPlan(
    {
      automatic: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
      tl: shift('13:00', '19:10')
    },
    {
      automatic: { ...shift('08:55', '15:00', 'F6'), mode: 'early', planning2AutoOpener: true },
      tl: shift('09:00', '15:00', 'F6')
    }
  );

  applySavedDay(plan, [employee('automatic'), employee('tl', 'TL')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-10'].automatic.start, '09:00');
  assert.equal(plan.schedule['2026-04-10'].automatic.planning2AutoOpener, undefined);
  assert.equal(plan.schedule['2026-04-10'].tl.start, '08:55');
  assert.equal(plan.schedule['2026-04-10'].tl.planning2AutoOpener, true);
});

test('deleting an early shift rechecks but does not needlessly change two previous closers', () => {
  const plan = savedFridayPlan(
    { a: shift('09:00', '19:10'), b: shift('13:00', '19:10'), c: shift('09:00', '19:00') },
    {}
  );
  const previousBefore = JSON.stringify(plan.schedule['2026-04-09']);

  applySavedDay(plan, [employee('a'), employee('b'), employee('c')], '2026-04-10');

  assert.equal(JSON.stringify(plan.schedule['2026-04-09']), previousBefore);
});

test('an unrelated saved-day change leaves a valid previous team untouched', () => {
  const plan = savedFridayPlan(
    { a: shift('09:00', '19:10'), b: shift('13:00', '19:10'), c: shift('09:00', '17:00') },
    { c: shift('13:00', '17:00', 'flex') }
  );
  const previousBefore = JSON.stringify(plan.schedule['2026-04-09']);

  applySavedDay(plan, [employee('a'), employee('b'), employee('c')], '2026-04-10');

  assert.equal(JSON.stringify(plan.schedule['2026-04-09']), previousBefore);
});

test('a Monday early shift rebalances Saturday and retains exactly two closers and one opener', () => {
  const plan = {
    schedule: {
      '2026-04-11': {
        old: { ...shift('09:00', '19:10'), planning2AutoCloser: true },
        fixed: shift('13:00', '19:10'),
        early: shift('09:00', '19:00')
      },
      '2026-04-13': {
        old: { ...shift('08:55', '15:00'), planning2AutoOpener: true },
        early: shift('08:55', '15:00', 'FO')
      }
    },
    absences: []
  };

  applySavedDay(plan, [employee('old'), employee('fixed'), employee('early')], '2026-04-13');

  assert.deepEqual(Object.entries(plan.schedule['2026-04-11']).filter(([, value]) => value.end === '19:10').map(([id]) => id).sort(), ['early', 'fixed']);
  assert.deepEqual(Object.entries(plan.schedule['2026-04-13']).filter(([, value]) => value.start === '08:55').map(([id]) => id), ['early']);
});

test('previous-day rebalance preserves a manual closer before an automatic closer', () => {
  const plan = savedFridayPlan(
    {
      manual: shift('09:00', '19:10'),
      automatic: { ...shift('13:00', '19:10'), planning2AutoCloser: true },
      morning: shift('09:00', '19:00')
    },
    { morning: shift('09:00', '15:00', 'F6') }
  );

  applySavedDay(plan, [employee('manual'), employee('automatic'), employee('morning')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-09'].manual.end, '19:10');
  assert.equal(plan.schedule['2026-04-09'].automatic.end, '19:00');
});

test('saved morning extends its previous 19:00 shift and receives 08:55', () => {
  const plan = savedFridayPlan({ a: shift('09:00', '19:00') }, { a: shift('09:00', '15:00', 'F6') });
  applySavedDay(plan, [employee('a')], '2026-04-10');
  assert.equal(plan.schedule['2026-04-09'].a.end, '19:10');
  assert.equal(plan.schedule['2026-04-10'].a.start, '08:55');
});

test('resolved vacation or sickness cannot receive saved-day carryover', () => {
  for (const type of ['vacation', 'sick']) {
    const plan = savedFridayPlan({ a: shift('09:00', '19:10') }, { a: shift('09:00', '15:00', 'F6') });
    plan.absences.push({ id: type, employeeId: 'a', type, from: '2026-04-10', to: '2026-04-10' });
    applySavedDay(plan, [employee('a')], '2026-04-10');
    assert.equal(plan.schedule['2026-04-10'].a.start, '09:00', type);
  }
});

test('saved-day carryover assigns exactly one ranked person and resets stale 08:55', () => {
  const plan = savedFridayPlan(
    { normal: shift('09:00', '19:10'), sv: shift('09:00', '19:10'), tl: shift('09:00', '19:10'), stale: shift('09:00', '19:00') },
    { normal: shift('09:00', '15:00'), sv: shift('09:00', '15:00'), tl: shift('09:00', '15:00'), stale: shift('08:55', '15:00') }
  );
  applySavedDay(plan, [employee('normal'), employee('sv', 'SV'), employee('tl', 'TL'), employee('stale')], '2026-04-10');
  assert.deepEqual(Object.entries(plan.schedule['2026-04-10']).filter(([, value]) => value.start === '08:55').map(([id]) => id), ['tl']);
  assert.equal(plan.schedule['2026-04-10'].stale.start, '09:00');
  assert.equal(plan.schedule['2026-04-10'].stale.pause, 0);
  assert.equal(plan.schedule['2026-04-10'].stale.minutes, 360);
});

test('two existing 19:10 closers remain completely unchanged', () => {
  const plan = planFor({ a: shift('09:00', '19:10'), b: shift('13:00', '19:10'), c: shift('09:00', '19:00') });
  const before = JSON.stringify(plan);
  assert.deepEqual(Array.from(applyRule(plan, ['a','b','c'].map(employee), '2026-04-10').changedIds), []);
  assert.equal(JSON.stringify(plan), before);
});

test('one closer causes exactly one real 19:00 shift to be extended', () => {
  const plan = planFor({ a: shift('13:00', '19:10'), b: shift('13:00', '19:00', 'late'), c: shift('09:00', '19:00', 'full') });
  const result = applyRule(plan, ['a','b','c'].map(employee), '2026-04-10');
  assert.equal(result.changedIds.length, 1);
  assert.equal(Object.values(plan.schedule['2026-04-10']).filter(entry => entry.end === '19:10').length, 2);
});

test('no closer causes exactly two distinct Late, Ganz, or Flex shifts to be extended by actual end time', () => {
  const plan = planFor({ late: shift('13:00', '19:00', 'late'), full: shift('09:00', '19:00', 'full'), flex: shift('11:00', '19:00', 'flex') });
  const result = applyRule(plan, ['late','full','flex'].map(employee), '2026-04-10');
  assert.equal(result.changedIds.length, 2);
  assert.equal(new Set(result.changedIds).size, 2);
  assert.equal(Object.values(plan.schedule['2026-04-10']).filter(entry => entry.end === '19:10').length, 2);
});

test('carryover-ranked candidate is preferred and receives the following 08:55 start', () => {
  const emps = [employee('regular'), employee('tl', 'TL'), employee('other')];
  const plan = planFor(
    { regular: shift('09:00', '19:00'), tl: shift('13:00', '19:00'), other: shift('09:00', '19:00') },
    { regular: shift('09:00', '17:00'), tl: shift('09:00', '17:00') }
  );
  const result = applyRule(plan, emps, '2026-04-10');
  assert.equal(result.changedIds[0], 'tl');
  assert.equal(plan.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(plan.schedule['2026-04-11'].regular.start, '09:00');
});

test('absence and external-help records are never closing candidates', () => {
  const plan = planFor({ real: shift('09:00', '19:00'), ah: { type: 'external-help', start: '09:00', end: '19:00' }, vacation: { type: 'vacation', end: '19:00' } });
  const before = JSON.stringify(plan);
  const result = applyRule(plan, ['real','ah','vacation'].map(employee), '2026-04-10');
  assert.deepEqual(Array.from(result.changedIds), []);
  assert.equal(result.warning, '19:10: zweite Person fehlt');
  assert.equal(JSON.stringify(plan), before);
});

test('TL wins carryover selection over SV/STV regardless of employee order', () => {
  const emps = [employee('sv', 'STV'), employee('normal'), employee('tl', 'TL')];
  const plan = planFor(
    { sv: shift('09:00', '19:00'), normal: shift('09:00', '19:00'), tl: shift('09:00', '19:00') },
    { sv: shift('09:00', '17:00'), normal: shift('09:00', '17:00'), tl: shift('09:00', '17:00') }
  );
  const result = applyRule(plan, emps, '2026-04-10');
  assert.equal(result.changedIds[0], 'tl');
  assert.equal(plan.schedule['2026-04-11'].tl.start, '08:55');
  assert.equal(plan.schedule['2026-04-11'].sv.start, '09:00');
});

test('SV/STV wins over a normal employee and equal normal candidates keep employee order', () => {
  const svPlan = planFor(
    { normal: shift('09:00', '19:00'), sv: shift('09:00', '19:00') },
    { normal: shift('09:00', '17:00'), sv: shift('09:00', '17:00') }
  );
  assert.equal(applyRule(svPlan, [employee('normal'), employee('sv', 'SV')], '2026-04-10').changedIds[0], 'sv');

  const normalPlan = planFor(
    { second: shift('09:00', '19:00'), first: shift('09:00', '19:00') },
    { second: shift('09:00', '17:00'), first: shift('09:00', '17:00') }
  );
  assert.equal(applyRule(normalPlan, [employee('second'), employee('first')], '2026-04-10').changedIds[0], 'second');
});

test('only candidate 1 receives 08:55 while candidate 2 remains unchanged', () => {
  const plan = planFor(
    { first: shift('09:00', '19:00'), second: shift('09:00', '19:00') },
    { first: shift('09:00', '17:00'), second: shift('09:00', '17:00') }
  );
  applyRule(plan, [employee('first'), employee('second')], '2026-04-10');
  assert.equal(plan.schedule['2026-04-11'].first.start, '08:55');
  assert.equal(plan.schedule['2026-04-11'].second.start, '09:00');
});

test('candidate 2 preference avoids the employee with greater weekly overtime', () => {
  const plan = planFor({ high: shift('09:00', '19:00'), low: shift('09:00', '19:00'), medium: shift('09:00', '19:00') });
  plan.schedule['2026-04-07'] = {
    high: { ...shift('09:00', '19:00'), minutes: 2400 },
    low: { ...shift('09:00', '15:00'), minutes: 300 },
    medium: { ...shift('09:00', '17:00'), minutes: 1200 }
  };
  const result = applyRule(plan, [employee('high'), employee('low'), employee('medium')], '2026-04-10');
  assert.deepEqual(Array.from(result.changedIds), ['low', 'medium']);
});

test('autofix uses central edge-break and worked-minute calculations', () => {
  const cases = [
    ['08:55', 75, 540],
    ['13:00', 10, 360],
    ['09:00', 70, 540]
  ];
  for (const [start, expectedBreak, expectedMinutes] of cases) {
    const plan = planFor({ candidate: shift(start, '19:00'), other: shift('09:00', '19:10') });
    applyRule(plan, [employee('candidate'), employee('other')], '2026-04-10');
    const updated = plan.schedule['2026-04-10'].candidate;
    assert.equal(updated.pause, expectedBreak);
    assert.equal(updated.breakMinutes, expectedBreak);
    assert.equal(updated.minutes, expectedMinutes);
  }
});

test('09:00 to 08:55 carryover recalculates short-shift break and preserves net work', () => {
  const plan = planFor(
    { selected: shift('09:00', '19:00'), second: shift('13:00', '19:00') },
    { selected: { ...shift('09:00', '15:00'), pause: 0, breakMinutes: 0, minutes: 360 } }
  );
  applyRule(plan, [employee('selected'), employee('second')], '2026-04-10');
  const morning = plan.schedule['2026-04-11'].selected;
  assert.equal(morning.start, '08:55');
  assert.equal(morning.pause, 5);
  assert.equal(morning.breakMinutes, 5);
  assert.equal(morning.minutes, 360);
});

test('stale 08:55 is reset to 09:00 with recalculated break and minutes', () => {
  const plan = planFor(
    { selected: shift('09:00', '19:00'), stale: shift('09:00', '19:00') },
    {
      selected: { ...shift('09:00', '15:00'), pause: 0, breakMinutes: 0, minutes: 360 },
      stale: { ...shift('08:55', '15:00'), pause: 5, breakMinutes: 5, minutes: 360 }
    }
  );
  applyRule(plan, [employee('selected'), employee('stale')], '2026-04-10');
  const reset = plan.schedule['2026-04-11'].stale;
  assert.equal(reset.start, '09:00');
  assert.equal(reset.pause, 0);
  assert.equal(reset.breakMinutes, 0);
  assert.equal(reset.minutes, 360);
});

test('scheduled shift covered by vacation is not a closer or autofix candidate', () => {
  const plan = planFor({ vacation: shift('09:00', '19:00'), first: shift('09:00', '19:00'), second: shift('09:00', '19:00') });
  plan.absences = [{ id: 'u1', employeeId: 'vacation', type: 'vacation', from: '2026-04-10', to: '2026-04-10' }];
  const result = applyRule(plan, [employee('vacation'), employee('first'), employee('second')], '2026-04-10');
  assert.deepEqual(Array.from(result.changedIds), ['first', 'second']);
  assert.equal(plan.schedule['2026-04-10'].vacation.end, '19:00');
});

test('scheduled shift covered by sickness is not an 08:55 carryover candidate', () => {
  const plan = planFor(
    { sick: shift('09:00', '19:00'), healthy: shift('09:00', '19:00') },
    { sick: shift('09:00', '15:00'), healthy: shift('09:00', '15:00') }
  );
  plan.absences = [{ id: 'k1', employeeId: 'sick', type: 'sick', from: '2026-04-11', to: '2026-04-11' }];
  applyRule(plan, [employee('sick', 'TL'), employee('healthy')], '2026-04-10');
  assert.equal(plan.schedule['2026-04-11'].sick.start, '09:00');
  assert.equal(plan.schedule['2026-04-11'].healthy.start, '08:55');
});

test('losing a closer to every non-work status rechecks and clears the following opener', () => {
  for (const type of ['vacation', 'sick', 'off', 'holiday', 'external-help']) {
    const hidden = type === 'external-help'
      ? { type: 'external-help', start: '09:00', end: '19:10' }
      : { type, sourceEntry: shift('09:00', '19:10') };
    const plan = planFor(
      { absent: shift('09:00', '19:10'), fixed: shift('13:00', '19:10') },
      { absent: { ...shift('08:55', '15:00'), planning2AutoOpener: true } }
    );
    const originalResolver = rules.getResolvedDayEntry;
    rules.getResolvedDayEntry = options => options.isoDate === '2026-04-10' && options.employee.id === 'absent'
      ? hidden
      : originalResolver(options);

    const result = applyRule(plan, [employee('absent'), employee('fixed')], '2026-04-10');

    assert.equal(result.warning, '19:10: zweite Person fehlt', type);
    assert.equal(plan.schedule['2026-04-11'].absent.start, '09:00', type);
    assert.equal(plan.schedule['2026-04-11'].absent.planning2AutoOpener, undefined, type);
    rules.getResolvedDayEntry = originalResolver;
  }
});

test('replacing an absence with a work shift re-evaluates the following opener', () => {
  const plan = planFor(
    { restored: shift('09:00', '19:10'), fixed: shift('13:00', '19:10') },
    { restored: shift('09:00', '15:00'), stale: { ...shift('08:55', '15:00'), planning2AutoOpener: true } }
  );

  applyRule(plan, [employee('restored', 'TL'), employee('fixed'), employee('stale')], '2026-04-10');

  assert.equal(plan.schedule['2026-04-11'].restored.start, '08:55');
  assert.equal(plan.schedule['2026-04-11'].stale.start, '09:00');
});

test('Saturday closer status changes re-evaluate the linked Monday opener', () => {
  const plan = {
    schedule: {
      '2026-04-11': { absent: shift('09:00', '19:10'), fixed: shift('13:00', '19:10') },
      '2026-04-13': { absent: { ...shift('08:55', '15:00'), planning2AutoOpener: true } }
    },
    absences: [{ id: 'u-saturday', employeeId: 'absent', type: 'vacation', from: '2026-04-11', to: '2026-04-11' }]
  };

  applyRule(plan, [employee('absent'), employee('fixed')], '2026-04-11');

  assert.equal(plan.schedule['2026-04-13'].absent.start, '09:00');
  assert.equal(plan.schedule['2026-04-13'].absent.planning2AutoOpener, undefined);
});

test('candidate 2 workload ignores scheduled hours hidden by a resolved absence', () => {
  const plan = planFor({ closer: shift('09:00', '19:10'), absentLow: shift('09:00', '19:00'), actuallyHigh: shift('09:00', '19:00') });
  plan.schedule['2026-04-07'] = {
    absentLow: { ...shift('09:00', '19:00'), minutes: 2400 },
    actuallyHigh: { ...shift('09:00', '17:00'), minutes: 1200 }
  };
  plan.absences = [{ id: 'u-workload', employeeId: 'absentLow', type: 'vacation', from: '2026-04-07', to: '2026-04-07' }];

  const result = applyRule(plan, [employee('closer'), employee('absentLow'), employee('actuallyHigh')], '2026-04-10');

  assert.deepEqual(Array.from(result.changedIds), ['absentLow']);
  assert.equal(plan.schedule['2026-04-10'].absentLow.end, '19:10');
  assert.equal(plan.schedule['2026-04-10'].actuallyHigh.end, '19:00');
});
