function hhmmToMinutes(value) {
  if (typeof value !== "string") return 0;

  const trimmed = value.trim();
  if (!trimmed) return 0;

  const parts = trimmed.split(":");
  if (parts.length !== 2) return 0;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  if (hours < 0 || minutes < 0 || minutes > 59) return 0;

  return hours * 60 + minutes;
}

function hmToMinutes(hm) {
  return hhmmToMinutes(hm);
}

function minutesToHM(min) {
  const numeric = Number(min);
  const safeMinutes = Number.isNaN(numeric) ? 0 : Math.max(0, Math.round(numeric));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

const QUARTER_HOUR_STEP_MINUTES = 15;
const PLAN_TIME_EXCEPTIONS = new Set(["08:55", "19:10"]);
const PLAN_BREAK_MINUTE_EXCEPTIONS = new Set([5, 10, 70]);
const REQUIRED_BREAK_THRESHOLD_MINUTES = 6 * 60;
const REQUIRED_BREAK_BASE_MINUTES = 60;

function parseTimeToMinutes(value) {
  return hhmmToMinutes(value);
}

function minutesToHHMM(totalMinutes) {
  const safeMinutes = Number(totalMinutes);
  if (Number.isNaN(safeMinutes)) return "00:00";

  const sign = safeMinutes < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(safeMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function diffMinutesBetweenHHMM(startHHMM, endHHMM) {
  const startMinutes = hhmmToMinutes(startHHMM);
  const endMinutes = hhmmToMinutes(endHHMM);
  return endMinutes - startMinutes;
}

function addMinutesToHHMM(hhmm, minutesToAdd) {
  const baseMinutes = hhmmToMinutes(hhmm);
  const resultMinutes = baseMinutes + Number(minutesToAdd || 0);
  return minutesToHHMM(resultMinutes);
}

function isValidHHMM(value) {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return false;

  const [hoursText, minutesText] = trimmed.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  if (hours < 0 || hours > 23) return false;
  if (minutes < 0 || minutes > 59) return false;

  return true;
}

function isQuarterHourTime(value) {
  if (!isValidHHMM(value)) return false;
  return parseTimeToMinutes(value) % QUARTER_HOUR_STEP_MINUTES === 0;
}

function isAllowedPlanTime(value) {
  if (!isValidHHMM(value)) return false;
  const normalized = minutesToHHMM(parseTimeToMinutes(value));
  return isQuarterHourTime(normalized) || PLAN_TIME_EXCEPTIONS.has(normalized);
}

function normalizeTimeToQuarterHour(value) {
  if (!isValidHHMM(value)) return "";

  const totalMinutes = parseTimeToMinutes(value);
  const roundedMinutes = Math.round(totalMinutes / QUARTER_HOUR_STEP_MINUTES) * QUARTER_HOUR_STEP_MINUTES;

  return minutesToHHMM(roundedMinutes);
}

function normalizePlanTime(value) {
  if (!isValidHHMM(value)) return "";

  const normalized = minutesToHHMM(parseTimeToMinutes(value));
  if (PLAN_TIME_EXCEPTIONS.has(normalized)) return normalized;

  return normalizeTimeToQuarterHour(normalized);
}

function formatQuarterHourTime(value) {
  if (typeof value === "number") {
    const safeMinutes = Math.max(0, value);
    const roundedMinutes = Math.round(safeMinutes / QUARTER_HOUR_STEP_MINUTES) * QUARTER_HOUR_STEP_MINUTES;
    return minutesToHHMM(roundedMinutes);
  }

  return normalizeTimeToQuarterHour(value);
}

function normalizeMinutesToQuarterHour(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;

  const safeMinutes = Math.max(0, numeric);
  return Math.round(safeMinutes / QUARTER_HOUR_STEP_MINUTES) * QUARTER_HOUR_STEP_MINUTES;
}

function normalizePlanBreakMinutes(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;

  const safeMinutes = Math.max(0, Math.round(numeric));
  if (PLAN_BREAK_MINUTE_EXCEPTIONS.has(safeMinutes)) return safeMinutes;

  return normalizeMinutesToQuarterHour(safeMinutes);
}

function normalizeBusinessBreakMinutes(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function clampMinutes(value, minValue, maxValue) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function getDailyTargetMinutesFromWeeklyHHMM(weeklyTargetHHMM) {
  const weeklyMinutes = hhmmToMinutes(weeklyTargetHHMM);
  return Math.round(weeklyMinutes / 6);
}

function getBreakMinutesForFlexibleShift(startHHMM, endHHMM) {
  return getRequiredBreakMinutesForSpan(startHHMM, endHHMM);
}

function getRequiredBreakMinutesForSpan(startHHMM, endHHMM, options = {}) {
  const totalSpanMinutes = diffMinutesBetweenHHMM(startHHMM, endHHMM);
  if (totalSpanMinutes <= REQUIRED_BREAK_THRESHOLD_MINUTES) return 0;

  const includeBillingBonus = Boolean(options.includeBillingBonus);
  return REQUIRED_BREAK_BASE_MINUTES + (includeBillingBonus ? REQUIRED_BREAK_BILLING_BONUS_MINUTES : 0);
}

function isLateCheckoutBreakException(startHHMM, endHHMM, configuredBreakMinutes = 0, options = {}) {
  // Legacy compatibility shim: Fachlogik liegt vollständig in getBusinessRequiredBreakMinutes.
  void startHHMM;
  void endHHMM;
  void configuredBreakMinutes;
  void options;
  return false;
}

// Zentrale fachliche Entscheidung für Pausenminuten.
// configuredBreakMinutes (z. B. aus breakPolicy) ist nur ein Vorschlags-/Fallbackwert
// für Fälle <= 6h ohne Sonderregel.
function getBusinessRequiredBreakMinutes(startHHMM, endHHMM, configuredBreakMinutes = 0, options = {}) {
  const normalizedStart = normalizePlanTime(startHHMM);
  const normalizedEnd = normalizePlanTime(endHHMM);

  // Deterministische Kurzschicht-Overrides zuerst.
  if (normalizedStart === "08:55" && normalizedEnd === "15:00") return 5;
  if (normalizedStart === "13:00" && normalizedEnd === "19:10") return 10;

  const totalSpanMinutes = diffMinutesBetweenHHMM(normalizedStart, normalizedEnd);
  let requiredBreakMinutes = totalSpanMinutes > REQUIRED_BREAK_THRESHOLD_MINUTES ? REQUIRED_BREAK_BASE_MINUTES : 0;

  if (normalizedStart === "08:55") requiredBreakMinutes += 5;
  if (normalizedEnd === "19:10") requiredBreakMinutes += 10;

  void configuredBreakMinutes;
  void options;
  return requiredBreakMinutes;
}

function getEffectiveBreakMinutes(startHHMM, endHHMM, configuredBreakMinutes = 0, options = {}) {
  return getBusinessRequiredBreakMinutes(startHHMM, endHHMM, configuredBreakMinutes, options);
}

function getWorkedMinutesFromRange(startHHMM, endHHMM, breakMinutes = 0) {
  const totalSpanMinutes = diffMinutesBetweenHHMM(startHHMM, endHHMM);
  return Math.max(0, totalSpanMinutes - Number(breakMinutes || 0));
}

function getExternalHelpBreakDeductionMinutes(startHHMM, endHHMM) {
  const totalSpanMinutes = diffMinutesBetweenHHMM(startHHMM, endHHMM);
  return totalSpanMinutes > REQUIRED_BREAK_THRESHOLD_MINUTES ? 60 : 0;
}

function getExternalHelpWorkedMinutes(startHHMM, endHHMM) {
  const totalSpanMinutes = diffMinutesBetweenHHMM(startHHMM, endHHMM);
  const deductionMinutes = getExternalHelpBreakDeductionMinutes(startHHMM, endHHMM);
  return Math.max(0, totalSpanMinutes - deductionMinutes);
}

function roundMinutesToStep(value, stepMinutes) {
  if (!Number.isFinite(value) || !Number.isFinite(stepMinutes) || stepMinutes <= 0) return value;
  return Math.round(value / stepMinutes) * stepMinutes;
}

function getFixedLateCheckoutPauseRange(startHHMM) {
  const normalizedStart = normalizePlanTime(startHHMM);
  if (normalizedStart === "13:00" || normalizedStart === "14:00") {
    return "16:00-16:10";
  }

  if (normalizedStart === "15:00" || normalizedStart === "16:00") {
    return "17:00-17:10";
  }

  return "";
}

function getFixedFullShiftPauseRange(startHHMM, endHHMM) {
  const normalizedStart = normalizePlanTime(startHHMM);
  const normalizedEnd = normalizePlanTime(endHHMM);

  if (normalizedStart !== "09:00") return "";
  if (normalizedEnd === "19:10") return "14:00-15:10";
  if (normalizedEnd === "19:00") return "14:00-15:00";

  return "";
}

function getPauseMinutesForMepDisplay(entry) {
  if (!entry || !entry.start || !entry.end) return 0;
  if (getEntryStatus(entry) === ENTRY_STATUS.EXTERNAL) return 0;

  const spanMinutes = diffMinutesBetweenHHMM(entry.start, entry.end);
  if (spanMinutes <= 0) return 0;

  const configuredBreak = Number(entry.pause ?? entry.breakMinutes ?? 0);
  const businessBreakMinutes = getBusinessRequiredBreakMinutes(entry.start, entry.end, configuredBreak, {
    includeBillingBonus: entry.end === "19:10"
  });
  const isFlexibleShift = entry.code === "FLEX" || entry.shiftKey === "FLEX" || entry.mode === "flex";
  const normalizedBusinessBreakMinutes = Math.max(
    0,
    Math.round(businessBreakMinutes),
    isFlexibleShift ? normalizeBusinessBreakMinutes(configuredBreak) : 0
  );

  // Schichten sollen dieselbe fachliche Pausenentscheidung nutzen wie Konto-/Berechnungslogik.
  if (getEntryStatus(entry) === ENTRY_STATUS.WORK) {
    return normalizedBusinessBreakMinutes;
  }

  const parsedEntryMinutes = typeof entry.minutes === "number"
    ? entry.minutes
    : typeof entry.minutes === "string" && isValidHHMM(entry.minutes)
      ? parseTimeToMinutes(entry.minutes)
      : null;

  // Fallback für gemischte Alt-/Neudaten:
  // - Nicht-Schicht-Einträge konnten historisch nur über minutes die Pause implizit tragen.
  // - Bei fehlenden neuen Pausenfeldern berechnen wir daher weiterhin span - minutes.
  // - Schichten nutzen IMMER die finale Business-Logik (oben), damit keine Altwerte sichtbar werden.
  if (parsedEntryMinutes !== null) {
    const workedMinutes = normalizeMinutesToQuarterHour(parsedEntryMinutes);
    return Math.max(0, spanMinutes - workedMinutes);
  }

  return normalizedBusinessBreakMinutes;
}

function getPauseRangeForMep(entry) {
  if (!entry || !entry.start || !entry.end) return "";
  if (getEntryStatus(entry) === ENTRY_STATUS.EXTERNAL) return "";

  const startMinutes = hhmmToMinutes(entry.start);
  const endMinutes = hhmmToMinutes(entry.end);
  const spanMinutes = endMinutes - startMinutes;
  if (spanMinutes <= 0) return "";

  const pauseMinutes = getPauseMinutesForMepDisplay(entry);
  if (pauseMinutes <= 0) return "-";

  const fixedFullShiftRange = getFixedFullShiftPauseRange(entry.start, entry.end);
  if (fixedFullShiftRange) return fixedFullShiftRange;

  const fixedLateCheckoutRange = getFixedLateCheckoutPauseRange(entry.start);
  if (pauseMinutes === 10 && entry.end === "19:10" && fixedLateCheckoutRange) {
    return fixedLateCheckoutRange;
  }

  const earliestStart = startMinutes;
  const latestStart = endMinutes - pauseMinutes;
  const latestStartOutsideLastHour = endMinutes - 60 - pauseMinutes;
  const latestPreferredStart = latestStartOutsideLastHour >= earliestStart
    ? Math.min(latestStart, latestStartOutsideLastHour)
    : latestStart;

  const centeredStart = startMinutes + Math.floor((spanMinutes - pauseMinutes) / 2);
  const stepMinutes = pauseMinutes <= 10 ? 5 : 15;
  const roundedCenteredStart = roundMinutesToStep(centeredStart, stepMinutes);
  const pauseStart = clampMinutes(roundedCenteredStart, earliestStart, latestPreferredStart);
  const pauseEnd = pauseStart + pauseMinutes;

  return `${minutesToHHMM(pauseStart)}-${minutesToHHMM(pauseEnd)}`;
}
