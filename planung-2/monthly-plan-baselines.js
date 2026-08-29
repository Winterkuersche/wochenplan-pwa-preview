"use strict";

/* Dauerhafte, fachliche Monats-Snapshots. Das Modul kennt weder DOM noch Storage;
 * der vorhandene App-State bleibt die einzige Persistenzquelle. */
const MONTHLY_PLAN_CHANGE = Object.freeze({
  UNCHANGED: "UNCHANGED",
  ADDED: "ADDED",
  REMOVED: "REMOVED",
  CHANGED: "CHANGED",
  SHIFT_TIME_CHANGED: "SHIFT_TIME_CHANGED",
  SHIFT_ADDED: "SHIFT_ADDED",
  SHIFT_REMOVED: "SHIFT_REMOVED",
  STATUS_CHANGED: "STATUS_CHANGED"
});

function cloneMonthlyPlanValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isMonthlyPlanYearMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""))) return false;
  const [year, month] = String(value).split("-").map(Number);
  return year >= 1900 && month >= 1 && month <= 12;
}

function getMonthlyPlanState(appState) {
  if (appState && typeof appState === "object") return appState;
  return typeof state !== "undefined" ? state : null;
}

function normalizeMonthlyPlanBaselines(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((result, [month, baseline]) => {
    if (!isMonthlyPlanYearMonth(month) || !baseline || typeof baseline !== "object") return result;
    const entries = baseline.entries && typeof baseline.entries === "object" && !Array.isArray(baseline.entries)
      ? Object.entries(baseline.entries).reduce((days, [isoDate, employees]) => {
        if (isoDate.slice(0, 7) !== month || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return days;
        if (!employees || typeof employees !== "object" || Array.isArray(employees)) return days;
        days[isoDate] = cloneMonthlyPlanValue(employees);
        return days;
      }, {})
      : {};
    result[month] = { month, createdAt: String(baseline.createdAt || ""), entries };
    return result;
  }, {});
}

function monthlyPlanAbsenceOnDate(absences, employeeId, isoDate) {
  const matches = (Array.isArray(absences) ? absences : []).filter((absence) => (
    absence?.employeeId === employeeId && absence.from <= isoDate && absence.to >= isoDate
  ));
  return matches.find((absence) => absence.type === "sick")
    || matches.find((absence) => absence.type === "vacation") || null;
}

function compactMonthlyPlanEntry(entry, absence = null, resolvedEntry = null) {
  if (resolvedEntry) {
    if (resolvedEntry.type === "holiday") return { kind: "holiday", label: resolvedEntry.holidayName || resolvedEntry.label || "" };
    if (resolvedEntry.type === "sick") return { kind: "sick" };
    if (resolvedEntry.type === "vacation") return { kind: "vacation" };
    if (resolvedEntry.type === "external-help") entry = resolvedEntry.sourceEntry;
    if (resolvedEntry.type === "shift") entry = resolvedEntry.sourceEntry;
    if (resolvedEntry.type === "off" && !resolvedEntry.sourceEntry) return null;
    if (resolvedEntry.type === "off") entry = resolvedEntry.sourceEntry;
  } else if (absence) {
    return { kind: absence.type === "sick" ? "sick" : "vacation" };
  }
  if (!entry || typeof entry !== "object") return null;
  const status = typeof getEntryStatus === "function" ? getEntryStatus(entry) : "";
  if (entry.type === "shift" || status === "work") {
    return { kind: "shift", start: entry.start || "", end: entry.end || "" };
  }
  if (entry.type === "external-help" || status === "external") {
    return { kind: "external-help", start: entry.start || "", end: entry.end || "", branch: entry.branch || "" };
  }
  if (entry.type === "vacation" || status === "vacation") return { kind: "vacation" };
  if (entry.type === "sick" || status === "sick") return { kind: "sick" };
  if (entry.type === "off" || status === "off") return { kind: "off" };
  return null;
}

function buildMonthlyPlanBaseline(yearMonth, appState, createdAt = new Date().toISOString()) {
  if (!isMonthlyPlanYearMonth(yearMonth)) throw new Error("Ungültiger Kalendermonat.");
  const source = getMonthlyPlanState(appState) || {};
  const employeeIds = new Set((source.employees || []).map((employee) => employee?.id).filter(Boolean));
  Object.entries(source.schedule || {}).forEach(([isoDate, day]) => {
    if (isoDate.slice(0, 7) === yearMonth) Object.keys(day || {}).forEach((id) => employeeIds.add(id));
  });
  (source.absences || []).forEach((absence) => employeeIds.add(absence?.employeeId));

  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const entries = {};
  for (let day = 1; day <= lastDay; day += 1) {
    const isoDate = `${yearMonth}-${String(day).padStart(2, "0")}`;
    const dayEntries = {};
    employeeIds.forEach((employeeId) => {
      const employee = (source.employees || []).find((item) => item?.id === employeeId) || { id: employeeId };
      const resolvedEntry = typeof getResolvedDayEntry === "function"
        ? getResolvedDayEntry({
          employee,
          isoDate,
          schedule: source.schedule || {},
          absences: source.absences || [],
          stateKey: source.stateKey || (typeof APP_META !== "undefined" ? APP_META.stateKey : "schleswig-holstein")
        })
        : null;
      const value = compactMonthlyPlanEntry(
        source.schedule?.[isoDate]?.[employeeId],
        monthlyPlanAbsenceOnDate(source.absences, employeeId, isoDate),
        resolvedEntry
      );
      if (value) dayEntries[employeeId] = value;
    });
    if (Object.keys(dayEntries).length) entries[isoDate] = dayEntries;
  }
  return { month: yearMonth, createdAt, entries };
}

function hasMonthlyPlanBaseline(yearMonth, appState) {
  const source = getMonthlyPlanState(appState);
  return Boolean(isMonthlyPlanYearMonth(yearMonth) && source?.monthlyPlanBaselines?.[yearMonth]);
}

function getMonthlyPlanBaseline(yearMonth, appState) {
  const source = getMonthlyPlanState(appState);
  const baseline = source?.monthlyPlanBaselines?.[yearMonth];
  return baseline ? cloneMonthlyPlanValue(baseline) : null;
}

function createMonthlyPlanBaseline(yearMonth, appState, options = {}) {
  const target = getMonthlyPlanState(appState);
  if (!target) throw new Error("App-State nicht verfügbar.");
  target.monthlyPlanBaselines = normalizeMonthlyPlanBaselines(target.monthlyPlanBaselines);
  if (target.monthlyPlanBaselines[yearMonth]) return null;
  const baseline = buildMonthlyPlanBaseline(yearMonth, target, options.createdAt);
  target.monthlyPlanBaselines[yearMonth] = baseline;
  return cloneMonthlyPlanValue(baseline);
}

function replaceMonthlyPlanBaseline(yearMonth, appState, options = {}) {
  const target = getMonthlyPlanState(appState);
  if (!target) throw new Error("App-State nicht verfügbar.");
  target.monthlyPlanBaselines = normalizeMonthlyPlanBaselines(target.monthlyPlanBaselines);
  const baseline = buildMonthlyPlanBaseline(yearMonth, target, options.createdAt);
  target.monthlyPlanBaselines[yearMonth] = baseline;
  return cloneMonthlyPlanValue(baseline);
}

function deleteMonthlyPlanBaseline(yearMonth, appState) {
  const target = getMonthlyPlanState(appState);
  if (!target?.monthlyPlanBaselines?.[yearMonth]) return false;
  delete target.monthlyPlanBaselines[yearMonth];
  return true;
}

function getMonthlyPlanEntryWorkedMinutes(entry) {
  if (!entry || (entry.kind !== "shift" && entry.kind !== "external-help")) return 0;
  if (!entry.start || !entry.end) return 0;
  if (entry.kind === "external-help" && typeof getExternalHelpWorkedMinutes === "function") {
    return getExternalHelpWorkedMinutes(entry.start, entry.end);
  }
  const pause = typeof getBusinessRequiredBreakMinutes === "function"
    ? getBusinessRequiredBreakMinutes(entry.start, entry.end)
    : 0;
  return typeof getWorkedMinutesFromRange === "function"
    ? getWorkedMinutesFromRange(entry.start, entry.end, pause)
    : 0;
}

function classifyMonthlyPlanChange(baselineEntry, currentEntry) {
  if (JSON.stringify(baselineEntry) === JSON.stringify(currentEntry)) return MONTHLY_PLAN_CHANGE.UNCHANGED;
  if (!baselineEntry) return currentEntry?.kind === "shift" ? MONTHLY_PLAN_CHANGE.SHIFT_ADDED : MONTHLY_PLAN_CHANGE.ADDED;
  if (!currentEntry) return baselineEntry.kind === "shift" ? MONTHLY_PLAN_CHANGE.SHIFT_REMOVED : MONTHLY_PLAN_CHANGE.REMOVED;
  if (baselineEntry.kind !== currentEntry.kind) return MONTHLY_PLAN_CHANGE.STATUS_CHANGED;
  if (baselineEntry.kind === "shift" && (baselineEntry.start !== currentEntry.start || baselineEntry.end !== currentEntry.end)) {
    return MONTHLY_PLAN_CHANGE.SHIFT_TIME_CHANGED;
  }
  return MONTHLY_PLAN_CHANGE.CHANGED;
}

function compareMonthlyPlanToBaseline(yearMonth, appState) {
  const source = getMonthlyPlanState(appState) || {};
  const baseline = getMonthlyPlanBaseline(yearMonth, source);
  if (!baseline) return { hasBaseline: false, month: yearMonth, changes: null, changeCount: null, netWorkMinutes: null };
  const current = buildMonthlyPlanBaseline(yearMonth, source, baseline.createdAt);
  const dates = new Set([...Object.keys(baseline.entries), ...Object.keys(current.entries)]);
  const changes = {};
  let changeCount = 0;
  let netWorkMinutes = 0;
  dates.forEach((isoDate) => {
    const ids = new Set([...Object.keys(baseline.entries[isoDate] || {}), ...Object.keys(current.entries[isoDate] || {})]);
    changes[isoDate] = {};
    ids.forEach((employeeId) => {
      const before = baseline.entries[isoDate]?.[employeeId] || null;
      const after = current.entries[isoDate]?.[employeeId] || null;
      const type = classifyMonthlyPlanChange(before, after);
      const workMinutesDifference = getMonthlyPlanEntryWorkedMinutes(after) - getMonthlyPlanEntryWorkedMinutes(before);
      if (type !== MONTHLY_PLAN_CHANGE.UNCHANGED) { changeCount += 1; netWorkMinutes += workMinutesDifference; }
      changes[isoDate][employeeId] = { type, baseline: cloneMonthlyPlanValue(before), current: cloneMonthlyPlanValue(after), workMinutesDifference };
    });
  });
  return { hasBaseline: true, month: yearMonth, createdAt: baseline.createdAt, changes, changeCount, netWorkMinutes };
}

function comparePlanEntryToMonthlyBaseline(isoDate, employeeId, appState) {
  const month = String(isoDate || "").slice(0, 7);
  const comparison = compareMonthlyPlanToBaseline(month, appState);
  if (!comparison.hasBaseline) return { hasBaseline: false, change: null };
  return { hasBaseline: true, change: comparison.changes?.[isoDate]?.[employeeId] || { type: MONTHLY_PLAN_CHANGE.UNCHANGED, baseline: null, current: null, workMinutesDifference: 0 } };
}
