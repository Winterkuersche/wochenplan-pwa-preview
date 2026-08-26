function getScheduleEntryForEmployeeOnDate(schedule, employeeId, isoDate) {
  if (!schedule || !employeeId || !isoDate) return null;
  return schedule?.[isoDate]?.[employeeId] || null;
}

function isExternalHelpEntry(entry) {
  return getEntryStatus(entry) === ENTRY_STATUS.EXTERNAL;
}

function getExternalHelpDisplayLabel(entry) {
  if (!isExternalHelpEntry(entry)) return "";
  return entry.label || "AH";
}

function getExternalHelpMinutes(entry) {
  if (!isExternalHelpEntry(entry)) return 0;

  if (typeof entry.minutes === "number") {
    return Math.max(0, entry.minutes);
  }

  if (typeof entry.minutes === "string") {
    return Math.max(0, hhmmToMinutes(entry.minutes));
  }

  return 0;
}

function createResolvedDayEntry({
  type = "off",
  status = ENTRY_STATUS.EMPTY,
  label = "",
  minutesForMonth = 0,
  minutesForBranch = 0,
  isSunday = false,
  isHoliday = false,
  holidayName = "",
  sourceEntry = null
} = {}) {
  return {
    type,
    status,
    label,
    minutesForMonth: Math.max(0, minutesForMonth || 0),
    minutesForBranch: Math.max(0, minutesForBranch || 0),
    isSunday: !!isSunday,
    isHoliday: !!isHoliday,
    holidayName: holidayName || "",
    sourceEntry
  };
}

function getResolvedDayEntry({
  employee,
  isoDate,
  schedule,
  absences,
  stateKey
}) {
  if (!employee || !employee.id || !isoDate) {
    return createResolvedDayEntry();
  }

  const sunday = isSundayIsoDate(isoDate);
  const holiday = getHolidayByDate(stateKey, isoDate);
  const absence = getPriorityAbsenceForEmployeeOnDate(absences, employee.id, isoDate);
  const plannedEntry = getScheduleEntryForEmployeeOnDate(schedule, employee.id, isoDate);

    if (sunday) {
    return createResolvedDayEntry({
      type: "off",
      status: ENTRY_STATUS.OFF,
      label: "",
      minutesForMonth: 0,
      minutesForBranch: 0,
      isSunday: true
    });
  }

  if (holiday) {
    return createResolvedDayEntry({
      type: "holiday",
      status: ENTRY_STATUS.OFF,
      label: "H",
      minutesForMonth: sunday ? 0 : getAbsenceMinutesForEmployee(employee),
      minutesForBranch: 0,
      isSunday: sunday,
      isHoliday: true,
      holidayName: holiday.name,
      sourceEntry: holiday
    });
  }

  if (absence?.type === "sick") {
    return createResolvedDayEntry({
      type: "sick",
      status: ENTRY_STATUS.SICK,
      label: getStatusShortLabel(ENTRY_STATUS.SICK),
      minutesForMonth: sunday ? 0 : getAbsenceMinutesForEmployee(employee),
      minutesForBranch: 0,
      isSunday: sunday,
      sourceEntry: absence
    });
  }

  if (absence?.type === "vacation") {
    return createResolvedDayEntry({
      type: "vacation",
      status: ENTRY_STATUS.VACATION,
      label: getStatusShortLabel(ENTRY_STATUS.VACATION),
      minutesForMonth: getAbsenceMinutesForEmployee(employee),
      minutesForBranch: 0,
      isSunday: sunday,
      sourceEntry: absence
    });
  }

  if (isExternalHelpEntry(plannedEntry)) {
    return createResolvedDayEntry({
      type: "external-help",
      status: ENTRY_STATUS.EXTERNAL,
      label: getExternalHelpDisplayLabel(plannedEntry) || getStatusShortLabel(ENTRY_STATUS.EXTERNAL),
      minutesForMonth: sunday ? 0 : getExternalHelpMinutes(plannedEntry),
      minutesForBranch: 0,
      isSunday: sunday,
      sourceEntry: plannedEntry
    });
  }

  if (plannedEntry?.type === "vacation") {
    return createResolvedDayEntry({
      type: "vacation",
      status: ENTRY_STATUS.VACATION,
      label: getStatusShortLabel(ENTRY_STATUS.VACATION),
      minutesForMonth: getAbsenceMinutesForEmployee(employee),
      minutesForBranch: 0,
      isSunday: sunday,
      sourceEntry: plannedEntry
    });
  }

  if (isShiftEntry(plannedEntry)) {
    return createResolvedDayEntry({
      type: "shift",
      status: ENTRY_STATUS.WORK,
      label: getShiftDisplayLabel(plannedEntry),
      minutesForMonth: sunday ? 0 : (plannedEntry.minutes || 0),
      minutesForBranch: sunday ? 0 : (plannedEntry.minutes || 0),
      isSunday: sunday,
      sourceEntry: plannedEntry
    });
  }

  if (getEntryStatus(plannedEntry) === ENTRY_STATUS.OFF) {
    return createResolvedDayEntry({
      type: "off",
      status: ENTRY_STATUS.OFF,
      label: plannedEntry?.label || "FR",
      minutesForMonth: 0,
      minutesForBranch: 0,
      isSunday: sunday,
      sourceEntry: plannedEntry
    });
  }

  return createResolvedDayEntry({
    type: "off",
    status: ENTRY_STATUS.EMPTY,
    label: "",
    minutesForMonth: 0,
    minutesForBranch: 0,
    isSunday: sunday
  });
}

function getResolvedDayLabel(params) {
  return getResolvedDayEntry(params).label;
}

function getResolvedMonthMinutes(params) {
  return getResolvedDayEntry(params).minutesForMonth;
}

function getResolvedBranchMinutes(params) {
  return getResolvedDayEntry(params).minutesForBranch;
}
