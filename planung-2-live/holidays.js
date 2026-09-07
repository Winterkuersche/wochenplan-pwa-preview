const HOLIDAYS_BY_STATE = {
  "schleswig-holstein": {
    2026: [
      { date: "2026-01-01", name: "Neujahr", code: "H" },
      { date: "2026-04-03", name: "Karfreitag", code: "H" },
      { date: "2026-04-06", name: "Ostermontag", code: "H" },
      { date: "2026-05-01", name: "Tag der Arbeit", code: "H" },
      { date: "2026-05-14", name: "Christi Himmelfahrt", code: "H" },
      { date: "2026-05-25", name: "Pfingstmontag", code: "H" },
      { date: "2026-10-03", name: "Tag der Deutschen Einheit", code: "H" },
      { date: "2026-10-31", name: "Reformationstag", code: "H" },
      { date: "2026-12-25", name: "1. Weihnachtstag", code: "H" },
      { date: "2026-12-26", name: "2. Weihnachtstag", code: "H" }
    ]
  }
};

function getHolidaysForStateYear(stateKey, year) {
  return HOLIDAYS_BY_STATE[stateKey]?.[year] || [];
}

function getHolidayByDate(stateKey, isoDate) {
  if (!isoDate) return null;

  const year = Number(String(isoDate).slice(0, 4));
  if (Number.isNaN(year)) return null;

  const holidays = getHolidaysForStateYear(stateKey, year);
  return holidays.find((holiday) => holiday.date === isoDate) || null;
}

function isHolidayDate(stateKey, isoDate) {
  return !!getHolidayByDate(stateKey, isoDate);
}
