const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.value = '';
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.dataset = {};
    this.attributes = new Map();
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => false,
      contains: () => false
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    handlers.forEach((handler) => handler({ target: this, ...event }));
  }

  querySelector() {
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) || null;
  }
  focus() {}
}

function buildContext() {
  const elementsById = new Map();
  const body = new MockElement('body');
  const documentListeners = new Map();
  const document = {
    createElement: (tagName) => new MockElement(tagName),
    getElementById: (id) => {
      if (!elementsById.has(id)) elementsById.set(id, new MockElement('div'));
      return elementsById.get(id);
    },
    addEventListener: (type, handler) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    dispatchEvent: (type, event = {}) => {
      const handlers = documentListeners.get(type) || [];
      handlers.forEach((handler) => handler(event));
    },
    activeElement: null,
    body
  };

  return loadScripts(['week-view.js'], {
    document,
    window: { addEventListener: () => {} },
    HTMLElement: MockElement,
    alert: () => {},
    confirm: () => true,
    state: { absences: [], schedule: {}, employees: [] },
    getShiftSelectOptions: () => [
      { group: 'Schichten', value: '-', label: '-' },
      { group: 'Schichten', value: 'FO', label: 'FO' },
      { group: 'Abwesenheiten', value: 'K', label: 'K' }
    ],
    getWeekCellFlags: () => ({ isLateToEarlyBridge: false }),
    isClosingResolvedEntry: () => false,
    isEarlyStartEntry: () => false,
    getResolvedEntryForEmployeeOnIso: () => ({ type: 'none' }),
    getResolvedStatus: () => null,
    getDialogTypeFromResolvedEntry: () => null,
    getShiftCodeForSelectValue: (value) => value,
    getShiftClassByKey: () => 'free',
    isDialogShift: () => false,
    openShiftDialog: () => {},
    getBlockingTypeForEmployeeOnIso: () => null,
    decideMutationForIsoRange: () => ({ allow: true }),
    buildEarlyShiftEntry: (code) => ({ type: 'shift', code }),
    setShift: () => true,
    setOffDay: () => true,
    setPlanEntry: () => {},
    clearDay: () => {},
    commitPlanChange: () => {},
    subtractRangeFromAbsenceEntry: (entry) => [entry],
    saveAppStateDebounced: () => {},
    renderAllViews: () => {},
    fromIsoDate: () => new Date('2026-03-29T00:00:00Z'),
    toIsoDate: () => '2026-03-29',
    syncVacationScheduleFromAbsences: () => {},
    setAbsence: () => {},
    clearPlanEntry: () => {},
    getPlanEntry: () => null,
    diffMinutesBetweenHHMM: () => 60,
    getExternalHelpBreakDeductionMinutes: () => 0,
    getExternalHelpWorkedMinutes: () => 60,
    normalizePlanTime: (v) => v,
    isAllowedPlanTime: () => true,
    ENTRY_STATUS: { EXTERNAL: 'external', OFF: 'off' },
    getEntryStatus: (entry) => entry?.status || 'empty',
    getShiftRuleByCode: () => ({ entryType: 'shift' }),
    buildLateShiftEntry: () => ({ type: 'shift' }),
    buildFullShiftEntry: () => ({ type: 'shift' }),
    buildFoShiftEntry: () => ({ type: 'shift' }),
    buildFlexibleShiftEntry: () => ({ type: 'shift' }),
    getQuarterPickerValue: () => '08:00',
    addMinutesToHHMM: () => '09:00',
    formatQuarterHourTime: () => '00:00',
    hhmmToMinutes: () => 0,
    minutesToHM: () => '0:00',
    isGfbEmployee: () => false,
    getEmployeeLastShiftLabel: () => '',
    getEmployeePlannedMinutesForWeek: () => 0,
    getEmployeeWeekDifferenceMinutes: () => 0,
    getEmployeeMonthDifferenceMinutes: () => 0,
    isMonthActualManual: () => false,
    getEmployeeTotalMinusMinutes: () => 0,
    getEmployeeMonthContingentRemainingMinutes: () => 0,
    getEmployeeMonthContingentOveruseMinutes: () => 0,
    getDeltaVisualState: () => 'deltaZero',
    getRestOverVisualState: () => 'deltaZero',
    getEmployeeTargetMinutesForWeek: () => 0,
    formatSignedMinutes: () => '0:00',
    getAbsenceTypeMeta: () => ({ invalidRangeMessage: 'x', confirmDeleteMessage: 'x', title: 'x' }),
    getAbsenceTypeFromDialogContext: (v) => (v === 'K' ? 'sick' : 'vacation'),
    pad2: (value) => String(value).padStart(2, '0')
  });
}

test('clearDayRange aborts entirely when mutation decision denies the range', () => {
  const ctx = buildContext();
  const calls = [];

  ctx.decideMutationForIsoRange = () => ({ allow: false, reason: 'holiday' });
  ctx.clearDay = (...args) => calls.push(['clearDay', ...args]);
  ctx.commitPlanChange = () => calls.push(['commit']);

  const result = ctx.clearDayRange('e1', '2026-12-24', '2026-12-26', { commit: false });

  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test('vacation day can be changed directly to shift and only that day is removed from absence coverage', () => {
  const ctx = buildContext();
  const calls = [];

  ctx.getWeekSelectValueForDay = () => 'U';
  ctx.getBlockingTypeForEmployeeOnIso = () => 'vacation';
  ctx.setShift = (...args) => {
    calls.push(['setShift', ...args]);
    return true;
  };

  const wrap = ctx.createWeekSelect({ id: 'e1' }, '2026-04-02');
  const select = wrap.children[0];
  select.value = 'FO';
  select.dispatchEvent('change');

  assert.deepEqual(calls[0], ['setShift', 'e1', '2026-04-02', { type: 'shift', code: 'FO' }]);
});

test('vacation day can directly switch to sick absence (other absence type)', () => {
  const ctx = buildContext();
  let openedDialog = false;
  ctx.openShiftDialogForSelectValue = () => {
    openedDialog = true;
    return true;
  };

  const wrap = ctx.createWeekSelect({ id: 'e1' }, '2026-04-03');
  const select = wrap.children[0];
  select.value = 'K';
  select.dispatchEvent('change');

  assert.equal(openedDialog, true);
});

test('vacation day can be cleared with "-" and removes vacation coverage for that day', () => {
  const ctx = buildContext();
  const calls = [];

  ctx.getWeekSelectValueForDay = () => 'U';
  ctx.getBlockingTypeForEmployeeOnIso = () => 'vacation';
  ctx.clearDay = (...args) => calls.push(args);

  const wrap = ctx.createWeekSelect({ id: 'e1' }, '2026-04-04');
  const select = wrap.children[0];
  select.value = '-';
  select.dispatchEvent('change');

  assert.deepEqual(calls[0], ['e1', '2026-04-04']);
});

test('day can be set directly to Frei (FR)', () => {
  const ctx = buildContext();
  const calls = [];

  ctx.setOffDay = (...args) => {
    calls.push(['setOffDay', ...args]);
    return true;
  };

  const wrap = ctx.createWeekSelect({ id: 'e1' }, '2026-04-05');
  const select = wrap.children[0];
  select.value = 'FR';
  select.dispatchEvent('change');

  assert.deepEqual(calls[0], ['setOffDay', 'e1', '2026-04-05']);
});

test('holiday remains locked and disabled', () => {
  const ctx = buildContext();
  ctx.getWeekSelectValueForDay = () => 'H';
  ctx.getBlockingTypeForEmployeeOnIso = () => 'holiday';

  const wrap = ctx.createWeekSelect({ id: 'e1' }, '2026-12-25');
  const select = wrap.children[0];

  assert.equal(select.disabled, true);
  assert.equal(select.value, 'H');
  assert.equal(select.children.length, 1);
  assert.equal(select.children[0].value, 'H');
});

test('mobile chip outside active month stays editable and opens week selection dialog', () => {
  const ctx = buildContext();
  let opened = 0;
  ctx.openWeekMobileSelectDialog = () => {
    opened += 1;
    return true;
  };
  ctx.getActiveWeekDays = () => [
    { iso: '2026-05-01', isOutsideMonth: true, weekdayLabel: 'Fr', date: new Date('2026-05-01T00:00:00Z') }
  ];
  ctx.getWeekVisibleEmployees = () => [{ id: 'e1', name: 'Max', roleKey: 'FO' }];
  ctx.getEmployeeWeekMetrics = () => ({
    actualText: '0:00',
    accountText: '0:00',
    weekDeltaText: '0:00',
    weekDeltaClass: 'deltaZero',
    monthDeltaText: '0:00',
    monthDeltaClass: 'deltaZero',
    totalMinusText: '0:00',
    totalMinusClass: 'deltaZero',
    targetText: '0:00'
  });
  ctx.getWeekSelectValueForDay = () => '-';

  ctx.renderWeekMobileCards();
  const cardsEl = ctx.document.getElementById('weekMobileCards');
  const chip = cardsEl.children[0].children[1].children[0];
  assert.equal(chip.disabled, false);
  assert.match(chip.getAttribute('aria-label'), /außerhalb des aktiven Monats, bearbeitbar/);
  chip.dispatchEvent('click');

  assert.equal(opened, 1);
});

test('week metrics across month boundary include all six visible days and bypass month filter', () => {
  const ctx = buildContext();
  const employee = { id: 'e1', name: 'Max' };
  const visibleDays = [
    { iso: '2026-04-27' }, // Mo
    { iso: '2026-04-28' }, // Di
    { iso: '2026-04-29' }, // Mi
    { iso: '2026-04-30' }, // Do
    { iso: '2026-05-01' }, // Fr
    { iso: '2026-05-02' }  // Sa
  ];
  const accountCalls = [];
  const targetCalls = [];

  ctx.getEmployeePlannedMinutesForWeek = () => 0;
  ctx.getEmployeeAccountMinutesForWeek = (...args) => {
    accountCalls.push(args);
    return 0;
  };
  ctx.getEmployeeWeekDifferenceMinutes = () => 0;
  ctx.getEmployeeMonthDifferenceMinutes = () => 0;
  ctx.isMonthActualManual = () => false;
  ctx.getEmployeeTotalMinusMinutes = () => 0;
  ctx.getEmployeeMonthContingentRemainingMinutes = () => 0;
  ctx.getEmployeeMonthContingentOveruseMinutes = () => 0;
  ctx.getEmployeeTargetMinutesForWeek = (...args) => {
    targetCalls.push(args);
    return 0;
  };

  ctx.getEmployeeWeekMetrics(employee, visibleDays);

  assert.equal(accountCalls.length, 1);
  assert.equal(targetCalls.length, 1);
  assert.deepEqual(accountCalls[0][1].map((day) => day.iso), visibleDays.map((day) => day.iso));
  assert.deepEqual(targetCalls[0][1].map((day) => day.iso), visibleDays.map((day) => day.iso));
  assert.equal(accountCalls[0][2], null);
  assert.equal(targetCalls[0][2], null);
});

test('week header branch summary hours include all six visible days across month boundary', () => {
  const ctx = buildContext();
  const calls = [];
  const weekTable = new MockElement('table');
  const weekThead = new MockElement('thead');
  weekTable.querySelector = (selector) => (selector === 'thead' ? weekThead : null);

  ctx.document.getElementById = (id) => {
    if (id === 'weekTable') return weekTable;
    return new MockElement('div');
  };
  ctx.getActiveWeekDays = () => ([
    { iso: '2026-04-27', weekdayLabel: 'Mo', date: new Date('2026-04-27T00:00:00Z'), isOutsideMonth: false },
    { iso: '2026-04-28', weekdayLabel: 'Di', date: new Date('2026-04-28T00:00:00Z'), isOutsideMonth: false },
    { iso: '2026-04-29', weekdayLabel: 'Mi', date: new Date('2026-04-29T00:00:00Z'), isOutsideMonth: false },
    { iso: '2026-04-30', weekdayLabel: 'Do', date: new Date('2026-04-30T00:00:00Z'), isOutsideMonth: false },
    { iso: '2026-05-01', weekdayLabel: 'Fr', date: new Date('2026-05-01T00:00:00Z'), isOutsideMonth: true },
    { iso: '2026-05-02', weekdayLabel: 'Sa', date: new Date('2026-05-02T00:00:00Z'), isOutsideMonth: true },
    { iso: '2026-05-03', weekdayLabel: 'So', date: new Date('2026-05-03T00:00:00Z'), isOutsideMonth: true }
  ]);
  ctx.totalMinutesForDayIso = (iso) => {
    calls.push(iso);
    return 0;
  };
  ctx.getWeekDayHeaderMeta = () => ({ closersState: 'ok', closersText: '19:10 2/2', handoverState: 'none', handoverText: '' });

  ctx.renderWeekHeader();

  assert.deepEqual(calls, [
    '2026-04-27',
    '2026-04-28',
    '2026-04-29',
    '2026-04-30',
    '2026-05-01',
    '2026-05-02'
  ]);
});

test('mobile selection FO applies early shift directly', () => {
  const ctx = buildContext();
  const calls = [];
  ctx.setShift = (...args) => {
    calls.push(['setShift', ...args]);
    return true;
  };
  ctx.renderWeekView = () => {};
  ctx.getWeekSelectValueForDay = () => '-';

  ctx.getShiftSelectOptions = () => [{ value: 'FO', label: 'FO' }];
  ctx.openWeekMobileSelectDialog({ id: 'e1' }, '2026-04-07');
  const overlay = ctx.document.body.children[0];
  const optionButton = overlay.children[0].children[1].children[0];
  optionButton.dispatchEvent('click');

  assert.equal(calls.some((entry) => entry[0] === 'setShift'), true);
});

test('mobile selection U opens absence dialog flow', () => {
  const ctx = buildContext();
  const calls = [];
  ctx.renderWeekView = () => {};
  ctx.getShiftSelectOptions = () => [{ value: 'U', label: 'U' }];
  ctx.isDialogShift = (value) => value === 'U';
  ctx.openShiftDialog = (...args) => calls.push(args);
  ctx.getWeekSelectValueForDay = () => '-';

  ctx.openWeekMobileSelectDialog({ id: 'e1' }, '2026-04-08');
  const overlay = ctx.document.body.children[0];
  const optionButton = overlay.children[0].children[1].children[0];
  optionButton.dispatchEvent('click');

  assert.equal(calls[0][0], 'U');
  assert.equal(calls[0][1].isoDate, '2026-04-08');
  assert.equal(calls[0][1].type, 'U');
  assert.equal(calls[0][1].emp.id, 'e1');
});

test('mobile holiday remains not editable', () => {
  const ctx = buildContext();
  ctx.getBlockingTypeForEmployeeOnIso = () => 'holiday';

  const opened = ctx.openWeekMobileSelectDialog({ id: 'e1' }, '2026-12-25');
  assert.equal(opened, false);
  assert.equal(ctx.document.body.children.length, 0);
});

test('mobile dialog closes on Escape and removes overlay', () => {
  const ctx = buildContext();
  ctx.getShiftSelectOptions = () => [{ value: 'FO', label: 'FO' }];

  ctx.openWeekMobileSelectDialog({ id: 'e1' }, '2026-04-09');
  assert.equal(ctx.document.body.children.length, 1);

  ctx.document.dispatchEvent('keydown', {
    key: 'Escape',
    preventDefault: () => {}
  });

  assert.equal(ctx.document.body.children.length, 0);
});

test('mobile dialog excludes holiday option values', () => {
  const ctx = buildContext();
  ctx.getShiftSelectOptions = () => [
    { value: 'H', label: 'H' },
    { value: 'FO', label: 'FO' }
  ];

  ctx.openWeekMobileSelectDialog({ id: 'e1' }, '2026-04-10');
  const overlay = ctx.document.body.children[0];
  const optionsWrap = overlay.children[0].children[1];
  assert.equal(optionsWrap.children.length, 1);
  assert.equal(optionsWrap.children[0].value, 'FO');
});

test('FLEX start change keeps end at or after start', () => {
  const ctx = buildContext();
  ctx.normalizePlanTime = (v) => v;
  ctx.hhmmToMinutes = (v) => {
    const [h, m] = v.split(':').map(Number);
    return (h * 60) + m;
  };
  ctx.addMinutesToHHMM = (v, mins) => {
    const total = ctx.hhmmToMinutes(v) + mins;
    const hour = String(Math.floor(total / 60)).padStart(2, '0');
    const minute = String(total % 60).padStart(2, '0');
    return `${hour}:${minute}`;
  };

  const flexStartHour = ctx.document.getElementById('shiftDialogFlexStartHour');
  const flexStartMinute = ctx.document.getElementById('shiftDialogFlexStartMinute');
  const flexEndHour = ctx.document.getElementById('shiftDialogFlexEndHour');
  const flexEndMinute = ctx.document.getElementById('shiftDialogFlexEndMinute');

  flexStartHour.value = '10';
  flexStartMinute.value = '15';
  flexEndHour.value = '09';
  flexEndMinute.value = '00';
  flexStartHour.dispatchEvent('change');

  assert.equal(flexEndHour.value, '10');
  assert.equal(flexEndMinute.value, '15');
});

test('AH start change keeps end at or after start', () => {
  const ctx = buildContext();
  ctx.normalizePlanTime = (v) => v;
  ctx.hhmmToMinutes = (v) => {
    const [h, m] = v.split(':').map(Number);
    return (h * 60) + m;
  };
  ctx.addMinutesToHHMM = (v, mins) => {
    const total = ctx.hhmmToMinutes(v) + mins;
    const hour = String(Math.floor(total / 60)).padStart(2, '0');
    const minute = String(total % 60).padStart(2, '0');
    return `${hour}:${minute}`;
  };

  const ahStartHour = ctx.document.getElementById('shiftDialogExternalHelpStartHour');
  const ahStartMinute = ctx.document.getElementById('shiftDialogExternalHelpStartMinute');
  const ahEndHour = ctx.document.getElementById('shiftDialogExternalHelpEndHour');
  const ahEndMinute = ctx.document.getElementById('shiftDialogExternalHelpEndMinute');

  ahStartHour.value = '11';
  ahStartMinute.value = '30';
  ahEndHour.value = '10';
  ahEndMinute.value = '15';
  ahStartMinute.dispatchEvent('change');

  assert.equal(ahEndHour.value, '11');
  assert.equal(ahEndMinute.value, '30');
});
