function getVacationHolidayStateKey() {
  return APP_META?.stateKey || null;
}

function isWorkdayForVacation(isoDate, options = {}) {
  const date = fromIsoDate(isoDate);
  if (!date) return false;

  const {
    considerHolidays = false,
    stateKey = getVacationHolidayStateKey()
  } = options;

  // Sonntag nicht zählen
  if (date.getDay() === 0) return false;

  if (considerHolidays && stateKey && typeof getHolidayByDate === "function") {
    return !getHolidayByDate(stateKey, isoDate);
  }

  return true;
}

function countVacationDaysInRange(fromIso, toIso) {
  const from = fromIsoDate(fromIso);
  const to = fromIsoDate(toIso);

  if (!from || !to || to < from) return 0;

  let count = 0;
  const cursor = new Date(from);

  while (cursor <= to) {
    const iso = toIsoDate(cursor);

    if (isWorkdayForVacation(iso, { considerHolidays: true })) {
      count += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

function countVacationDaysInRangeForYear(fromIso, toIso, year) {
  const from = fromIsoDate(fromIso);
  const to = fromIsoDate(toIso);

  if (!from || !to || to < from) return 0;
  if (!year) return countVacationDaysInRange(fromIso, toIso);

  let count = 0;
  const cursor = new Date(from);

  while (cursor <= to) {
    if (cursor.getFullYear() === year) {
      const iso = toIsoDate(cursor);

      if (isWorkdayForVacation(iso, { considerHolidays: true })) {
        count += 1;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

function getUsedVacationDaysForEmployeeFromAbsences(absences, employeeId, year = null) {
  if (!employeeId) return 0;

  const vacationEntries = getVacationEntriesForEmployeeFromAbsences(absences, employeeId);
  return vacationEntries.reduce((sum, entry) => {
    return sum + countVacationDaysInRangeForYear(entry.from, entry.to, year);
  }, 0);
}

function getAgeOnDate(birthDate, isoDate) {
  const birth = fromIsoDate(birthDate);
  const date = fromIsoDate(isoDate);

  if (!birth || !date) return 0;

  let age = date.getFullYear() - birth.getFullYear();
  const monthDiff = date.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && date.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age;
}

function getVacationDaysByAgeForYear(emp, year) {
  if (!emp?.birthDate) {
    return Number(emp?.totalVacationDays ?? emp?.vacationDays ?? 30);
  }

  const ageOnYearStart = getAgeOnDate(emp.birthDate, `${year}-01-01`);

  if (ageOnYearStart >= 30) return 36;
  if (ageOnYearStart >= 28) return 34;
  if (ageOnYearStart >= 26) return 32;
  if (ageOnYearStart >= 24) return 30;

  return 30;
}

function calculateVacationDays(emp, year) {
  let days = getVacationDaysByAgeForYear(emp, year);

  if (emp?.serviceBonus) {
    days += 1;
  }

  return days;
}

function getVacationSummaryForEmployee(emp, year = new Date().getFullYear(), options = {}) {
  const {
    usedVacationDays = null
  } = options;
  const total = Number(emp?.totalVacationDays ?? calculateVacationDays(emp, year));
  const used = Number.isFinite(usedVacationDays)
    ? usedVacationDays
    : getUsedVacationDaysForEmployeeFromAbsences(options.absences || [], emp?.id, year);

  return {
    total,
    used,
    remaining: total - used
  };
}

function getRemainingVacationDaysForEmployee(emp, year = new Date().getFullYear(), options = {}) {
  return getVacationSummaryForEmployee(emp, year, options).remaining;
}

function formatVacationRange(entry) {
  if (!entry?.from || !entry?.to) return "—";

  const from = fromIsoDate(entry.from);
  const to = fromIsoDate(entry.to);

  if (!from || !to) {
    return `${entry.from} – ${entry.to}`;
  }

  const fromText = `${pad2(from.getDate())}.${pad2(from.getMonth() + 1)}.${from.getFullYear()}`;
  const toText = `${pad2(to.getDate())}.${pad2(to.getMonth() + 1)}.${to.getFullYear()}`;

  return `${fromText} – ${toText}`;
}

function getVacationMonthsForEmployeeFromAbsences(absences, employeeId, year) {
  const months = new Array(12).fill(false);
  if (!employeeId) return months;

  const entries = getVacationEntriesForEmployeeFromAbsences(absences || [], employeeId);

  entries.forEach((entry) => {
    const from = fromIsoDate(entry.from);
    const to = fromIsoDate(entry.to);
    if (!from || !to) return;

    const cursor = new Date(from);
    while (cursor <= to) {
      if (cursor.getFullYear() === year) {
        months[cursor.getMonth()] = true;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return months;
}
