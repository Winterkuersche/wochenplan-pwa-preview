function createAbsenceEntry({ id, employeeId, type, from, to, note = "" }) {
  if (!employeeId) return null;
  if (type !== "vacation" && type !== "sick") return null;
  if (!from || !to) return null;
  if (!fromIsoDate(from) || !fromIsoDate(to)) return null;
  if (from > to) return null;

  return {
    id: id || `abs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    employeeId,
    type,
    from,
    to,
    note: String(note || "").trim()
  };
}

function normalizeAbsences(absences) {
  if (!Array.isArray(absences)) return [];
  const normalizedEntries = absences
    .map((entry) => createAbsenceEntry(entry))
    .filter(Boolean);

  return mergeAbsenceEntries(normalizedEntries);
}

function mergeAbsenceEntries(absences) {
  if (!Array.isArray(absences) || absences.length === 0) return [];

  const grouped = new Map();
  absences.forEach((entry) => {
    if (!entry) return;
    const key = `${entry.employeeId}__${entry.type}`;
    const group = grouped.get(key) || [];
    group.push(entry);
    grouped.set(key, group);
  });

  const merged = [];
  grouped.forEach((entries) => {
    const sorted = [...entries].sort((a, b) => {
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      return a.to.localeCompare(b.to);
    });

    sorted.forEach((entry) => {
      const last = merged[merged.length - 1];
      if (!last || last.employeeId !== entry.employeeId || last.type !== entry.type) {
        merged.push({ ...entry });
        return;
      }

      const isOverlapping = entry.from <= last.to;
      const isAdjacent = shiftIsoDateForAbsence(last.to, 1) === entry.from;
      if (!isOverlapping && !isAdjacent) {
        merged.push({ ...entry });
        return;
      }

      if (entry.to > last.to) {
        last.to = entry.to;
      }

      if (!last.note && entry.note) {
        last.note = entry.note;
      }
    });
  });

  return merged;
}

function getAbsencesForEmployee(absences, employeeId) {
  if (!Array.isArray(absences) || !employeeId) return [];
  return absences.filter((entry) => entry.employeeId === employeeId);
}

function getAbsencesForEmployeeByType(absences, employeeId, type) {
  if (!type) return getAbsencesForEmployee(absences, employeeId);
  return getAbsencesForEmployee(absences, employeeId).filter((entry) => entry.type === type);
}

function getVacationEntriesForEmployeeFromAbsences(absences, employeeId) {
  return getAbsencesForEmployeeByType(absences, employeeId, "vacation");
}

function getSickEntriesForEmployeeFromAbsences(absences, employeeId) {
  return getAbsencesForEmployeeByType(absences, employeeId, "sick");
}

function getAbsenceEntryById(absences, absenceId) {
  if (!Array.isArray(absences) || !absenceId) return null;
  return absences.find((entry) => entry?.id === absenceId) || null;
}

function getVacationEntryByIdFromAbsences(absences, absenceId) {
  const entry = getAbsenceEntryById(absences, absenceId);
  if (!entry || entry.type !== "vacation") return null;
  return entry;
}

function doesAbsenceMatchDate(absence, isoDate) {
  if (!absence || !isoDate) return false;
  return isIsoDateInRange(isoDate, absence.from, absence.to);
}

function getAbsenceEntriesForEmployeeOnDate(absences, employeeId, isoDate) {
  return getAbsencesForEmployee(absences, employeeId).filter((entry) =>
    doesAbsenceMatchDate(entry, isoDate)
  );
}

function getSickEntryForEmployeeOnDate(absences, employeeId, isoDate) {
  return getAbsenceEntriesForEmployeeOnDate(absences, employeeId, isoDate).find(
    (entry) => entry.type === "sick"
  ) || null;
}

function getVacationEntryForEmployeeOnDate(absences, employeeId, isoDate) {
  return getAbsenceEntriesForEmployeeOnDate(absences, employeeId, isoDate).find(
    (entry) => entry.type === "vacation"
  ) || null;
}

function getPriorityAbsenceForEmployeeOnDate(absences, employeeId, isoDate) {
  const sickEntry = getSickEntryForEmployeeOnDate(absences, employeeId, isoDate);
  if (sickEntry) return sickEntry;

  const vacationEntry = getVacationEntryForEmployeeOnDate(absences, employeeId, isoDate);
  if (vacationEntry) return vacationEntry;

  return null;
}

function addAbsenceEntry(absences, entryInput) {
  const normalized = Array.isArray(absences) ? [...absences] : [];
  const entry = createAbsenceEntry(entryInput);
  if (!entry) return normalized;

  normalized.push(entry);
  return normalized;
}

function removeAbsenceEntry(absences, absenceId) {
  if (!Array.isArray(absences) || !absenceId) return Array.isArray(absences) ? [...absences] : [];
  return absences.filter((entry) => entry.id !== absenceId);
}

function removeAbsenceCoverage(absences, employeeId, removeFromIso, removeToIso, type) {
  if (!Array.isArray(absences)) return [];
  if (!employeeId || !removeFromIso || !removeToIso || !type) return [...absences];

  return absences.flatMap((entry) => {
    if (!entry || entry.employeeId !== employeeId) return entry ? [entry] : [];
    if (entry.type !== type) return [entry];
    return subtractRangeFromAbsenceEntry(entry, removeFromIso, removeToIso);
  });
}

function replaceAbsenceCoverage(absences, employeeId, fromIso, toIso, replacementType = null) {
  if (!Array.isArray(absences)) return [];
  if (!employeeId || !fromIso || !toIso) return [...absences];
  if (!fromIsoDate(fromIso) || !fromIsoDate(toIso) || toIso < fromIso) return [...absences];

  const normalizedReplacementType =
    replacementType === "vacation" || replacementType === "sick" ? replacementType : null;
  const typesToClear = normalizedReplacementType
    ? [normalizedReplacementType === "vacation" ? "sick" : "vacation"]
    : ["vacation", "sick"];

  let nextAbsences = [...absences];

  typesToClear.forEach((typeToClear) => {
    nextAbsences = removeAbsenceCoverage(
      nextAbsences,
      employeeId,
      fromIso,
      toIso,
      typeToClear
    );
  });

  if (normalizedReplacementType) {
    nextAbsences = addAbsenceEntry(nextAbsences, {
      employeeId,
      type: normalizedReplacementType,
      from: fromIso,
      to: toIso,
      note: ""
    });
  }

  return normalizeAbsences(nextAbsences);
}

function updateAbsenceEntry(absences, absenceId, updates) {
  if (!Array.isArray(absences) || !absenceId) return Array.isArray(absences) ? [...absences] : [];

  return absences.map((entry) => {
    if (entry.id !== absenceId) return entry;

    const merged = {
      ...entry,
      ...updates
    };

    return createAbsenceEntry(merged) || entry;
  });
}

function getAbsenceDisplayLabel(absenceType) {
  if (absenceType === "sick") return "K";
  if (absenceType === "vacation") return "U";
  return "";
}

function getAbsenceMinutesForEmployee(employee) {
  return getDailyTargetMinutesFromWeeklyHHMM(employee?.target || "00:00");
}

function shiftIsoDateForAbsence(isoDate, dayOffset) {
  const date = fromIsoDate(isoDate);
  if (!date) return isoDate;

  date.setDate(date.getDate() + dayOffset);
  return toIsoDate(date);
}

function subtractRangeFromAbsenceEntry(entry, removeFromIso, removeToIso) {
  if (!entry) return [];

  const entryFrom = entry.from;
  const entryTo = entry.to;

  const hasOverlap = !(removeToIso < entryFrom || removeFromIso > entryTo);
  if (!hasOverlap) return [entry];

  if (removeFromIso <= entryFrom && removeToIso >= entryTo) {
    return [];
  }

  if (removeFromIso <= entryFrom && removeToIso < entryTo) {
    const nextFrom = shiftIsoDateForAbsence(removeToIso, 1);
    const trimmed = createAbsenceEntry({
      ...entry,
      id: null,
      from: nextFrom,
      to: entryTo
    });
    return trimmed ? [trimmed] : [];
  }

  if (removeFromIso > entryFrom && removeToIso >= entryTo) {
    const nextTo = shiftIsoDateForAbsence(removeFromIso, -1);
    const trimmed = createAbsenceEntry({
      ...entry,
      id: null,
      from: entryFrom,
      to: nextTo
    });
    return trimmed ? [trimmed] : [];
  }

  const leftTo = shiftIsoDateForAbsence(removeFromIso, -1);
  const rightFrom = shiftIsoDateForAbsence(removeToIso, 1);

  const leftPart = createAbsenceEntry({
    ...entry,
    id: null,
    from: entryFrom,
    to: leftTo
  });

  const rightPart = createAbsenceEntry({
    ...entry,
    id: null,
    from: rightFrom,
    to: entryTo
  });

  return [leftPart, rightPart].filter(Boolean);
}
