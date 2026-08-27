const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts(['time-utils.js'], {
  ENTRY_STATUS: { EXTERNAL: 'external-help', WORK: 'shift' },
  getEntryStatus: (entry) => entry?.type || 'shift'
});

test('normalizePlanTime keeps explicit exceptions', () => {
  assert.equal(ctx.normalizePlanTime('08:55'), '08:55');
  assert.equal(ctx.normalizePlanTime('19:10'), '19:10');
});

test('normalizePlanTime rounds quarter-hour times', () => {
  assert.equal(ctx.normalizePlanTime('09:07'), '09:00');
  assert.equal(ctx.normalizePlanTime('09:08'), '09:15');
});

test('required break after > 6h span', () => {
  assert.equal(ctx.getRequiredBreakMinutesForSpan('09:00', '15:00'), 0);
  assert.equal(ctx.getRequiredBreakMinutesForSpan('09:00', '15:01'), 60);
});


test('business required break minutes applies deterministic base and surcharges', () => {
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '15:00'), 5);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '15:15'), 65);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('09:00', '15:00'), 0);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('13:00', '19:10'), 10);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('12:45', '19:10'), 70);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('09:00', '19:10'), 70);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '19:10'), 75);

  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('09:00', '19:10'), 60);
  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('08:55', '19:10'), 65);
  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('08:55', '19:10'), 60);
  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('12:45', '19:10'), 65);
  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('08:55', '15:00'), 65);
  assert.notEqual(ctx.getBusinessRequiredBreakMinutes('13:00', '19:10'), 70);
});

test('configured breaks do not alter the established central business rules', () => {
  assert.equal(ctx.getBusinessRequiredBreakMinutes('11:00', '18:00', 90), 60);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('09:00', '15:00', 60), 0);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '15:00', 60), 5);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('13:00', '19:10', 60), 10);
  assert.equal(ctx.getWorkedMinutesFromRange('11:00', '18:00', 60), 360);
});

test('MEP preserves explicit pauses only for flexible shifts', () => {
  assert.equal(ctx.getPauseMinutesForMepDisplay({ type: 'shift', code: 'FLEX', mode: 'flex', start: '11:00', end: '18:00', pause: 60 }), 60);
  assert.equal(ctx.getPauseMinutesForMepDisplay({ type: 'shift', code: 'FO', start: '09:00', end: '15:00', pause: 60 }), 0);
});

test('MEP pause minutes use same business break values for edge ranges', () => {
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '08:55', end: '15:00', pause: 0 }),
    5
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '13:00', end: '19:10', pause: 0 }),
    10
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '08:55', end: '15:15', pause: 0 }),
    65
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '12:45', end: '19:10', pause: 0 }),
    70
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '09:00', end: '19:10', pause: 0 }),
    70
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '08:55', end: '19:10', pause: 0 }),
    75
  );
  assert.equal(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '09:00', end: '15:00', pause: 0 }),
    0
  );

  assert.notEqual(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '08:55', end: '15:00', pause: 0 }),
    65
  );
  assert.notEqual(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '13:00', end: '19:10', pause: 0 }),
    70
  );
  assert.notEqual(
    ctx.getPauseMinutesForMepDisplay({ type: 'shift', start: '09:00', end: '19:10', pause: 0 }),
    60
  );
});

test('edge minutes do not trigger a higher regular break tier', () => {
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '15:00'), 5);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('13:00', '19:10'), 10);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '19:00'), 65);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('09:00', '19:10'), 70);
  assert.equal(ctx.getBusinessRequiredBreakMinutes('08:55', '19:10'), 75);
});
