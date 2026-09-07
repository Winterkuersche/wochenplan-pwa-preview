const EMPLOYEE_TIME_PREFERENCES = Object.freeze({
  EARLY: "early",
  LATE: "late",
  ANY: "any"
});

const EMPLOYEE_AVAILABILITY_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

function normalizeEmployeeTimePreference(value) {
  return Object.values(EMPLOYEE_TIME_PREFERENCES).includes(value)
    ? value
    : EMPLOYEE_TIME_PREFERENCES.ANY;
}

function normalizeAvailabilityLimit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const earliestStart = normalizePlanTime(value.earliestStart || "");
  const latestEnd = normalizePlanTime(value.latestEnd || "");
  const numericMaximum = Number(value.maxShiftMinutes);
  const maxShiftMinutes = Number.isFinite(numericMaximum) && numericMaximum > 0
    ? normalizeMinutesToQuarterHour(numericMaximum)
    : 0;

  return {
    ...(earliestStart ? { earliestStart } : {}),
    ...(latestEnd ? { latestEnd } : {}),
    ...(maxShiftMinutes ? { maxShiftMinutes } : {})
  };
}

function normalizeEmployeeAvailability(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const weekdays = {};
  const dates = {};

  Object.entries(source.weekdays || {}).forEach(([weekday, limit]) => {
    if (!EMPLOYEE_AVAILABILITY_WEEKDAYS.includes(Number(weekday))) return;
    weekdays[String(Number(weekday))] = normalizeAvailabilityLimit(limit);
  });
  Object.entries(source.dates || {}).forEach(([isoDate, limit]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
    dates[isoDate] = normalizeAvailabilityLimit(limit);
  });

  return {
    general: normalizeAvailabilityLimit(source.general),
    weekdays,
    dates
  };
}

function getIsoWeekday(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

/** Pure resolver. An explicitly present date/weekday record wins, even when empty. */
function resolveEmployeeAvailability(employee, isoDate) {
  const availability = normalizeEmployeeAvailability(employee?.availability);
  const weekday = getIsoWeekday(isoDate);
  let source = "none";
  let limits = {};

  if (Object.prototype.hasOwnProperty.call(availability.dates, isoDate)) {
    source = "date";
    limits = availability.dates[isoDate];
  } else if (weekday !== null && Object.prototype.hasOwnProperty.call(availability.weekdays, String(weekday))) {
    source = "weekday";
    limits = availability.weekdays[String(weekday)];
  } else if (Object.keys(availability.general).length) {
    source = "general";
    limits = availability.general;
  }

  return Object.freeze({
    isoDate,
    source,
    earliestStart: limits.earliestStart || null,
    latestEnd: limits.latestEnd || null,
    maxShiftMinutes: limits.maxShiftMinutes || null
  });
}

function validateShiftAgainstEmployeeAvailability(employee, isoDate, start, end) {
  const resolved = resolveEmployeeAvailability(employee, isoDate);
  const violations = [];

  if (!isAllowedPlanTime(start) || !isAllowedPlanTime(end)) {
    violations.push({ code: "INVALID_SHIFT_TIME", field: "time" });
  } else {
    const startMinutes = parseTimeToMinutes(start);
    const endMinutes = parseTimeToMinutes(end);
    const durationMinutes = endMinutes - startMinutes;
    if (durationMinutes <= 0) violations.push({ code: "INVALID_SHIFT_RANGE", field: "time" });
    if (resolved.earliestStart && startMinutes < parseTimeToMinutes(resolved.earliestStart)) {
      violations.push({ code: "BEFORE_AVAILABILITY", field: "start", limit: resolved.earliestStart });
    }
    if (resolved.latestEnd && endMinutes > parseTimeToMinutes(resolved.latestEnd)) {
      violations.push({ code: "AFTER_AVAILABILITY", field: "end", limit: resolved.latestEnd });
    }
    if (resolved.maxShiftMinutes && durationMinutes > resolved.maxShiftMinutes) {
      violations.push({ code: "MAX_SHIFT_DURATION", field: "duration", limitMinutes: resolved.maxShiftMinutes });
    }
  }

  return Object.freeze({ valid: violations.length === 0, resolved, violations: Object.freeze(violations) });
}

function getEmployeePlanning2PreferenceFacts(employee) {
  return Object.freeze({
    timePreference: normalizeEmployeeTimePreference(employee?.timePreference),
    flexibleWeekDistribution: employee?.flexibleWeekDistribution === true
  });
}
