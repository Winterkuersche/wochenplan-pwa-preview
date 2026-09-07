function collectRelevantYearMonthsUntilActiveMonthBalance({
  activeYearMonth,
  scheduleIsoDates = [],
  absences = [],
  manualMonthActualMinutes = {},
  historyStartMonth = '2026-01'
} = {}) {
  const normalizedActive = normalizeYearMonth(activeYearMonth);
  if (!normalizedActive) return [];

  const candidates = [normalizedActive];

  scheduleIsoDates.forEach((isoDate) => {
    const month = normalizeYearMonth(String(isoDate || '').slice(0, 7));
    if (month && month >= historyStartMonth && month <= normalizedActive) {
      candidates.push(month);
    }
  });

  absences.forEach((entry) => {
    const fromMonth = normalizeYearMonth(String(entry?.from || '').slice(0, 7));
    const toMonth = normalizeYearMonth(String(entry?.to || '').slice(0, 7));

    if (fromMonth && fromMonth >= historyStartMonth && fromMonth <= normalizedActive) {
      candidates.push(fromMonth);
    }
    if (toMonth && toMonth >= historyStartMonth && toMonth <= normalizedActive) {
      candidates.push(toMonth);
    }
  });

  Object.keys(manualMonthActualMinutes || {}).forEach((month) => {
    const normalized = normalizeYearMonth(month);
    if (normalized && normalized >= historyStartMonth && normalized <= normalizedActive) {
      candidates.push(normalized);
    }
  });

  const unique = [...new Set(candidates)].sort();
  const first = unique[0] < historyStartMonth ? historyStartMonth : unique[0];

  const months = [];
  let cursor = first;
  while (cursor && cursor <= normalizedActive) {
    months.push(cursor);
    cursor = shiftYearMonthByMonths(cursor, 1);
  }

  return months;
}
