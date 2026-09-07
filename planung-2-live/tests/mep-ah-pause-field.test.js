const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

function loadMepViewContext(entriesByIso) {
  const seedContext = {
    state: { activeMonth: '2026-05' },
    uiState: { mepAnonymized: false },
    ENTRY_STATUS: {
      EXTERNAL: 'external-help',
      VACATION: 'vacation',
      SICK: 'sick'
    },
    fromIsoDate: (iso) => new Date(`${iso}T00:00:00`),
    toIsoDate: (date) => date.toISOString().slice(0, 10),
    pad2: (value) => String(value).padStart(2, '0'),
    minutesToHM: (minutes = 0) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`,
    getEmployeeTargetMinutesForWeek: () => 0,
    getPauseRangeForMep: (entry) => entry.pauseLabel || '',
    diffMinutesBetweenHHMM: () => 0,
    getPauseMinutesForMepDisplay: () => 0,
    getAbsenceMinutesForEmployee: () => 0,
    normalizePlanEntry: (entry) => entry,
    getResolvedStatus: (resolved) => resolved?.status || '',
    getEntryStatus: (entry) => entry?.type,
    getResolvedEntryForEmployeeOnIso: (_employee, isoDate) => ({
      sourceEntry: entriesByIso[isoDate] || null,
      status: entriesByIso[isoDate]?.type || ''
    }),
    getEmployeeAccountMinutesForWeek: () => 0,
    isEmployeeActiveInMonth: () => true
  };

  return loadScripts(['mep-view.js'], seedContext);
}

function getPauseCellTextForDay(html, dayIndex = 0) {
  const pauseRowMatch = html.match(/<tr class="[^"]*mepTplEmployeeRow--pause[^"]*">([\s\S]*?)<\/tr>/);
  assert.ok(pauseRowMatch, 'Pause-Zeile muss vorhanden sein');

  const dayCellRegex = new RegExp(`<td[^>]*data-mep-day-index="${dayIndex}"[^>]*>([\\s\\S]*?)<\\/td>`);
  const dayCellMatch = pauseRowMatch[1].match(dayCellRegex);
  assert.ok(dayCellMatch, `Pause-Tageszelle für Index ${dayIndex} muss vorhanden sein`);

  return dayCellMatch[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

test('MEP: AH mit branch rendert Filiale im Pause-Feld', () => {
  const isoDay = '2026-05-04';
  const ctx = loadMepViewContext({
    [isoDay]: { type: 'external-help', branch: 'Filiale X', start: '09:00', end: '17:00', minutes: 480 }
  });

  const html = ctx.buildMepEmployeeRows({ name: 'Test' }, [{ iso: isoDay, isOutsideMonth: false }], 0, { activeMonth: '2026-05' });
  const pauseText = getPauseCellTextForDay(html, 0);

  assert.equal(pauseText, 'Filiale X');
});

test('MEP: AH ohne branch lässt Pause-Feld leer', () => {
  const isoDay = '2026-05-04';
  const ctx = loadMepViewContext({
    [isoDay]: { type: 'external-help', start: '09:00', end: '17:00', minutes: 480 }
  });

  const html = ctx.buildMepEmployeeRows({ name: 'Test' }, [{ iso: isoDay, isOutsideMonth: false }], 0, { activeMonth: '2026-05' });
  const pauseText = getPauseCellTextForDay(html, 0);

  assert.equal(pauseText, '');
});

test('MEP: normale Schicht behält bisherige Pausendarstellung', () => {
  const isoDay = '2026-05-04';
  const ctx = loadMepViewContext({
    [isoDay]: { type: 'shift', pauseLabel: '12:00-12:30', start: '09:00', end: '17:00', minutes: 450 }
  });

  const html = ctx.buildMepEmployeeRows({ name: 'Test' }, [{ iso: isoDay, isOutsideMonth: false }], 0, { activeMonth: '2026-05' });
  const pauseText = getPauseCellTextForDay(html, 0);

  assert.equal(pauseText, '12:00-12:30');
});
