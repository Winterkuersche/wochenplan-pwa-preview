const ENTRY_STATUS = Object.freeze({
  WORK: "work",
  VACATION: "vacation",
  SICK: "sick",
  OFF: "off",
  EXTERNAL: "external",
  EMPTY: "empty"
});

function normalizeStatusValue(rawStatus) {
  if (!rawStatus && rawStatus !== 0) return ENTRY_STATUS.EMPTY;

  const value = String(rawStatus).trim().toLowerCase();

  if (["work", "shift"].includes(value)) return ENTRY_STATUS.WORK;
  if (["vacation", "urlaub", "u"].includes(value)) return ENTRY_STATUS.VACATION;
  if (["sick", "krank", "k"].includes(value)) return ENTRY_STATUS.SICK;
  if (["off", "frei", "free", "holiday", "h"].includes(value)) return ENTRY_STATUS.OFF;
  if (["external", "external-help", "ah"].includes(value)) return ENTRY_STATUS.EXTERNAL;
  if (["empty", "", "-"].includes(value)) return ENTRY_STATUS.EMPTY;

  return ENTRY_STATUS.EMPTY;
}

function getEntryStatus(entry) {
  if (!entry || typeof entry !== "object") return ENTRY_STATUS.EMPTY;

  const candidate = entry.status || entry.type || entry.mode || "";
  const normalized = normalizeStatusValue(candidate);
  if (normalized !== ENTRY_STATUS.EMPTY) return normalized;

  if (entry.externalHelp) return ENTRY_STATUS.EXTERNAL;
  if (entry.start || entry.end || entry.code || entry.shiftKey) return ENTRY_STATUS.WORK;

  return ENTRY_STATUS.EMPTY;
}

function getResolvedStatus(resolvedEntry) {
  if (!resolvedEntry || typeof resolvedEntry !== "object") return ENTRY_STATUS.EMPTY;

  const type = String(resolvedEntry.type || "").toLowerCase();
  if (type === "shift") return ENTRY_STATUS.WORK;
  if (type === "external-help") return ENTRY_STATUS.EXTERNAL;
  if (type === "vacation") return ENTRY_STATUS.VACATION;
  if (type === "sick") return ENTRY_STATUS.SICK;
  if (type === "holiday" || type === "off") return ENTRY_STATUS.OFF;

  return ENTRY_STATUS.EMPTY;
}

function isWorkingEntry(entry) {
  return getEntryStatus(entry) === ENTRY_STATUS.WORK;
}

function isVacationEntry(entry) {
  return getEntryStatus(entry) === ENTRY_STATUS.VACATION;
}

function isAbsenceEntry(entry) {
  const status = getEntryStatus(entry);
  return status === ENTRY_STATUS.VACATION || status === ENTRY_STATUS.SICK || status === ENTRY_STATUS.OFF;
}

function getStatusLabel(status) {
  const normalized = normalizeStatusValue(status);
  if (normalized === ENTRY_STATUS.WORK) return "Arbeit";
  if (normalized === ENTRY_STATUS.VACATION) return "Urlaub";
  if (normalized === ENTRY_STATUS.SICK) return "Krank";
  if (normalized === ENTRY_STATUS.OFF) return "Frei";
  if (normalized === ENTRY_STATUS.EXTERNAL) return "Externe Hilfe";
  return "Leer";
}

function getStatusShortLabel(status) {
  const normalized = normalizeStatusValue(status);
  if (normalized === ENTRY_STATUS.VACATION) return "U";
  if (normalized === ENTRY_STATUS.SICK) return "K";
  if (normalized === ENTRY_STATUS.EXTERNAL) return "AH";
  if (normalized === ENTRY_STATUS.OFF) return "-";
  return "";
}

function getDeltaVisualState(minutes) {
  if (minutes < 0) return "deltaNegative";
  if (minutes > 0) return "deltaPositive";
  return "deltaZero";
}

function getRestOverVisualState(differenceMinutes) {
  return getDeltaVisualState(-Number(differenceMinutes || 0));
}
