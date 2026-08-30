const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync('time-utils.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('employee-availability.js', 'utf8'), context);

const resolve = vm.runInContext('resolveEmployeeAvailability', context);
const validate = vm.runInContext('validateShiftAgainstEmployeeAvailability', context);
const normalize = vm.runInContext('normalizeEmployeeAvailability', context);
const facts = vm.runInContext('getEmployeePlanning2PreferenceFacts', context);

test('date availability takes priority over weekday and general availability', () => {
  const employee = { availability: {
    general: { earliestStart: '09:00', latestEnd: '17:00', maxShiftMinutes: 480 },
    weekdays: { 1: { earliestStart: '10:00', latestEnd: '18:00', maxShiftMinutes: 420 } },
    dates: { '2026-08-31': { earliestStart: '12:00', latestEnd: '19:10', maxShiftMinutes: 360 } }
  } };
  assert.deepEqual({ ...resolve(employee, '2026-08-31') }, {
    isoDate: '2026-08-31', source: 'date', earliestStart: '12:00', latestEnd: '19:10', maxShiftMinutes: 360
  });
  assert.equal(resolve(employee, '2026-09-07').source, 'weekday');
  assert.equal(resolve(employee, '2026-09-08').source, 'general');
});

test('an explicitly empty higher-priority override means unrestricted availability', () => {
  const employee = { availability: { general: { earliestStart: '10:00' }, weekdays: { 1: {} }, dates: {} } };
  const monday = resolve(employee, '2026-08-31');
  assert.equal(monday.source, 'weekday');
  assert.equal(monday.earliestStart, null);
  assert.equal(validate(employee, '2026-08-31', '08:55', '12:00').valid, true);
});

test('missing availability does not infer restrictions from historical shifts', () => {
  const employee = { shifts: { old: { start: '12:00', end: '16:00' } } };
  assert.equal(resolve(employee, '2026-08-31').source, 'none');
  assert.equal(validate(employee, '2026-08-31', '08:55', '19:10').valid, true);
});

test('maximum shift duration and hard boundaries produce structured violations', () => {
  const employee = { availability: { general: { earliestStart: '09:00', latestEnd: '18:00', maxShiftMinutes: 360 } } };
  assert.deepEqual(Array.from(validate(employee, '2026-09-01', '08:55', '19:10').violations, item => item.code), [
    'BEFORE_AVAILABILITY', 'AFTER_AVAILABILITY', 'MAX_SHIFT_DURATION'
  ]);
  assert.equal(validate(employee, '2026-09-01', '09:00', '15:00').valid, true);
});

test('preference facts normalize Early, Late, Any and flexible week distribution', () => {
  assert.deepEqual({ ...facts({ timePreference: 'early', flexibleWeekDistribution: true }) }, { timePreference: 'early', flexibleWeekDistribution: true });
  assert.equal(facts({ timePreference: 'late' }).timePreference, 'late');
  assert.equal(facts({ timePreference: 'invalid' }).timePreference, 'any');
});

test('availability normalization creates backup-safe plain master data', () => {
  const value = normalize({ general: { earliestStart: '9:02', maxShiftMinutes: 367 }, weekdays: { 2: { latestEnd: '19:10' } }, dates: { '2026-09-02': {} } });
  assert.equal(JSON.stringify(value), '{"general":{"earliestStart":"09:00","maxShiftMinutes":360},"weekdays":{"2":{"latestEnd":"19:10"}},"dates":{"2026-09-02":{}}}');
});
