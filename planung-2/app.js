if (!window.AppOrchestration) {
  throw new Error("AppOrchestration nicht verfügbar. Bitte Lade-Reihenfolge in index.html prüfen.");
}

const {
  bindRuntimeErrorListeners,
  createResponsiveViewController,
  createStartupSelfTest,
  isMobileDebugPanelEnabled,
  sanitizeUiState,
  showMobileRuntimeError
} = window.AppOrchestration;

bindRuntimeErrorListeners();

document.title = `${APP_META.name} ${APP_META.version}`;

const appTitleEl = document.getElementById("app-title");
if (appTitleEl) {
  appTitleEl.textContent = `${APP_META.name} ${APP_META.version}`;
}

const DAYS = [
  { key: "mo", label: "Mo", full: "Montag" },
  { key: "di", label: "Di", full: "Dienstag" },
  { key: "mi", label: "Mi", full: "Mittwoch" },
  { key: "do", label: "Do", full: "Donnerstag" },
  { key: "fr", label: "Fr", full: "Freitag" },
  { key: "sa", label: "Sa", full: "Samstag" },
  { key: "so", label: "So", full: "Sonntag" }
];

const ROLE_OPTIONS = [
  { key: "", label: "-", target: "", contractModel: "" },
  { key: "TL", label: "TL", target: "30:00", contractModel: "VZ30" },
  { key: "TZ30", label: "TZ30", target: "30:00", contractModel: "TZ30" },
  { key: "TZ20", label: "TZ20", target: "20:00", contractModel: "TZ20" },
  { key: "TZ15", label: "TZ15", target: "15:00", contractModel: "TZ15" },
  { key: "GFB", label: "GfB", target: "9:30", contractModel: "" }
];


const MASTER_KEY = "wochenplan_master_v10";
const PLAN_KEY = "wochenplan_plan_v10";
const UI_KEY = "wochenplan_ui_v10";
const BACKUP_INTERNAL_KEY = "wochenplan_import_backup_v1";
const LAST_BACKUP_BEFORE_IMPORT_KEY = "wochenplan_last_backup_before_import_v1";
const BACKUP_META_KEY = "wochenplan_backup_meta_v1";
const BACKUP_MEP_CALIBRATION_KEY = "mep-calibration";
const LAST_SAVED_AT_KEY = "wochenplan_last_saved_at_v1";
const AUTOSAVE_DELAY_MS = 600;
let currentDayIndex = 0;
let autoSaveTimerId = null;
let saveStatusTimerId = null;
let overviewRevenueSaveStatusTimerId = null;
let overviewRevenueDebounceTimerId = null;
let lastOverviewRevenueEditorDateIso = "";
let saveStatusMessage = "";
let saveStatusHasError = false;
let responsiveViewController = null;

function waitForAnimationFrames(frameCount = 2) {
  return new Promise((resolve) => {
    const tick = (remaining) => {
      if (remaining <= 0) {
        resolve();
        return;
      }

      window.requestAnimationFrame(() => tick(remaining - 1));
    };

    tick(frameCount);
  });
}

function updatePrintButtonLabel() {
  if (!btnPrintEl) return;
  const view = uiState?.currentView || "week";
  btnPrintEl.textContent = view === "mep" ? "Monat als PDF exportieren" : "Drucken / PDF";
}


function updateResponsiveViewportMetrics() {
  responsiveViewController?.updateResponsiveViewportMetrics();
}

function scheduleResponsiveViewRefresh(options = {}) {
  // Akzeptanzkriterium: Portrait/Querformat dürfen anders zoomen, aber
  // pro Seite muss der Footer in beiden Modi stabil bleiben (kein Tabellen-Drift nach unten).
  // Deshalb nur auf stabilen Triggern neu fitten und nur bei geänderten Containermaßen rendern.
  responsiveViewController?.scheduleRefresh(options);
}

function requestActiveResponsiveViewRefresh(options = {}) {
  responsiveViewController?.requestActiveViewRefresh(options);
}

const startupSelfTest = createStartupSelfTest({ getShiftRuleByCode, normalizeShiftCode });
const getWarnedUnknownShiftCodesSet = startupSelfTest.getWarnedUnknownShiftCodesSet;
startupSelfTest.runStartupSelfTest();
const loadedAppState = loadAppState();
let uiState = loadedAppState.ui;
let state = loadedAppState.state;
let lastSavedAt = loadedAppState.lastSavedAt;
responsiveViewController = createResponsiveViewController({
  debugLogger: (...args) => console.debug(...args),
  getCurrentView: () => uiState?.currentView || "week",
  postRenderSync: () => waitForAnimationFrames(2),
  renderMepTemplateView: (options) => renderMepTemplateView(options)
});

state.schedule = state.schedule || {};
state.absences = state.absences || [];

/* ========= PLAN API ========= */

function ensureScheduleDay(isoDate) {
  if (!state.schedule) state.schedule = {};
  if (!state.schedule[isoDate]) state.schedule[isoDate] = {};
  return state.schedule[isoDate];
}

function normalizePlanEntry(entry) {
  // status is unified via status-utils.js
  if (!entry || typeof entry !== "object") return null;

  const entryStatus = getEntryStatus(entry);
  const isExternalHelp = entryStatus === ENTRY_STATUS.EXTERNAL || Boolean(entry.externalHelp);
  const isVacation = entryStatus === ENTRY_STATUS.VACATION;
  const isShiftWork = entryStatus === ENTRY_STATUS.WORK && !isExternalHelp;
  const type = isExternalHelp
    ? "external-help"
    : isVacation
      ? "vacation"
      : entryStatus === ENTRY_STATUS.WORK
        ? "shift"
        : "off";
  const status = entryStatus;

  const start = isValidHHMM(entry.start || "")
    ? normalizePlanTime(entry.start)
    : "";
  const end = isValidHHMM(entry.end || "")
    ? normalizePlanTime(entry.end)
    : "";

  const rawCode = normalizeShiftCode(entry.shiftKey || entry.code || "");
  const explicitRule = getShiftRuleByCode(rawCode);
  const foRule = getShiftRuleByCode("FO");
  const isFoFallbackWindowMatch = isShiftWork
    && !explicitRule
    && start === "08:55"
    && Boolean(end)
    && Array.isArray(foRule?.endPolicy?.options)
    && foRule.endPolicy.options.includes(end);
  const rule = isFoFallbackWindowMatch ? foRule : explicitRule;

  const manualRawPause = Number(entry.pause ?? entry.breakMinutes ?? 0) || 0;
  const isKnownRuleBasedShift = isShiftWork && rule?.entryType === "shift" && rule.code !== "FLEX";
  const isFlexibleShift = isShiftWork && rule?.entryType === "shift" && rule.code === "FLEX";
  const spanMinutes = start && end ? diffMinutesBetweenHHMM(start, end) : 0;
  const hasValidSpan = spanMinutes > 0;

  // rawPause ist nur ein konfigurierter Input aus Regel/Manuelleingabe.
  // Die finale Pause inkl. 08:55-/19:10-Additionen kommt zentral aus
  // getBusinessRequiredBreakMinutes, um Doppel-Additionen zu vermeiden.
  let rawPause = manualRawPause;
  if (isKnownRuleBasedShift) {
    if (rule.breakPolicy?.type === "checkout-dependent") {
      const hasCheckout = end === "19:10" || Boolean(entry.withCheckout);
      rawPause = hasCheckout
        ? Number(rule.breakPolicy.withCheckout || 0)
        : Number(rule.breakPolicy.withoutCheckout || 0);
    } else {
      rawPause = Number(rule.breakPolicy?.baseMinutes || 0);
    }
  } else if (isFlexibleShift && hasValidSpan) {
    const requiredFlexPause = getBusinessRequiredBreakMinutes(start, end, 0, {
      includeBillingBonus: end === "19:10"
    });
    const normalizedManualPause = normalizeBusinessBreakMinutes(manualRawPause);
    const isManualPausePlausible = Number.isFinite(manualRawPause)
      && normalizedManualPause >= requiredFlexPause
      && normalizedManualPause < spanMinutes;
    rawPause = isManualPausePlausible ? normalizedManualPause : requiredFlexPause;
  }

  const businessPause = start && end
    ? getBusinessRequiredBreakMinutes(start, end, 0, {
      includeBillingBonus: end === "19:10"
    })
    : 0;
  const pause = isExternalHelp
    ? 0
    : start && end
      ? (isFlexibleShift ? Math.max(businessPause, rawPause) : businessPause)
      : normalizeBusinessBreakMinutes(rawPause);

  let minutes = 0;
  const hasValidTimeRange = Boolean(start && end);
  const parsedEntryMinutes = typeof entry.minutes === "number"
    ? entry.minutes
    : typeof entry.minutes === "string" && isValidHHMM(entry.minutes)
      ? parseTimeToMinutes(entry.minutes)
      : null;
  const calculatedWorkedMinutes = hasValidTimeRange
    ? normalizeMinutesToQuarterHour(Math.max(0, diffMinutesBetweenHHMM(start, end) - pause))
    : null;

  if (isVacation) {
    minutes = 0;
  } else if (isShiftWork && hasValidTimeRange) {
    minutes = calculatedWorkedMinutes;
  } else if (hasValidTimeRange) {
    minutes = isExternalHelp
      ? normalizeMinutesToQuarterHour(getExternalHelpWorkedMinutes(start, end))
      : calculatedWorkedMinutes;
  } else if (parsedEntryMinutes !== null) {
    minutes = normalizeMinutesToQuarterHour(parsedEntryMinutes);
  }

  if (isShiftWork && calculatedWorkedMinutes !== null) {
    const normalizedStoredMinutes = parsedEntryMinutes !== null
      ? normalizeMinutesToQuarterHour(parsedEntryMinutes)
      : null;
    if (normalizedStoredMinutes !== null && normalizedStoredMinutes !== calculatedWorkedMinutes) {
      minutes = calculatedWorkedMinutes;
    }
  }

  const warnedUnknownCodes = getWarnedUnknownShiftCodesSet();
  if (isShiftWork && rawCode && !explicitRule && !isFoFallbackWindowMatch && !warnedUnknownCodes.has(rawCode)) {
    warnedUnknownCodes.add(rawCode);
    console.warn(`[schedule] Unbekannter Schichtcode '${rawCode}', Eintrag wird als generische Schicht normalisiert.`);
  }

  const derivedShiftKey = isFoFallbackWindowMatch ? "FO" : (rule?.code || rawCode || "");
  const normalizedMode = entry.mode || entry.shiftType || rule?.mode || "";
  const normalizedShiftType = entry.shiftType || entry.mode || rule?.shiftType || "";

  let normalizedCode = isFoFallbackWindowMatch
    ? "FO"
    : (entry.code || derivedShiftKey);
  if (rule?.code === "L" && start) {
    normalizedCode = getLateShiftCodeFromStart(start);
  } else if (rule?.code === "FO") {
    normalizedCode = "FO";
  }

  let normalizedLabel = entry.label || "";
  if (!normalizedLabel && isExternalHelp) {
    normalizedLabel = "AH";
  } else if (!normalizedLabel && isVacation) {
    normalizedLabel = "U";
  } else if (rule?.code === "FLEX") {
    normalizedLabel = `${start || "00:00"}-${end || "00:00"}`;
  } else if (rule?.label) {
    normalizedLabel = rule.label;
  } else if (!normalizedLabel) {
    normalizedLabel = normalizedCode || derivedShiftKey || "";
  }

  return {
    ...entry,
    type,
    status,
    shiftKey: derivedShiftKey,
    shiftType: normalizedShiftType,
    code: normalizedCode,
    mode: normalizedMode,
    start,
    end,
    pause,
    breakMinutes: pause,
    note: entry.note || "",
    branch: entry.branch || "",
    externalHelp: isExternalHelp,
    minutes,
    label: normalizedLabel
  };
}

function isVacationScheduleEntry(entry) {
  return isVacationEntry(entry);
}

function setVacationEntry(employeeId, isoDate, options = {}) {
  if (!employeeId || !isoDate) return null;

  return updateEmployeeDay(
    employeeId,
    isoDate,
    () => ({
      type: "vacation",
      status: ENTRY_STATUS.VACATION,
      label: "U",
      minutes: 0,
      note: options.note || ""
    }),
    { commit: options.commit !== false }
  );
}

function clearVacationEntry(employeeId, isoDate, options = {}) {
  const current = getPlanEntry(employeeId, isoDate);
  if (!isVacationScheduleEntry(current)) return;
  clearPlanEntry(employeeId, isoDate, options);
}

function syncVacationScheduleFromAbsences(employeeId = null) {
  const targetEmployeeIds = employeeId
    ? [employeeId]
    : state.employees.map((emp) => emp.id);

  targetEmployeeIds.forEach((empId) => {
    Object.entries(state.schedule || {}).forEach(([isoDate, dayEntries]) => {
      if (!dayEntries || !dayEntries[empId]) return;
      if (isVacationScheduleEntry(dayEntries[empId])) {
        delete dayEntries[empId];
        cleanupScheduleDay(isoDate);
      }
    });

    (state.absences || [])
      .filter((entry) => entry?.employeeId === empId && entry.type === "vacation")
      .forEach((entry) => {
        let cursor = entry.from;

        while (cursor <= entry.to) {
          setVacationEntry(empId, cursor, { commit: false, note: entry.note || "" });
          cursor = shiftIsoDateByDays(cursor, 1);
        }
      });
  });
}

function getUsedVacationDaysFromScheduleForEmployee(employeeId, year = new Date().getFullYear()) {
  if (!employeeId || !year) return 0;

  return Object.entries(state.schedule || {}).reduce((sum, [isoDate, dayEntries]) => {
    if (!isoDate.startsWith(`${year}-`)) return sum;
    if (!isWorkdayForVacation(isoDate, { considerHolidays: true })) return sum;

    const entry = dayEntries?.[employeeId];
    return sum + (isVacationScheduleEntry(entry) ? 1 : 0);
  }, 0);
}

function refreshEmployeeVacationCounters(year = new Date().getFullYear()) {
  state.employees.forEach((emp) => {
    const totalVacationDays = Number(emp.totalVacationDays ?? emp.vacationDays ?? 30) || 0;
    const usedVacationDays = getUsedVacationDaysFromScheduleForEmployee(emp.id, year);
    const remainingVacationDays = totalVacationDays - usedVacationDays;

    emp.totalVacationDays = totalVacationDays;
    emp.vacationDays = totalVacationDays;
    emp.usedVacationDays = usedVacationDays;
    emp.remainingVacationDays = remainingVacationDays;
  });
}

function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") return {};

  const normalized = {};

  Object.entries(schedule).forEach(([isoDate, dayEntries]) => {
    if (!dayEntries || typeof dayEntries !== "object") return;

    const nextDay = {};

    Object.entries(dayEntries).forEach(([employeeId, entry]) => {
      const normalizedEntry = normalizePlanEntry(entry);
      if (normalizedEntry) {
        nextDay[employeeId] = normalizedEntry;
      }
    });

    if (Object.keys(nextDay).length > 0) {
      normalized[isoDate] = nextDay;
    }
  });

  return normalized;
}

function validateNormalizedSchedule(schedule, options = {}) {
  const { logWarnings = false } = options;

  if (!schedule || typeof schedule !== "object") {
    return { schedule: {}, report: { correctedEntries: 0 } };
  }

  const report = { correctedEntries: 0 };
  const validatedSchedule = {};

  Object.entries(schedule).forEach(([isoDate, dayEntries]) => {
    if (!dayEntries || typeof dayEntries !== "object") return;

    const nextDay = {};

    Object.entries(dayEntries).forEach(([employeeId, entry]) => {
      if (!entry || typeof entry !== "object") return;

      const nextEntry = { ...entry };
      const start = nextEntry.start;
      const end = nextEntry.end;

      if (start && end) {
        const span = diffMinutesBetweenHHMM(start, end);
        const pauseMinutes = Number(nextEntry.pause ?? nextEntry.breakMinutes ?? 0) || 0;
        const expectedMinutes = normalizeMinutesToQuarterHour(Math.max(0, span - pauseMinutes));
        const parsedStoredMinutes = Number(nextEntry.minutes);
        const storedMinutes = Number.isFinite(parsedStoredMinutes)
          ? normalizeMinutesToQuarterHour(parsedStoredMinutes)
          : 0;

        if (storedMinutes !== expectedMinutes) {
          nextEntry.minutes = expectedMinutes;
          report.correctedEntries += 1;

          if (logWarnings) {
            console.warn(
              `[schedule-validation] korrigiert ${isoDate}/${employeeId}: gespeichert=${storedMinutes}, erwartet=${expectedMinutes}`
            );
          }
        }
      }

      nextDay[employeeId] = nextEntry;
    });

    if (Object.keys(nextDay).length > 0) {
      validatedSchedule[isoDate] = nextDay;
    }
  });

  return {
    schedule: validatedSchedule,
    report
  };
}

function cleanupScheduleDay(isoDate) {
  const day = state.schedule?.[isoDate];
  if (!day) return;

  if (Object.keys(day).length === 0) {
    delete state.schedule[isoDate];
  }
}

function getScheduleEntry(employeeId, isoDate) {
  return getPlanEntry(employeeId, isoDate);
}

function getPlanEntry(employeeId, isoDate) {
  if (!employeeId || !isoDate) return null;
  const entry = state.schedule?.[isoDate]?.[employeeId] || null;
  return normalizePlanEntry(entry);
}

function getScheduleEntrySafe(employeeId, isoDate) {
  return getScheduleEntry(employeeId, isoDate);
}

function getEmployeeDayEntry(employeeId, isoDate) {
  return getScheduleEntrySafe(employeeId, isoDate);
}

function hasEmployeeWorkEntry(employeeId, isoDate) {
  const entry = getEmployeeDayEntry(employeeId, isoDate);
  if (!entry) return false;

  const status = getEntryStatus(entry);
  return status === ENTRY_STATUS.WORK || status === ENTRY_STATUS.EXTERNAL;
}

function decideMutationForIsoRange(fromIso, toIso = fromIso, mutationKind = "direct-day") {
  const allowedMutationKinds = new Set(["direct-day", "absence-range"]);
  if (!allowedMutationKinds.has(mutationKind)) {
    return { allow: false, reason: "invalid-mutation-kind", fromIso, toIso, mutationKind };
  }

  const isoDates = eachIsoDateInRange(fromIso, toIso);
  if (!isoDates.length) {
    return { allow: false, reason: "invalid-range", fromIso, toIso, mutationKind };
  }

  if (mutationKind === "direct-day") {
    for (const isoDate of isoDates) {
      const holiday = getHolidayByDate(APP_META.stateKey, isoDate);
      if (holiday) {
        return {
          allow: false,
          reason: "holiday",
          isoDate,
          holidayName: holiday.name || "",
          mutationKind
        };
      }
    }
  }

  return { allow: true, reason: "ok", fromIso, toIso, mutationKind };
}

function resolveDayOverwriteDecision({
  employeeId,
  fromIso,
  toIso = fromIso,
  nextType,
  nextAbsenceType = null,
  mutationKind = "direct-day"
} = {}) {
  const mutationDecision = decideMutationForIsoRange(fromIso, toIso, mutationKind);
  if (!mutationDecision.allow) {
    return { decision: "deny", reason: mutationDecision.reason, mutationDecision };
  }

  const isoDates = eachIsoDateInRange(fromIso, toIso);
  let hasShiftCoverage = false;
  let hasAbsenceCoverage = false;
  let shiftCoverageDays = 0;
  let absenceCoverageDays = 0;
  let vacationCoverageDays = 0;
  let sickCoverageDays = 0;

  isoDates.forEach((isoDate) => {
    const planEntry = getPlanEntry(employeeId, isoDate);
    if (isShiftEntry(planEntry)) {
      hasShiftCoverage = true;
      shiftCoverageDays += 1;
    }

    const absenceEntry = getPriorityAbsenceForEmployeeOnDate(state.absences || [], employeeId, isoDate);
    if (absenceEntry) {
      hasAbsenceCoverage = true;
      absenceCoverageDays += 1;

      if (absenceEntry.type === "vacation") {
        vacationCoverageDays += 1;
      } else if (absenceEntry.type === "sick") {
        sickCoverageDays += 1;
      }
    }
  });

  if (nextType === "shift" && hasAbsenceCoverage) {
    return {
      decision: "confirm",
      reason: "replace-absence-with-shift",
      affectedDays: absenceCoverageDays
    };
  }

  if (nextType === "absence") {
    if (hasShiftCoverage) {
      return {
        decision: "confirm",
        reason: "replace-shift-with-absence",
        affectedDays: shiftCoverageDays
      };
    }

    if (nextAbsenceType === "vacation" && sickCoverageDays > 0) {
      return {
        decision: "confirm",
        reason: "replace-sick-with-vacation",
        affectedDays: sickCoverageDays
      };
    }

    if (nextAbsenceType === "sick" && vacationCoverageDays > 0) {
      return {
        decision: "confirm",
        reason: "replace-vacation-with-sick",
        affectedDays: vacationCoverageDays
      };
    }
  }

  if (nextType === "off" && (hasShiftCoverage || hasAbsenceCoverage)) {
    return {
      decision: "confirm",
      reason: "replace-entry-with-off",
      affectedDays: Math.max(shiftCoverageDays, absenceCoverageDays)
    };
  }

  return {
    decision: "allow",
    reason: "ok",
    shiftCoverageDays,
    absenceCoverageDays,
    vacationCoverageDays,
    sickCoverageDays
  };
}

function removeAbsenceCoverageForRange(employeeId, fromIso, toIso) {
  state.absences = normalizeAbsences(
    replaceAbsenceCoverage(
      state.absences || [],
      employeeId,
      fromIso,
      toIso,
      null
    )
  );
}

function clearShiftCoverageForRange(employeeId, fromIso, toIso) {
  eachIsoDateInRange(fromIso, toIso).forEach((isoDate) => {
    clearPlanEntry(employeeId, isoDate, { commit: false });
  });
}

function getOverwriteConfirmationText(reason, affectedDays, isSingleDay) {
  if (reason === "replace-absence-with-shift") {
    return isSingleDay
      ? "Abwesenheit wird durch Schicht ersetzt. Fortfahren?"
      : `Abwesenheit an ${affectedDays} Tag(en) wird durch Schicht ersetzt. Fortfahren?`;
  }

  if (reason === "replace-shift-with-absence") {
    return isSingleDay
      ? "Schicht wird durch Abwesenheit ersetzt. Fortfahren?"
      : `Schicht an ${affectedDays} Tag(en) wird durch Abwesenheit ersetzt. Fortfahren?`;
  }

  if (reason === "replace-sick-with-vacation") {
    return isSingleDay
      ? "Krank wird durch Urlaub ersetzt. Fortfahren?"
      : `Krank an ${affectedDays} Tag(en) wird durch Urlaub ersetzt. Fortfahren?`;
  }

  if (reason === "replace-vacation-with-sick") {
    return isSingleDay
      ? "Urlaub wird durch Krank ersetzt. Fortfahren?"
      : `Urlaub an ${affectedDays} Tag(en) wird durch Krank ersetzt. Fortfahren?`;
  }

  if (reason === "replace-entry-with-off") {
    return isSingleDay
      ? "Bestehender Eintrag wird durch Frei ersetzt. Fortfahren?"
      : `Bestehende Einträge an ${affectedDays} Tag(en) werden durch Frei ersetzt. Fortfahren?`;
  }

  return "Änderung überschreibt bestehende Einträge. Fortfahren?";
}

function requestOverwriteConfirmation(decision, fromIso, toIso = fromIso) {
  if (!decision || decision.decision !== "confirm") return true;
  const isSingleDay = fromIso === toIso;
  const dayCount = eachIsoDateInRange(fromIso, toIso).length;
  const affectedDays = Math.max(1, Number(decision.affectedDays) || dayCount || 1);
  const message = getOverwriteConfirmationText(decision.reason, affectedDays, isSingleDay);
  return confirm(message);
}

function updateEmployeeDay(employeeId, isoDate, updater, options = {}) {
  if (!employeeId || !isoDate || typeof updater !== "function") return null;
  const mutationDecision = decideMutationForIsoRange(isoDate, isoDate, "direct-day");
  if (!mutationDecision.allow) return null;

  const { commit = true } = options;
  const currentEntry = getPlanEntry(employeeId, isoDate);
  const nextEntry = updater(currentEntry ? { ...currentEntry } : null);

  if (nextEntry == null) {
    if (state.schedule?.[isoDate]?.[employeeId]) {
      delete state.schedule[isoDate][employeeId];
      cleanupScheduleDay(isoDate);
    }

    if (commit) {
      commitPlanChange();
    }

    return null;
  }

  const normalizedEntry = normalizePlanEntry(nextEntry);

  if (!normalizedEntry) {
    if (state.schedule?.[isoDate]?.[employeeId]) {
      delete state.schedule[isoDate][employeeId];
      cleanupScheduleDay(isoDate);
    }

    if (commit) {
      commitPlanChange();
    }

    return null;
  }

  const day = ensureScheduleDay(isoDate);
  day[employeeId] = normalizedEntry;

  if (commit) {
    commitPlanChange();
  }

  return day[employeeId];
}

function setScheduleEntry(employeeId, isoDate, entry) {
  return setPlanEntry(employeeId, isoDate, entry);
}

function setPlanEntry(employeeId, isoDate, entry) {
  if (!employeeId || !isoDate || !entry) return;
  return updateEmployeeDay(employeeId, isoDate, () => ({ ...entry }));
}

function clearScheduleEntry(employeeId, isoDate) {
  return clearPlanEntry(employeeId, isoDate);
}

function clearPlanEntry(employeeId, isoDate, options = {}) {
  if (!employeeId || !isoDate) return;
  return updateEmployeeDay(employeeId, isoDate, () => null, options);
}

function getPreviousRelevantWorkdayIso(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const dayOfWeek = date.getUTCDay();
  const dayOffset = dayOfWeek === 1 ? -2 : -1;
  return shiftIsoDateByDays(isoDate, dayOffset);
}

function normalizeShiftStartForCarryoverEligibility(value) {
  if (typeof normalizePlanTime === "function") {
    return normalizePlanTime(value);
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return "";
  const [hoursRaw, minutesRaw] = trimmed.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "";
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isCarryoverMorningEligibleShift(entry) {
  if (entry?.type !== "shift") return false;
  const normalizedStart = normalizeShiftStartForCarryoverEligibility(entry.start);
  return normalizedStart === "09:00";
}

function applyMepEarlyStartCarryoverRule(isoDate, options = {}) {
  if (!isoDate) return null;

  const { commit = true, returnMeta = false } = options;
  const prevIso = getPreviousRelevantWorkdayIso(isoDate);
  const QUALIFYING_PREV_SHIFT_END = "19:10";
  const yearMonth = String(isoDate).slice(0, 7);
  const activeEmployees = state.employees.filter((emp) => isEmployeeActiveInMonth(emp, yearMonth));
  const hasShiftOnDay = (emp) => {
    const entry = getPlanEntry(emp.id, isoDate);
    return entry?.type === "shift";
  };
  const getRoleTokens = (emp) => {
    const rawValues = [emp?.roleKey, emp?.functionKey, emp?.role, emp?.funktion]
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean);
    return rawValues
      .flatMap((value) => value.split(/[^A-Z0-9]+/))
      .filter(Boolean);
  };
  const hasPriorityRole = (emp, role) => {
    const tokens = getRoleTokens(emp);
    if (role === "TL") return tokens.includes("TL");
    if (role === "SV") return tokens.includes("SV") || tokens.includes("STV");
    return false;
  };
  const getRolePriority = (emp) => {
    if (hasPriorityRole(emp, "TL")) return 2;
    if (hasPriorityRole(emp, "SV")) return 1;
    return 0;
  };
  const getNextRelevantWorkdayIso = (dateIso) => {
    const date = new Date(`${dateIso}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "";
    return shiftIsoDateByDays(dateIso, date.getUTCDay() === 6 ? 2 : 1);
  };
  const isResponsibleLongShift = (employeeId, dateIso) => {
    const entry = getPlanEntry(employeeId, dateIso);
    if (entry?.type !== "shift" || entry.end !== QUALIFYING_PREV_SHIFT_END) return false;
    const start = normalizeShiftStartForCarryoverEligibility(entry.start);
    // A previously assigned 08:55 start still represents its regular 09:00 shift.
    return start === "09:00" || start === "08:55";
  };
  const getResponsibilityContinuity = (employeeId) => {
    let score = 0;
    let cursorIso = prevIso;
    while (cursorIso && isResponsibleLongShift(employeeId, cursorIso)) {
      score += 1;
      cursorIso = getPreviousRelevantWorkdayIso(cursorIso);
    }
    cursorIso = isoDate;
    while (cursorIso && isResponsibleLongShift(employeeId, cursorIso)) {
      score += 1;
      cursorIso = getNextRelevantWorkdayIso(cursorIso);
    }
    return score;
  };

  const eligibleCandidates = activeEmployees.filter((emp) => {
    if (!hasShiftOnDay(emp)) return false;
    const entry = getPlanEntry(emp.id, isoDate);
    if (!isCarryoverMorningEligibleShift(entry)) return false;
    const prevEntry = getPlanEntry(emp.id, prevIso);
    return prevEntry?.type === "shift" && prevEntry.end === QUALIFYING_PREV_SHIFT_END;
  });

  const rankedCandidates = eligibleCandidates
    .map((emp) => ({
      emp,
      rolePriority: getRolePriority(emp),
      continuity: getResponsibilityContinuity(emp.id)
    }))
    .sort((left, right) => (
      right.rolePriority - left.rolePriority
      || right.continuity - left.continuity
      || String(left.emp.id).localeCompare(String(right.emp.id))
    ));
  const selectedEmployee = rankedCandidates[0]?.emp;
  if (!selectedEmployee) return null;

  const selectedEntry = getPlanEntry(selectedEmployee.id, isoDate);
  if (!selectedEntry || selectedEntry.type !== "shift") return null;
  let hasChanges = false;

  activeEmployees.forEach((emp) => {
    if (emp.id === selectedEmployee.id) return;
    const entry = getPlanEntry(emp.id, isoDate);
    if (!entry || entry.type !== "shift" || entry.start !== "08:55") return;
    hasChanges = true;
    updateEmployeeDay(emp.id, isoDate, () => ({ ...entry, start: "09:00" }), { commit: false });
  });

  if (selectedEntry.start !== "08:55") {
    hasChanges = true;
    updateEmployeeDay(selectedEmployee.id, isoDate, () => ({ ...selectedEntry, start: "08:55" }), { commit: false });
  }

  if (commit && hasChanges) {
    commitPlanChange();
  }

  if (returnMeta) {
    return { selectedEmployeeId: selectedEmployee.id, changed: hasChanges };
  }

  return selectedEmployee.id;
}

function applyMepEarlyStartRuleForRange(fromIso, toIso, options = {}) {
  if (!fromIso || !toIso) return { changed: false, changedDays: 0, processedDays: 0 };

  const { commit = true } = options;
  let cursorIso = fromIso <= toIso ? fromIso : toIso;
  const endIso = fromIso <= toIso ? toIso : fromIso;
  let changedDays = 0;
  let processedDays = 0;

  while (cursorIso <= endIso) {
    const result = applyMepEarlyStartCarryoverRule(cursorIso, { commit: false, returnMeta: true });
    if (result?.changed) changedDays += 1;
    processedDays += 1;
    cursorIso = shiftIsoDateByDays(cursorIso, 1);
  }

  if (commit && changedDays > 0) {
    commitPlanChange();
  }

  return {
    changed: changedDays > 0,
    changedDays,
    processedDays
  };
}

function reconcileMepEarlyStartForActiveMonth(options = {}) {
  const yearMonth = normalizeYearMonth(state.activeMonth || (state.weekFrom || toIsoDate(new Date())).slice(0, 7));
  if (!yearMonth) return { changed: false, changedDays: 0, processedDays: 0 };
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return applyMepEarlyStartRuleForRange(`${yearMonth}-01`, `${yearMonth}-${pad2(lastDay)}`, options);
}

function setShift(employeeId, isoDate, entryOrShiftKey) {
  let entry = entryOrShiftKey;

  if (typeof entryOrShiftKey === "string") {
    const normalizedShiftKey = normalizeShiftCode(entryOrShiftKey);
    if (normalizedShiftKey === "L") {
      entry = buildLateShiftEntry("13:00", true);
    } else if (normalizedShiftKey === "G") {
      entry = buildFullShiftEntry(true);
    } else {
      entry = buildEarlyShiftEntry(normalizedShiftKey);
    }
  }

  if (!entry || entry.type !== "shift") return;
  const decision = resolveDayOverwriteDecision({
    employeeId,
    fromIso: isoDate,
    nextType: "shift",
    mutationKind: "direct-day"
  });
  if (decision.decision === "deny") return false;
  if (!requestOverwriteConfirmation(decision, isoDate)) return false;

  removeAbsenceCoverageForRange(employeeId, isoDate, isoDate);
  updateEmployeeDay(employeeId, isoDate, () => ({ ...entry }), { commit: false });
  applyMepEarlyStartCarryoverRule(isoDate, { commit: false });
  syncVacationScheduleFromAbsences(employeeId);
  commitPlanChange();
  return true;
}

function setOffDay(employeeId, isoDate, options = {}) {
  if (!employeeId || !isoDate) return false;

  const decision = resolveDayOverwriteDecision({
    employeeId,
    fromIso: isoDate,
    nextType: "off",
    mutationKind: "direct-day"
  });
  if (decision.decision === "deny") return false;
  if (!requestOverwriteConfirmation(decision, isoDate)) return false;

  const { commit = true } = options;

  removeAbsenceCoverageForRange(employeeId, isoDate, isoDate);
  updateEmployeeDay(employeeId, isoDate, () => ({
    type: "off",
    status: ENTRY_STATUS.OFF,
    label: "FR",
    minutes: 0
  }), { commit: false });
  syncVacationScheduleFromAbsences(employeeId);

  if (commit) {
    commitPlanChange();
  }

  return true;
}

function setExternalHelp(employeeId, isoDate, branch, minutes) {
  const normalizedMinutes = normalizeMinutesToQuarterHour(minutes);

  setPlanEntry(employeeId, isoDate, {
    type: "external-help",
    status: ENTRY_STATUS.EXTERNAL,
    label: "AH",
    branch,
    externalHelp: true,
    minutes: normalizedMinutes,
    pause: 0,
    breakMinutes: 0,
    start: "",
    end: ""
  });
}

function setAbsence(employeeId, from, to, type, note = "", options = {}) {
  const decision = resolveDayOverwriteDecision({
    employeeId,
    fromIso: from,
    toIso: to,
    nextType: "absence",
    nextAbsenceType: type,
    mutationKind: "absence-range"
  });
  if (decision.decision === "deny") return null;
  if (!requestOverwriteConfirmation(decision, from, to)) return null;

  const { commit = true } = options;
  clearShiftCoverageForRange(employeeId, from, to);
  state.absences = normalizeAbsences(
    replaceAbsenceCoverage(
      state.absences || [],
      employeeId,
      from,
      to,
      type
    )
  );
  const createdAbsence = getPriorityAbsenceForEmployeeOnDate(state.absences, employeeId, from);
  if (!createdAbsence) return null;

  if (commit) {
    commitPlanChange();
  }

  return createdAbsence;
}

function removeAbsence(absenceId) {
  state.absences = removeAbsenceEntry(state.absences || [], absenceId);

  commitPlanChange();
}

function applyVacationDaysForYear(year) {
  state.employees.forEach((emp) => {
    if (!emp) return;
    emp.vacationDays = calculateVacationDays(emp, year);
  });

  saveAppStateDebounced();
  renderAllViews();
}
function clearDay(employeeId, isoDate, options = {}) {
  if (!employeeId || !isoDate) return;
  const decision = resolveDayOverwriteDecision({
    employeeId,
    fromIso: isoDate,
    nextType: "clear",
    mutationKind: "direct-day"
  });
  if (decision.decision === "deny") return false;

  const { commit = true } = options;

 

  clearPlanEntry(employeeId, isoDate, { commit: false });

  removeAbsenceCoverageForRange(employeeId, isoDate, isoDate);
  syncVacationScheduleFromAbsences(employeeId);

  if (commit) {
    commitPlanChange();
  }

  return true;
}
function commitPlanChange() {
  refreshEmployeeVacationCounters();
  saveAppStateDebounced();
  renderAllViews();
}

/* ========= DOM ========= */
const teamListEl = document.getElementById("teamList");
const dayTabsEl = document.getElementById("dayTabs");
const plannerListEl = document.getElementById("plannerList");
const metaDayNameEl = document.getElementById("metaDayName");
const dayWarningsEl = document.getElementById("dayWarnings");
const dayHoursInfoEl = document.getElementById("dayHoursInfo");
const weekTableBodyEl = document.getElementById("weekTableBody");
const weekWarningsEl = document.getElementById("weekWarnings");

const weekFromEl = document.getElementById("weekFrom");
const weekToEl = document.getElementById("weekTo");

const teamSectionEl = document.getElementById("teamSection");
const btnToggleTeamEl = document.getElementById("btnToggleTeam");
const btnAddEmployeeEl = document.getElementById("btnAddEmployee");

const weeklyHoursActualEl = document.getElementById("weeklyHoursActual");
const weeklyHoursRemainingEl = document.getElementById("weeklyHoursRemaining");
const weeklyHoursStatusEl = document.getElementById("weeklyHoursStatus");

const dayViewEl = document.getElementById("dayView");
const weekViewEl = document.getElementById("weekView");
const monthViewEl = document.getElementById("monthView");
const overviewViewEl = document.getElementById("overviewView");
const mepTemplateViewEl = document.getElementById("mepTemplateView");

const btnViewDayEl = document.getElementById("btnViewDay");
const btnViewWeekEl = document.getElementById("btnViewWeek");
const btnViewMonthEl = document.getElementById("btnViewMonth");
const btnViewOverviewEl = document.getElementById("btnViewOverview");
const btnViewMepEl = document.getElementById("btnViewMep");
const btnPrevWeekEl = document.getElementById("btnPrevWeek");
const btnCurrentWeekEl = document.getElementById("btnCurrentWeek");
const btnNextWeekEl = document.getElementById("btnNextWeek");
const viewMetaLineEl = document.getElementById("viewMetaLine");
const topToolbarEl = document.getElementById("topToolbar");
const btnResetWeekEl = document.getElementById("btnResetWeek");
const btnExportBackupEl = document.getElementById("btnExportBackup");
const btnImportBackupEl = document.getElementById("btnImportBackup");
const btnExportPlanning2El = document.getElementById("btnExportPlanning2");
const backupFileInputEl = document.getElementById("backupFileInput");
let isReconcilingMepEarlyStartForActiveMonth = false;
const backupInfoEl = document.getElementById("backupInfo");
const saveStatusEl = document.getElementById("saveStatus");
const btnPrintEl = document.getElementById("btnPrint");
const btnOverviewUploadEl = document.getElementById("btnOverviewUpload");
const overviewSalesWeekSelectEl = document.getElementById("overviewSalesWeekSelect");
const overviewSalesDayChipListEl = document.getElementById("overviewSalesDayChipList");
const overviewSalesDateEl = document.getElementById("overviewSalesDate");
const overviewSalesAmountEl = document.getElementById("overviewSalesAmount");
const btnOverviewSalesSaveEl = document.getElementById("btnOverviewSalesSave");
const btnOverviewSalesDeleteEl = document.getElementById("btnOverviewSalesDelete");
const overviewSalesSaveStatusEl = document.getElementById("overviewSalesSaveStatus");
const btnMepModeNormalEl = document.getElementById("btnMepModeNormal");
const btnMepModeAnonymEl = document.getElementById("btnMepModeAnonym");
const btnMoreActionsEl = document.getElementById("btnMoreActions");
const mobileMoreMenuPanelEl = document.getElementById("mobileMoreMenuPanel");
const manualMonthDialogOverlayEl = document.getElementById("manualMonthDialogOverlay");
const manualMonthDialogTitleEl = document.getElementById("manualMonthDialogTitle");
const manualMonthRowsEl = document.getElementById("manualMonthRows");
const manualMonthBulkInputEl = document.getElementById("manualMonthBulkInput");
const manualMonthValidationEl = document.getElementById("manualMonthValidation");
const btnManualMonthAddRowEl = document.getElementById("btnManualMonthAddRow");
const btnManualMonthApplyBulkEl = document.getElementById("btnManualMonthApplyBulk");
const btnManualMonthCancelEl = document.getElementById("btnManualMonthCancel");
const btnManualMonthSaveEl = document.getElementById("btnManualMonthSave");
let manualMonthDialogPreviousFocusEl = null;

const mepWeekFromEl = document.getElementById("mepWeekFrom");
const mepWeekToEl = document.getElementById("mepWeekTo");
const mepMonthYearEl = document.getElementById("mepMonthYear");

/* ========= HELPERS ========= */
function formatSignedMinutes(min) {
  if (min === 0) return "0:00";
  return `${min > 0 ? "+" : "-"}${minutesToHM(Math.abs(min))}`;
}

function formatHMToQuarterLabel(hmValue) {
  if (typeof hmValue !== "string" || !/^\d{1,2}:\d{2}$/.test(hmValue.trim())) return hmValue || "";

  const [hoursText, minutesText] = hmValue.trim().split(":");
  const hours = String(Number(hoursText));
  const minutes = Number(minutesText);

  if (![0, 15, 30, 45].includes(minutes)) return `${hours}:${minutesText}`;

  const quarterLabelByMinute = {
    0: "00",
    15: "¼",
    30: "½",
    45: "¾"
  };

  return `${hours}:${quarterLabelByMinute[minutes]}`;
}

function formatMonthYear(dateStr) {
  if (!dateStr) return "____________";
  const d = fromIsoDate(dateStr);
  if (!d) return "____________";
  return `${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function normalizeIsoDate(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const date = fromIsoDate(trimmed);
  if (!date) return "";
  return toIsoDate(date);
}

function roleToTarget(roleKey) {
  const found = ROLE_OPTIONS.find((r) => r.key === roleKey);
  return found?.target || "";
}

function roleToContractModel(roleKey) {
  const found = ROLE_OPTIONS.find((r) => r.key === roleKey);
  return found?.contractModel || "";
}

function normalizeManualMonthActualMinutes(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  return Object.entries(rawValue).reduce((acc, [yearMonth, minutes]) => {
    const normalizedYearMonth = normalizeYearMonth(yearMonth);
    const numericMinutes = Number(minutes);
    if (!normalizedYearMonth || !Number.isFinite(numericMinutes) || numericMinutes < 0) {
      return acc;
    }

    acc[normalizedYearMonth] = Math.round(numericMinutes);
    return acc;
  }, {});
}

function normalizeEmployee(employee, index = 0) {
  const roleKey = employee?.roleKey || "";

  return {
    id: employee?.id || `emp_${index + 1}`,
    name: employee?.name || "",
    roleKey,
    target: employee?.target || roleToTarget(roleKey),
    contractModel: employee?.contractModel || roleToContractModel(roleKey),
    contractTargetMinutesPerMonth: Number(employee?.contractTargetMinutesPerMonth) || 0,
    totalVacationDays: Number(employee?.totalVacationDays ?? employee?.vacationDays ?? 30),
    usedVacationDays: Number(employee?.usedVacationDays ?? 0),
    remainingVacationDays: Number(employee?.remainingVacationDays ?? employee?.vacationDays ?? 30),
    vacationDays: Number(employee?.totalVacationDays ?? employee?.vacationDays ?? 30),
    birthDate: employee?.birthDate || "",
    serviceBonus: Boolean(employee?.serviceBonus),
    planning2FullDayCandidate: employee?.planning2FullDayCandidate === true,
    activeFromMonth: normalizeYearMonth(employee?.activeFromMonth),
    activeToMonth: normalizeYearMonth(employee?.activeToMonth),
    manualMonthActualMinutes: normalizeManualMonthActualMinutes(employee?.manualMonthActualMinutes),
    shifts: {}
  };
}

function isEmployeeActiveInMonth(employee, yearMonth) {
  if (!employee) return false;

  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return true;

  const activeFromMonth = normalizeYearMonth(employee.activeFromMonth);
  const activeToMonth = normalizeYearMonth(employee.activeToMonth);

  if (activeFromMonth && normalizedYearMonth < activeFromMonth) return false;
  if (activeToMonth && normalizedYearMonth > activeToMonth) return false;

  return true;
}

/* ========= STORAGE ========= */
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function defaultUiState() {
  return {
    teamCollapsed: false,
    currentView: "week",
    mepAnonymized: false
  };
}

function loadUiState() {
  const rawUi = loadJson(UI_KEY, defaultUiState());
  const sanitizedUi = sanitizeUiState(rawUi, defaultUiState);

  if (JSON.stringify(rawUi || {}) !== JSON.stringify(sanitizedUi)) {
    saveJson(UI_KEY, sanitizedUi);
  }

  return sanitizedUi;
}

function saveUiState() {
  return saveJson(UI_KEY, uiState);
}

function getLastSavedAt() {
  const value = loadJson(LAST_SAVED_AT_KEY, "");
  return typeof value === "string" ? value : "";
}

function updateSaveStatus(message, options = {}) {
  const { isError = false, hideAfterMs = 0 } = options;

  saveStatusMessage = message || "";
  saveStatusHasError = Boolean(isError);

  if (!saveStatusEl) return;

  saveStatusEl.textContent = saveStatusMessage;
  saveStatusEl.classList.toggle("isError", saveStatusHasError);

  if (saveStatusTimerId) {
    clearTimeout(saveStatusTimerId);
    saveStatusTimerId = null;
  }

  if (hideAfterMs > 0) {
    saveStatusTimerId = setTimeout(() => {
      saveStatusMessage = "";
      saveStatusHasError = false;
      saveStatusTimerId = null;
      refreshSaveStatusLabel();
    }, hideAfterMs);
  }
}

function refreshSaveStatusLabel() {
  if (saveStatusMessage) {
    updateSaveStatus(saveStatusMessage, { isError: saveStatusHasError });
    return;
  }

  const savedAt = getLastSavedAt();
  if (savedAt) {
    updateSaveStatus(`Zuletzt gespeichert: ${formatDateTimeForDisplay(savedAt)}`);
  } else {
    updateSaveStatus("Noch nicht gespeichert");
  }
}

function saveMasterData() {
  return saveJson(MASTER_KEY, {
    employees: state.employees.map((emp) => ({
      id: emp.id,
      name: emp.name,
      roleKey: emp.roleKey,
      target: emp.target,
      contractModel: emp.contractModel || "",
      contractTargetMinutesPerMonth: Number(emp.contractTargetMinutesPerMonth) || 0,
      totalVacationDays: Number(emp.totalVacationDays ?? emp.vacationDays ?? 30),
      usedVacationDays: Number(emp.usedVacationDays ?? 0),
      remainingVacationDays: Number(emp.remainingVacationDays ?? emp.vacationDays ?? 30),
      vacationDays: Number(emp.totalVacationDays ?? emp.vacationDays ?? 30),
      birthDate: emp.birthDate || "",
      serviceBonus: Boolean(emp.serviceBonus),
      planning2FullDayCandidate: emp.planning2FullDayCandidate === true,
      activeFromMonth: normalizeYearMonth(emp.activeFromMonth),
      activeToMonth: normalizeYearMonth(emp.activeToMonth),
      manualMonthActualMinutes: normalizeManualMonthActualMinutes(emp.manualMonthActualMinutes)
    }))
  });
}

function savePlanData() {
  return saveJson(PLAN_KEY, {
    weekFrom: state.weekFrom,
    weekTo: state.weekTo,
    schedule: state.schedule || {},
    absences: state.absences || [],
    salesByDate: state.salesByDate || {},
    monthlyPlanBaselines: normalizeMonthlyPlanBaselines(state.monthlyPlanBaselines)
  });
}

function saveAppState() {
  const savedAt = new Date().toISOString();
  const masterSaved = saveMasterData();
  const planSaved = savePlanData();
  const uiSaved = saveUiState();
  const savedAtPersisted = saveJson(LAST_SAVED_AT_KEY, savedAt);

  if (masterSaved && planSaved && uiSaved && savedAtPersisted) {
    lastSavedAt = savedAt;
    updateSaveStatus("Gespeichert", { hideAfterMs: 2500 });
    return true;
  }

  updateSaveStatus("Speichern fehlgeschlagen", { isError: true, hideAfterMs: 4000 });
  return false;
}

function saveAppStateDebounced() {
  if (autoSaveTimerId) {
    clearTimeout(autoSaveTimerId);
  }

  autoSaveTimerId = setTimeout(() => {
    autoSaveTimerId = null;
    saveAppState();
  }, AUTOSAVE_DELAY_MS);
}

function flushPendingAutoSave() {
  if (!autoSaveTimerId) return;
  clearTimeout(autoSaveTimerId);
  autoSaveTimerId = null;
  saveAppState();
}

function loadAppState() {
  const rawPlan = loadJson(PLAN_KEY, defaultPlanState());
  const normalizedSchedule = rawPlan.schedule && typeof rawPlan.schedule === "object"
    ? normalizeSchedule(rawPlan.schedule)
    : {};
  const {
    schedule: validatedSchedule,
    report: scheduleValidationReport
  } = validateNormalizedSchedule(normalizedSchedule, { logWarnings: true });
  const shouldPersistNormalizedSchedule = JSON.stringify(rawPlan.schedule || {}) !== JSON.stringify(validatedSchedule);

  if (shouldPersistNormalizedSchedule) {
    saveJson(PLAN_KEY, {
      ...rawPlan,
      schedule: validatedSchedule
    });
  }

  return {
    ui: loadUiState(),
    state: buildInitialState({
      planOverride: {
        ...rawPlan,
        schedule: validatedSchedule
      }
    }),
    scheduleValidationReport,
    lastSavedAt: getLastSavedAt()
  };
}

/* ========= DEFAULT DATA ========= */
function createDefaultEmployees() {
  return [
    { id: "emp_1", name: "Stephan M", roleKey: "TL", target: "30:00", contractModel: "VZ30", totalVacationDays: 30, usedVacationDays: 0, remainingVacationDays: 30, vacationDays: 30, birthDate: "", activeFromMonth: "", activeToMonth: "",
  serviceBonus: false, shifts: {} },
    { id: "emp_2", name: "Mitarbeiter 2", roleKey: "TZ30", target: "30:00", contractModel: "TZ30", totalVacationDays: 30, usedVacationDays: 0, remainingVacationDays: 30, vacationDays: 30, birthDate: "", activeFromMonth: "", activeToMonth: "",
  serviceBonus: false, shifts: {} },
    { id: "emp_3", name: "Mitarbeiter 3", roleKey: "TZ20", target: "20:00", contractModel: "TZ20", totalVacationDays: 30, usedVacationDays: 0, remainingVacationDays: 30, vacationDays: 30, birthDate: "", activeFromMonth: "", activeToMonth: "",
  serviceBonus: false, shifts: {} },
    { id: "emp_4", name: "Mitarbeiter 4", roleKey: "TZ15", target: "15:00", contractModel: "TZ15", totalVacationDays: 30, usedVacationDays: 0, remainingVacationDays: 30, vacationDays: 30, birthDate: "", activeFromMonth: "", activeToMonth: "",
  serviceBonus: false, shifts: {} },
    { id: "emp_5", name: "Mitarbeiter 5", roleKey: "TZ20", target: "20:00", contractModel: "TZ20", totalVacationDays: 30, usedVacationDays: 0, remainingVacationDays: 30, vacationDays: 30, birthDate: "", activeFromMonth: "", activeToMonth: "",
  serviceBonus: false, shifts: {} }
  ];
}

function defaultMasterState() {
  return {
    employees: createDefaultEmployees().map((emp) => ({
      id: emp.id,
      name: emp.name,
      roleKey: emp.roleKey,
      target: emp.target,
      contractModel: emp.contractModel || roleToContractModel(emp.roleKey || ""),
      contractTargetMinutesPerMonth: Number(emp.contractTargetMinutesPerMonth) || 0,
      totalVacationDays: Number(emp.totalVacationDays ?? emp.vacationDays ?? 30),
      usedVacationDays: Number(emp.usedVacationDays ?? 0),
      remainingVacationDays: Number(emp.remainingVacationDays ?? emp.vacationDays ?? 30),
      vacationDays: Number(emp.totalVacationDays ?? emp.vacationDays ?? 30),
      birthDate: emp.birthDate,
      serviceBonus: emp.serviceBonus,
      planning2FullDayCandidate: emp.planning2FullDayCandidate === true,
      activeFromMonth: normalizeYearMonth(emp.activeFromMonth),
      activeToMonth: normalizeYearMonth(emp.activeToMonth)
    }))
  };
}

function defaultPlanState() {
  return {
    weekFrom: "",
    weekTo: "",
    schedule: {},
    absences: [],
    salesByDate: {},
    monthlyPlanBaselines: {}
  };
}
function buildInitialState(options = {}) {
  const master = loadJson(MASTER_KEY, defaultMasterState());
  const plan = options.planOverride || loadJson(PLAN_KEY, defaultPlanState());

  const baseEmployees = Array.isArray(master.employees)
    ? master.employees
    : defaultMasterState().employees;

 const employees = baseEmployees.map((emp, index) => normalizeEmployee(emp, index));

  const normalizedSchedule = plan.schedule && typeof plan.schedule === "object"
    ? normalizeSchedule(plan.schedule)
    : {};
  const { schedule } = validateNormalizedSchedule(normalizedSchedule);

  const absences = Array.isArray(plan.absences)
    ? normalizeAbsences(plan.absences)
    : [];

  const salesByDate = Object.entries(plan.salesByDate || {})
    .reduce((acc, [isoDate, value]) => {
      const normalizedIso = normalizeIsoDate(isoDate);
      const numericValue = Number(value);
      if (!normalizedIso || !Number.isFinite(numericValue)) return acc;
      acc[normalizedIso] = numericValue;
      return acc;
    }, {});

    return {
    weekFrom: plan.weekFrom || "",
    weekTo: plan.weekTo || "",
    monthPlan: null,
    activeMonth: (plan.weekFrom || toIsoDate(new Date())).slice(0, 7),
    employees,
    schedule,
    absences,
    salesByDate,
    monthlyPlanBaselines: normalizeMonthlyPlanBaselines(plan.monthlyPlanBaselines)
  };
}


/* ========= ACTIVE WEEK ========= */
function getActiveMonthPlan() {
  const activeMonth = state.activeMonth || (state.weekFrom || toIsoDate(new Date())).slice(0, 7);
  return getMonthPlanFromYearMonth(activeMonth);
}

function syncMonthPlanToState() {
  state.monthPlan = getActiveMonthPlan();
  return state.monthPlan;
}

function getCurrentMonthWeeks() {
  return state.monthPlan?.weeks || [];
}

function getActiveWeekDays() {
  const weeks = getCurrentMonthWeeks();
  if (!weeks.length) return [];

  if (state.weekFrom) {
    const found = weeks.find((week) => week.some((day) => day.iso === state.weekFrom));
    if (found) return found;
  }

  return weeks[0];
}

function syncWeekRangeFromActiveWeek() {
  const week = getActiveWeekDays();
  if (!week.length) return;

  state.weekFrom = week[0].iso;
  state.weekTo = week[6].iso;

  if (weekFromEl) weekFromEl.value = state.weekFrom;
  if (weekToEl) weekToEl.value = state.weekTo;
}

function getDayObjectByIndex(index) {
  const week = getActiveWeekDays();
  return week[index] || null;
}

function getCurrentDayObject() {
  return getDayObjectByIndex(currentDayIndex);
}

function getCurrentDayIso() {
  return getCurrentDayObject()?.iso || "";
}

function shiftActiveWeek(days) {
  const date = fromIsoDate(state.weekFrom);
  if (!date) return;

  date.setDate(date.getDate() + days);
  state.weekFrom = toIsoDate(date);
  state.activeMonth = state.weekFrom.slice(0, 7);

  syncMonthPlanToState();
  syncWeekRangeFromActiveWeek();
  commitPlanChange();
}

/* ========= SHIFT HELPERS ========= */
function getShiftByKey(key) {
  const normalizedKey = normalizeShiftCode(key);
  const rule = getShiftRuleByCode(normalizedKey);

  if (!rule || rule.entryType !== "shift") {
    return { key: "-", type: "free" };
  }

  return {
    key: rule.code,
    type: rule.mode || "free"
  };
}

function getShiftClassByKey(key) {
  return getShiftByKey(key).type || "free";
}

function getShiftForEmployeeOnIso(emp, iso) {
  const entry = getEmployeeDayEntry(emp.id, iso);
  if (!entry) return "-";

  if (entry.type !== "shift") return "-";
  return entry.code || "-";
}


function shiftDurationMinutes(shiftKey) {
  const rule = getShiftRuleByCode(shiftKey);
  if (!rule || rule.entryType !== "shift") return 0;

  if (rule.startPolicy?.type !== "fixed" || rule.endPolicy?.type !== "fixed") return 0;

  return hhmmToMinutes(rule.endPolicy.value) - hhmmToMinutes(rule.startPolicy.value);
}

function appliedPauseMinutes(shiftKey) {
  const rule = getShiftRuleByCode(shiftKey);
  if (!rule || rule.entryType !== "shift") return 0;

  if (rule.breakPolicy?.type === "configured") {
    // Legacy: nur statischer Basiswert für einfache Fixschichten.
    // Keine 70-/Sonderlogik außerhalb getBusinessRequiredBreakMinutes.
    return Number(rule.breakPolicy.baseMinutes || 0);
  }

  return 0;
}

function netMinutesForShift(shiftKey) {
  const duration = shiftDurationMinutes(shiftKey);
  if (!duration) return 0;
  return Math.max(0, duration - appliedPauseMinutes(shiftKey));
}

/* ========= CALCULATIONS ========= */
function getResolvedEntryForEmployeeOnIso(emp, isoDate) {
  return getResolvedDayEntry({
    employee: emp,
    isoDate,
    schedule: state.schedule,
    absences: state.absences,
    stateKey: APP_META.stateKey
  });
}

function getResolvedLabelForEmployeeOnIso(emp, isoDate) {
  return getResolvedEntryForEmployeeOnIso(emp, isoDate).label;
}
function getBlockingTypeForEmployeeOnIso(emp, isoDate) {
  const resolved = getResolvedEntryForEmployeeOnIso(emp, isoDate);

  if (!resolved) return null;
  const status = getResolvedStatus(resolved);

  if (status === ENTRY_STATUS.VACATION) return ENTRY_STATUS.VACATION;
  if (status === ENTRY_STATUS.SICK) return ENTRY_STATUS.SICK;
  if (resolved.type === "holiday") return "holiday";

  return null;
}

function isEmployeeBlockedOnIso(emp, isoDate) {
  return Boolean(getBlockingTypeForEmployeeOnIso(emp, isoDate));
}

function isDayInYearMonth(day, yearMonth) {
  if (!day || typeof day.iso !== "string") return false;
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return true;
  return getYearMonthFromIsoDate(day.iso) === normalizedYearMonth;
}

function getDaysInYearMonth(days = [], yearMonth = state.activeMonth) {
  if (!Array.isArray(days)) return [];
  return days.filter((day) => isDayInYearMonth(day, yearMonth));
}

function totalMinutesForEmployeeInWeek(emp, weekDays) {
  return weekDays.reduce((sum, day) => {
    if (!day) return sum;
    return sum + getResolvedEntryForEmployeeOnIso(emp, day.iso).minutesForMonth;
  }, 0);
}

function totalMinutesForEmployee(emp) {
  return totalMinutesForEmployeeInWeek(emp, getActiveWeekDays());
}

function deltaMinutes(emp) {
  return totalMinutesForEmployee(emp) - hmToMinutes(emp.target || "0:00");
}

function isCreditableResolvedWorkEntry(resolvedEntry) {
  const status = getResolvedStatus(resolvedEntry);
  return status === ENTRY_STATUS.WORK || status === ENTRY_STATUS.EXTERNAL;
}

function isCreditableResolvedAccountEntry(resolvedEntry) {
  const status = getResolvedStatus(resolvedEntry);

  if (status === ENTRY_STATUS.WORK || status === ENTRY_STATUS.EXTERNAL || status === ENTRY_STATUS.SICK || status === ENTRY_STATUS.VACATION) {
    return true;
  }

  return resolvedEntry?.type === "holiday";
}

function getEmployeeTargetMinutes(employee) {
  if (!employee) return 0;
  return hmToMinutes(employee.target || "0:00");
}

function isGfbEmployee(employee) {
  if (!employee) return false;
  return String(employee.roleKey || "").trim().toUpperCase() === "GFB";
}

function getEmployeeContractTargetMinutesPerMonth(employee) {
  if (!employee) return 0;

  if (isGfbEmployee(employee)) {
    return 43 * 60;
  }

  const individualTargetMinutes = Number(employee.contractTargetMinutesPerMonth);
  if (Number.isFinite(individualTargetMinutes) && individualTargetMinutes > 0) {
    return Math.round(individualTargetMinutes);
  }

  const contractModelTargetMinutes = getContractModelTargetMinutesPerMonth(employee.contractModel || employee.roleKey || "");
  if (Number.isFinite(contractModelTargetMinutes) && contractModelTargetMinutes > 0) {
    return Math.round(contractModelTargetMinutes);
  }

  const weeklyTargetMinutes = getEmployeeTargetMinutes(employee);
  if (weeklyTargetMinutes > 0) {
    return Math.round((weeklyTargetMinutes * 52) / 12);
  }

  return 0;
}

function getEmployeePlannedMinutesForWeek(employee, weekDays = getActiveWeekDays()) {
  if (!employee || !Array.isArray(weekDays)) return 0;

  return weekDays.reduce((sum, day) => {
    if (!day) return sum;

    const resolved = getResolvedEntryForEmployeeOnIso(employee, day.iso);
    if (!isCreditableResolvedWorkEntry(resolved)) return sum;

    return sum + Math.max(0, resolved.minutesForMonth || 0);
  }, 0);
}

function getEmployeeBranchMinutesForWeek(employee, weekDays = getActiveWeekDays(), yearMonth = state.activeMonth) {
  if (!employee || !Array.isArray(weekDays)) return 0;

  const eligibleWeekDays = getDaysInYearMonth(weekDays, yearMonth);

  return eligibleWeekDays.reduce((sum, day) => {
    if (!day) return sum;

    const resolved = getResolvedEntryForEmployeeOnIso(employee, day.iso);
    return sum + Math.max(0, resolved.minutesForBranch || 0);
  }, 0);
}

function getEmployeeTargetMinutesForWeek(employee, weekDays = getActiveWeekDays(), yearMonth = state.activeMonth) {
  if (!employee || !Array.isArray(weekDays)) return 0;

  const dailyTargetMinutes = getAbsenceMinutesForEmployee(employee);
  const eligibleWeekDays = getDaysInYearMonth(weekDays, yearMonth);

  return eligibleWeekDays.reduce((sum, day) => {
    if (!day) return sum;
    if (isSundayIsoDate(day.iso)) return sum;
    return sum + dailyTargetMinutes;
  }, 0);
}

function getEmployeeAccountMinutesForWeek(employee, weekDays = getActiveWeekDays(), yearMonth = state.activeMonth) {
  if (!employee || !Array.isArray(weekDays)) return 0;

  const eligibleWeekDays = getDaysInYearMonth(weekDays, yearMonth);

  return eligibleWeekDays.reduce((sum, day) => {
    if (!day) return sum;

    const resolved = getResolvedEntryForEmployeeOnIso(employee, day.iso);
    const status = getResolvedStatus(resolved);

    if (!isCreditableResolvedAccountEntry(resolved)) {
      return sum;
    }

    if (status === ENTRY_STATUS.VACATION) {
      return sum + getAbsenceMinutesForEmployee(employee);
    }

    if (resolved?.type === "holiday") {
      return sum + Math.max(0, resolved.minutesForMonth || getAbsenceMinutesForEmployee(employee));
    }

    return sum + Math.max(0, resolved.minutesForMonth || 0);
  }, 0);
}

function getEmployeeWeekDifferenceMinutes(employee, weekDays = getActiveWeekDays(), yearMonth = state.activeMonth) {
  const accountMinutes = getEmployeeAccountMinutesForWeek(employee, weekDays, yearMonth);

  if (isGfbEmployee(employee)) {
    return Math.max(0, accountMinutes);
  }

  const targetMinutes = getEmployeeTargetMinutesForWeek(employee, weekDays, yearMonth);
  return accountMinutes - targetMinutes;
}

function getEmployeeMinusMinutesForWeek(employee, weekDays = getActiveWeekDays(), yearMonth = state.activeMonth) {
  const difference = getEmployeeWeekDifferenceMinutes(employee, weekDays, yearMonth);
  return difference < 0 ? Math.abs(difference) : 0;
}

function formatMinuteBalance(differenceMinutes) {
  if (differenceMinutes >= 0) return "0:00";
  return `-${minutesToHM(Math.abs(differenceMinutes))}`;
}


function getEmployeeContractTargetMinutesForDays(employee, days = []) {
  if (!employee || !Array.isArray(days)) return 0;

  const dailyTargetMinutes = getAbsenceMinutesForEmployee(employee);

  return days.reduce((sum, day) => {
    if (!day || day.isOutsideMonth) return sum;
    if (isSundayIsoDate(day.iso)) return sum;
    return sum + dailyTargetMinutes;
  }, 0);
}

function getEmployeeContractTargetMinutesForWeeks(employee, weeks = getCurrentMonthWeeks()) {
  if (!employee || !Array.isArray(weeks)) return 0;

  return getEmployeeContractTargetMinutesPerMonth(employee);
}

function getEmployeeAccountMinutesForWeeks(employee, weeks = getCurrentMonthWeeks(), yearMonth = state.activeMonth) {
  if (!employee || !Array.isArray(weeks)) return 0;

  return weeks.reduce((sum, week) => {
    if (!Array.isArray(week) || week.length === 0) return sum;
    return sum + getEmployeeAccountMinutesForWeek(employee, getDaysInYearMonth(week, yearMonth), yearMonth);
  }, 0);
}

function getEmployeeAccountMinutesForMonth(employee, yearMonth = state.activeMonth) {
  if (!employee) return 0;

  const monthWeeks = getWeeksForYearMonth(yearMonth);
  if (!monthWeeks.length) return 0;

  return getEmployeeAccountMinutesForWeeks(employee, monthWeeks, yearMonth);
}

function getWeeksForYearMonth(yearMonth) {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return [];

  return getMonthPlanFromYearMonth(normalized)?.weeks || [];
}

// Historische Saldo-Berechnung startet fachlich bewusst ab 2026-01.
const BALANCE_HISTORY_START_MONTH = "2026-01";

function getRelevantYearMonthsUntilActiveMonth(employee = null) {
  const activeYearMonth = normalizeYearMonth(state.activeMonth || "") || getYearMonthFromIsoDate(state.weekFrom || "") || getYearMonthFromIsoDate(toIsoDate(new Date()));
  if (!activeYearMonth) return [];

  if (typeof collectRelevantYearMonthsUntilActiveMonthBalance === "function") {
    return collectRelevantYearMonthsUntilActiveMonthBalance({
      activeYearMonth,
      scheduleIsoDates: Object.keys(state.schedule || {}),
      absences: state.absences || [],
      manualMonthActualMinutes: employee?.manualMonthActualMinutes || {},
      historyStartMonth: BALANCE_HISTORY_START_MONTH
    });
  }

  const candidates = [activeYearMonth];

  Object.keys(state.schedule || {}).forEach((isoDate) => {
    const yearMonth = getYearMonthFromIsoDate(isoDate);
    if (yearMonth && yearMonth >= BALANCE_HISTORY_START_MONTH && yearMonth <= activeYearMonth) candidates.push(yearMonth);
  });

  (state.absences || []).forEach((entry) => {
    const fromMonth = getYearMonthFromIsoDate(entry?.from || "");
    const toMonth = getYearMonthFromIsoDate(entry?.to || "");

    if (fromMonth && fromMonth >= BALANCE_HISTORY_START_MONTH && fromMonth <= activeYearMonth) candidates.push(fromMonth);
    if (toMonth && toMonth >= BALANCE_HISTORY_START_MONTH && toMonth <= activeYearMonth) candidates.push(toMonth);
  });

  if (employee?.manualMonthActualMinutes && typeof employee.manualMonthActualMinutes === "object") {
    Object.keys(employee.manualMonthActualMinutes).forEach((yearMonth) => {
      const normalized = normalizeYearMonth(yearMonth);
      if (normalized && normalized >= BALANCE_HISTORY_START_MONTH && normalized <= activeYearMonth) {
        candidates.push(normalized);
      }
    });
  }

  const unique = [...new Set(candidates)].sort();
  if (!unique.length) return [activeYearMonth];

  const firstDetectedMonth = unique[0];
  const first = firstDetectedMonth < BALANCE_HISTORY_START_MONTH
    ? BALANCE_HISTORY_START_MONTH
    : firstDetectedMonth;
  const months = [];
  let cursor = first;

  while (cursor && cursor <= activeYearMonth) {
    months.push(cursor);
    cursor = shiftYearMonthByMonths(cursor, 1);
  }

  return months;
}

function getEmployeeRunningBalanceMinutesUntilActiveMonth(employee) {
  if (!employee) return 0;

  return getRelevantYearMonthsUntilActiveMonth(employee).reduce((sum, yearMonth) => {
    const weeks = getWeeksForYearMonth(yearMonth);
    if (!weeks.length) return sum;

    const accountMinutes = getEmployeeActualMinutesForMonth(employee, yearMonth);
    const contractTargetMinutes = getEmployeeContractTargetMinutesPerMonth(employee);

    return sum + (accountMinutes - contractTargetMinutes);
  }, 0);
}

function getEmployeeTotalMinusMinutes(employee) {
  if (!employee) return 0;
  if (isGfbEmployee(employee)) return 0;

  const runningBalanceMinutes = getEmployeeRunningBalanceMinutesUntilActiveMonth(employee);
  return runningBalanceMinutes < 0 ? Math.abs(runningBalanceMinutes) : 0;
}

function getEmployeeMonthDifferenceMinutes(employee, yearMonth = state.activeMonth) {
  if (!employee) return 0;

  const monthWeeks = getWeeksForYearMonth(yearMonth);
  if (!monthWeeks.length) return 0;

  const accountMinutes = getEmployeeActualMinutesForMonth(employee, yearMonth);
  const contractTargetMinutes = getEmployeeContractTargetMinutesPerMonth(employee);

  if (isGfbEmployee(employee)) {
    return Math.max(0, accountMinutes);
  }

  return accountMinutes - contractTargetMinutes;
}

function getEmployeeMonthContingentRemainingMinutes(employee, yearMonth = state.activeMonth) {
  if (!employee) return 0;
  if (!isGfbEmployee(employee)) return 0;

  const accountMinutes = getEmployeeActualMinutesForMonth(employee, yearMonth);
  const contractTargetMinutes = getEmployeeContractTargetMinutesPerMonth(employee);
  return Math.max(0, contractTargetMinutes - accountMinutes);
}

function getEmployeeMonthContingentOveruseMinutes(employee, yearMonth = state.activeMonth) {
  if (!employee) return 0;
  if (!isGfbEmployee(employee)) return 0;

  const accountMinutes = getEmployeeActualMinutesForMonth(employee, yearMonth);
  const contractTargetMinutes = getEmployeeContractTargetMinutesPerMonth(employee);
  return Math.max(0, accountMinutes - contractTargetMinutes);
}

function getManualMonthActualMinutes(employee, yearMonth) {
  if (!employee) return null;
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return null;

  const minutes = employee.manualMonthActualMinutes?.[normalizedYearMonth];
  const numericMinutes = Number(minutes);
  if (!Number.isFinite(numericMinutes) || numericMinutes < 0) return null;
  return Math.round(numericMinutes);
}

function setManualMonthActualMinutes(employee, yearMonth, minutes) {
  if (!employee) return false;
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const numericMinutes = Number(minutes);
  if (!normalizedYearMonth || !Number.isFinite(numericMinutes) || numericMinutes < 0) return false;

  employee.manualMonthActualMinutes = normalizeManualMonthActualMinutes(employee.manualMonthActualMinutes);
  employee.manualMonthActualMinutes[normalizedYearMonth] = Math.round(numericMinutes);
  return true;
}

function removeManualMonthActualMinutes(employee, yearMonth) {
  if (!employee) return false;
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return false;
  if (!employee.manualMonthActualMinutes || typeof employee.manualMonthActualMinutes !== "object") {
    employee.manualMonthActualMinutes = {};
    return false;
  }

  const existed = Object.prototype.hasOwnProperty.call(employee.manualMonthActualMinutes, normalizedYearMonth);
  delete employee.manualMonthActualMinutes[normalizedYearMonth];
  return existed;
}

function isMonthActualManual(employee, yearMonth) {
  return getManualMonthActualMinutes(employee, yearMonth) !== null;
}

function getEffectiveMonthActualMinutes(employee, yearMonth = state.activeMonth, plannedMinutes = null) {
  const manualMinutes = getManualMonthActualMinutes(employee, yearMonth);
  if (manualMinutes !== null) return manualMinutes;

  if (Number.isFinite(plannedMinutes) && plannedMinutes >= 0) {
    return Math.round(plannedMinutes);
  }

  return getEmployeeAccountMinutesForMonth(employee, yearMonth);
}

// Public API (derzeit): getEmployeeActualMinutesForMonth.
// TODO (Folgesprint): auf eine einzige zentrale öffentliche Funktion reduzieren,
// damit kein Drift zwischen "effective" und "actual" Benennung entsteht.
function getEmployeeActualMinutesForMonth(employee, yearMonth = state.activeMonth) {
  const plannedMinutes = getEmployeeAccountMinutesForMonth(employee, yearMonth);
  return getEffectiveMonthActualMinutes(employee, yearMonth, plannedMinutes);
}

function parseManualHoursToMinutes(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatManualMonthRows(entries = []) {
  if (!manualMonthRowsEl) return;

  manualMonthRowsEl.innerHTML = "";

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.className = "manualMonthRow";

    const monthTd = document.createElement("td");
    monthTd.dataset.label = "Monat (YYYY-MM)";
    const monthInput = document.createElement("input");
    monthInput.type = "month";
    monthInput.className = "manualMonthInput";
    monthInput.value = normalizeYearMonth(entry?.yearMonth);
    monthInput.placeholder = "YYYY-MM";
    monthTd.appendChild(monthInput);

    const hoursTd = document.createElement("td");
    hoursTd.dataset.label = "Iststunden (HH:MM)";
    const hoursInput = document.createElement("input");
    hoursInput.type = "text";
    hoursInput.className = "manualMonthInput";
    hoursInput.placeholder = "HH:MM";
    hoursInput.value = typeof entry?.minutes === "number" ? minutesToHM(entry.minutes) : "";
    hoursTd.appendChild(hoursInput);

    const removeTd = document.createElement("td");
    removeTd.dataset.label = "Aktion";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "manualMonthRemoveBtn";
    removeButton.textContent = "Löschen";
    removeButton.addEventListener("click", () => {
      tr.remove();
      if (!manualMonthRowsEl.querySelector("tr")) {
        addManualMonthDialogRow();
      }
    });
    removeTd.appendChild(removeButton);

    tr.append(monthTd, hoursTd, removeTd);
    manualMonthRowsEl.appendChild(tr);
  });
}

function addManualMonthDialogRow(defaults = {}) {
  if (!manualMonthRowsEl) return;

  const currentRows = [...manualMonthRowsEl.querySelectorAll("tr.manualMonthRow")].map((tr) => ({
    yearMonth: tr.querySelector("td:nth-child(1) input")?.value || "",
    minutes: parseManualHoursToMinutes(tr.querySelector("td:nth-child(2) input")?.value || "")
  }));

  currentRows.push({
    yearMonth: normalizeYearMonth(defaults.yearMonth) || "",
    minutes: typeof defaults.minutes === "number" ? defaults.minutes : null
  });

  formatManualMonthRows(currentRows);
}

function closeManualMonthDialog() {
  if (!manualMonthDialogOverlayEl) return;
  manualMonthDialogOverlayEl.classList.add("hidden");
  manualMonthDialogOverlayEl.setAttribute("aria-hidden", "true");
  manualMonthDialogOverlayEl.dataset.employeeId = "";
  if (manualMonthBulkInputEl) manualMonthBulkInputEl.value = "";
  if (manualMonthValidationEl) manualMonthValidationEl.textContent = "";
  manualMonthDialogPreviousFocusEl?.focus?.();
  manualMonthDialogPreviousFocusEl = null;
}

function applyManualMonthBulkInput() {
  if (!manualMonthBulkInputEl || !manualMonthRowsEl) return;

  const parsed = parseManualMonthBulkInput(manualMonthBulkInputEl.value || "");
  if (parsed.lineErrors?.length) {
    if (manualMonthValidationEl) {
      manualMonthValidationEl.style.color = "";
      manualMonthValidationEl.textContent = parsed.lineErrors[0];
    }
    return;
  }

  const existing = collectAndValidateManualMonthDialogRows();
  if (existing.error) {
    if (manualMonthValidationEl) {
      manualMonthValidationEl.style.color = "";
      manualMonthValidationEl.textContent = existing.error;
    }
    return;
  }

  const merged = {
    ...(existing.value || {}),
    ...(parsed.values || {})
  };
  const entries = Object.entries(merged)
    .map(([yearMonth, minutes]) => ({ yearMonth, minutes }))
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  formatManualMonthRows(entries.length ? entries : [{ yearMonth: state.activeMonth, minutes: null }]);

  if (manualMonthValidationEl) {
    manualMonthValidationEl.style.color = "#1f6f3f";
    manualMonthValidationEl.textContent = Object.keys(parsed.values || {}).length
      ? `${Object.keys(parsed.values || {}).length} Monate aus Bulk-Paste übernommen.`
      : "Kein Bulk-Inhalt erkannt.";
  }
}

function collectAndValidateManualMonthDialogRows() {
  const rows = [...manualMonthRowsEl.querySelectorAll("tr.manualMonthRow")];
  const normalizedMap = {};

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const monthValue = row.querySelector("td:nth-child(1) input")?.value || "";
    const hoursValue = row.querySelector("td:nth-child(2) input")?.value || "";
    const isEmptyRow = !monthValue.trim() && !hoursValue.trim();
    if (isEmptyRow) continue;

    if (!Boolean(normalizeYearMonth(monthValue))) {
      return { error: `Zeile ${index + 1}: Monat muss YYYY-MM sein.` };
    }

    const minutes = parseManualHoursToMinutes(hoursValue);
    if (minutes === null || minutes < 0) {
      return { error: `Zeile ${index + 1}: Iststunden müssen im Format HH:MM (>= 0) sein.` };
    }

    normalizedMap[normalizeYearMonth(monthValue)] = minutes;
  }

  return { value: normalizedMap };
}

function saveManualMonthDialog() {
  if (!manualMonthDialogOverlayEl) return;

  const employeeId = manualMonthDialogOverlayEl.dataset.employeeId || "";
  const employee = state.employees.find((emp) => emp.id === employeeId);
  if (!employee) {
    closeManualMonthDialog();
    return;
  }

  const result = collectAndValidateManualMonthDialogRows();
  if (result.error) {
    if (manualMonthValidationEl) {
      manualMonthValidationEl.style.color = "";
      manualMonthValidationEl.textContent = result.error;
    }
    return;
  }

  const existingMonths = Object.keys(employee.manualMonthActualMinutes || {});
  existingMonths.forEach((yearMonth) => {
    removeManualMonthActualMinutes(employee, yearMonth);
  });

  Object.entries(result.value || {}).forEach(([yearMonth, minutes]) => setManualMonthActualMinutes(employee, yearMonth, minutes));

  saveAppStateDebounced();
  renderAllViews();
  renderTeamSetup();
  closeManualMonthDialog();
}

function openManualMonthDialog(employee) {
  if (!employee || !manualMonthDialogOverlayEl || !manualMonthRowsEl) return;

  manualMonthDialogOverlayEl.dataset.employeeId = employee.id || "";
  if (manualMonthDialogTitleEl) {
    manualMonthDialogTitleEl.textContent = `Monats-Iststunden für ${employee.name || "Mitarbeiter"}`;
  }
  if (manualMonthValidationEl) {
    manualMonthValidationEl.textContent = "";
    manualMonthValidationEl.style.color = "";
  }
  if (manualMonthBulkInputEl) manualMonthBulkInputEl.value = "";

  const entries = Object.entries(employee.manualMonthActualMinutes || {})
    .map(([yearMonth, minutes]) => ({
      yearMonth,
      minutes: Number(minutes)
    }))
    .filter((entry) => Boolean(normalizeYearMonth(entry.yearMonth)) && Number.isFinite(entry.minutes) && entry.minutes >= 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  formatManualMonthRows(entries.length ? entries : [{ yearMonth: state.activeMonth, minutes: null }]);
  const isHtmlEl = typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement;
  manualMonthDialogPreviousFocusEl = isHtmlEl ? document.activeElement : null;
  manualMonthDialogOverlayEl.classList.remove("hidden");
  manualMonthDialogOverlayEl.setAttribute("aria-hidden", "false");
  const firstInput = manualMonthRowsEl.querySelector("input");
  firstInput?.focus();
}

function totalMinutesForDayIso(iso) {
  return state.employees.reduce((sum, emp) => {
    const resolvedEntry = getResolvedEntryForEmployeeOnIso(emp, iso);
    const status = getResolvedStatus(resolvedEntry);
    if (status !== ENTRY_STATUS.WORK) return sum;
    return sum + (Number(resolvedEntry?.minutesForBranch) || 0);
  }, 0);
}

function getProductivityMinuteBucketsForResolvedEntry(resolvedEntry) {
  const status = getResolvedStatus(resolvedEntry);
  const minutes = Math.max(0, Number(resolvedEntry?.minutesForBranch) || 0);

  if (status === ENTRY_STATUS.WORK) {
    return {
      productivityRelevantMinutes: minutes,
      specialCaseMinutes: 0
    };
  }

  if (status === ENTRY_STATUS.EXTERNAL) {
    return {
      productivityRelevantMinutes: 0,
      specialCaseMinutes: minutes
    };
  }

  return {
    productivityRelevantMinutes: 0,
    specialCaseMinutes: 0
  };
}

function getProductivityMinuteBucketsForDayIso(iso) {
  return state.employees.reduce((acc, emp) => {
    const resolved = getResolvedEntryForEmployeeOnIso(emp, iso);
    const buckets = getProductivityMinuteBucketsForResolvedEntry(resolved);

    acc.productivityRelevantMinutes += buckets.productivityRelevantMinutes;
    acc.specialCaseMinutes += buckets.specialCaseMinutes;
    return acc;
  }, { productivityRelevantMinutes: 0, specialCaseMinutes: 0 });
}

function getWorkedMinutesForDayIso(iso) {
  return getProductivityMinuteBucketsForDayIso(iso).productivityRelevantMinutes;
}

function totalMinutesForWeek() {
  const week = getActiveWeekDays();
  return week.reduce((sum, day) => {
    if (!day) return sum;
    return sum + totalMinutesForDayIso(day.iso);
  }, 0);
}

function getWeekPlannerSummaryForDays(weekDays = []) {
  const usedMinutes = weekDays
    .slice(0, 6)
    .reduce((sum, day) => {
      if (!day) return sum;
      return sum + totalMinutesForDayIso(day.iso);
    }, 0);
  const targetMinutes = MAX_WEEKLY_MINUTES;

  return {
    usedMinutes,
    targetMinutes,
    differenceMinutes: usedMinutes - targetMinutes
  };
}

function getWeekSalesSummaryForDays(weekDays = []) {
  const calculationDays = (Array.isArray(weekDays) ? weekDays : []).slice(0, 6).filter(Boolean);
  const workedMinutes = calculationDays.reduce((sum, day) => sum + getWorkedMinutesForDayIso(day.iso), 0);
  const totalSales = calculationDays.reduce((sum, day) => {
    return sum + (Number(state.salesByDate?.[day.iso]) || 0);
  }, 0);
  const euroPerHour = workedMinutes > 0 ? totalSales / (workedMinutes / 60) : null;

  return {
    workedMinutes,
    totalSales,
    euroPerHour
  };
}

function formatEuroAmount(value) {
  const numericValue = Number(value) || 0;
  return `${numericValue.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })} €`;
}

function formatEuroPerHour(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} €/h`;
}

function getOverviewWeekPlannerCellText(resolved) {
  if (!resolved) return "";
  const status = getResolvedStatus(resolved);

  if (status === ENTRY_STATUS.WORK) {
    const entry = resolved.sourceEntry || resolved;
    if (entry.start && entry.end) {
      if (entry.mode === "flex") {
        return `${formatHMToQuarterLabel(entry.start)}-${formatHMToQuarterLabel(entry.end)}`;
      }
      return `${entry.start}-${entry.end}`;
    }
    return entry.code || resolved.label || "";
  }

  if (status === ENTRY_STATUS.EXTERNAL) {
    const externalHelpRenderer = typeof getExternalHelpCompactDisplay === "function"
      ? getExternalHelpCompactDisplay
      : null;
    return externalHelpRenderer ? externalHelpRenderer(resolved) : "AH";
  }

  if (status === ENTRY_STATUS.VACATION || status === ENTRY_STATUS.SICK) {
    return getStatusShortLabel(status);
  }

  return resolved.label || "";
}

function buildOverviewWeekPlannerTable(weekDays, employees) {
  const visibleDays = (Array.isArray(weekDays) ? weekDays : []).slice(0, 6).filter(Boolean);

  let html = `
    <table class="overviewPlannerTable">
      <thead>
        <tr>
          <th>Name</th>
  `;

  visibleDays.forEach((day) => {
    const classes = ["overviewPlannerDayHead"];
    if (day.isOutsideMonth) classes.push("overviewPlannerDayHeadOutside");
    html += `<th class="${classes.join(" ")}">${day.weekdayLabel}<br>${pad2(day.date.getDate())}.${pad2(day.date.getMonth() + 1)}</th>`;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  (employees || []).forEach((emp) => {
    html += `
      <tr>
        <td class="nameRoleCell">
          <div class="nameRoleName">${emp.name || "—"}</div>
          <div class="nameRoleSub">${emp.roleKey || "-"}</div>
        </td>
    `;

    visibleDays.forEach((day) => {
      const resolved = getResolvedEntryForEmployeeOnIso(emp, day.iso);
      const cellText = getOverviewWeekPlannerCellText(resolved);
      const cellClasses = [getMonthCellClass(resolved, day), "overviewPlannerDayCell"];
      if (day.isOutsideMonth) cellClasses.push("overviewPlannerDayCellOutside");
      html += `<td class="${cellClasses.join(" ")}">${cellText}</td>`;
    });

    html += `
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  return html;
}

function formatIsoDateForFileName(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateTimeForDisplay(isoString) {
  if (!isoString) return "-";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateBackupInfoLabel() {
  if (!backupInfoEl) return;

  const meta = loadJson(BACKUP_META_KEY, {});
  if (meta?.lastExportAt) {
    backupInfoEl.textContent = `Letzte Sicherung: ${formatDateTimeForDisplay(meta.lastExportAt)}`;
  } else {
    backupInfoEl.textContent = "";
  }
}

function collectFullBackupSnapshot() {
  const planData = loadJson(PLAN_KEY, defaultPlanState());
  if (planData && typeof planData === "object") {
    delete planData.salesByDate;
  }

  return {
    backupVersion: 1,
    app: {
      name: APP_META.name,
      version: APP_META.version
    },
    createdAt: new Date().toISOString(),
    storage: {
      [MASTER_KEY]: loadJson(MASTER_KEY, defaultMasterState()),
      [PLAN_KEY]: planData,
      [UI_KEY]: loadUiState(),
      ["wochenplan_dark"]: localStorage.getItem("wochenplan_dark"),
      [BACKUP_MEP_CALIBRATION_KEY]: loadJson(BACKUP_MEP_CALIBRATION_KEY, null)
    }
  };
}

function triggerBackupDownload(snapshot, filename = `wochenplan-backup-${formatIsoDateForFileName()}.json`) {
  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function collectPlanning2TransferSnapshot() {
  const planData = loadJson(PLAN_KEY, defaultPlanState());
  if (planData && typeof planData === "object") delete planData.salesByDate;

  return {
    format: "wochenplan-planning2-transfer",
    version: 1,
    createdAt: new Date().toISOString(),
    master: loadJson(MASTER_KEY, defaultMasterState()),
    plan: planData
  };
}

async function exportPlanning2Transfer() {
  try {
    flushPendingAutoSave();
    saveAppState();
    const snapshot = collectPlanning2TransferSnapshot();
    const filename = `wochenplan-planung-2-${formatIsoDateForFileName()}.json`;
    const file = typeof File === "function"
      ? new File([JSON.stringify(snapshot, null, 2)], filename, { type: "application/json" })
      : null;

    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "Planung-2-Testdaten",
        text: "Stammdaten und aktueller Plan für Planung 2",
        files: [file]
      });
      return;
    }

    triggerBackupDownload(snapshot, filename);
    alert("Planung-2-Testdaten wurden exportiert. Öffne Planung 2 und wähle dort „Testdaten übernehmen“.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    alert("Planung-2-Testdaten konnten nicht bereitgestellt werden.");
  }
}

function exportBackup() {
  try {
    saveAppState();

    const snapshot = collectFullBackupSnapshot();
    triggerBackupDownload(snapshot);

    saveJson(BACKUP_META_KEY, {
      lastExportAt: snapshot.createdAt
    });
    updateBackupInfoLabel();

    alert("Sicherung wurde exportiert.");
  } catch (_error) {
    alert("Sicherung konnte nicht exportiert werden.");
  }
}

function importBackupFromObject(backupData) {
  const validationResult = validateAndNormalizeBackupData(backupData);
  if (validationResult.error || !validationResult.backup) {
    throw new Error(validationResult.error || "Die Sicherungsdatei ist ungültig.");
  }

  const normalizedBackup = validationResult.backup;
  const storage = normalizedBackup.storage;
  const normalizedMaster = {
    ...defaultMasterState(),
    ...storage[MASTER_KEY],
    employees: (Array.isArray(storage[MASTER_KEY]?.employees)
      ? storage[MASTER_KEY].employees
      : []).map((employee, index) => normalizeEmployee(employee, index))
  };
  const normalizedPlanInput = {
    ...defaultPlanState(),
    ...storage[PLAN_KEY]
  };
  const normalizedPlanSchedule = normalizeSchedule(normalizedPlanInput.schedule || {});
  const { schedule: validatedSchedule } = validateNormalizedSchedule(normalizedPlanSchedule);
  const normalizedPlan = {
    ...normalizedPlanInput,
    schedule: validatedSchedule,
    absences: normalizeAbsences(normalizedPlanInput.absences || []),
    monthlyPlanBaselines: normalizeMonthlyPlanBaselines(normalizedPlanInput.monthlyPlanBaselines)
  };
  delete normalizedPlan.salesByDate;
  const normalizedUi = sanitizeUiState(storage[UI_KEY], defaultUiState);

  const preImportSnapshot = {
    savedAt: new Date().toISOString(),
    source: "pre-import",
    storage: {
      [MASTER_KEY]: loadJson(MASTER_KEY, defaultMasterState()),
      [PLAN_KEY]: (() => {
        const planData = loadJson(PLAN_KEY, defaultPlanState());
        if (planData && typeof planData === "object") {
          delete planData.salesByDate;
        }
        return planData;
      })(),
      [UI_KEY]: loadUiState(),
      ["wochenplan_dark"]: localStorage.getItem("wochenplan_dark"),
      [BACKUP_MEP_CALIBRATION_KEY]: loadJson(BACKUP_MEP_CALIBRATION_KEY, null)
    }
  };

  saveJson(BACKUP_INTERNAL_KEY, preImportSnapshot);
  saveJson(LAST_BACKUP_BEFORE_IMPORT_KEY, preImportSnapshot);

  const masterSaved = saveJson(MASTER_KEY, normalizedMaster);
  const planSaved = saveJson(PLAN_KEY, normalizedPlan);
  const uiSaved = saveJson(UI_KEY, normalizedUi);

  try {
    if (storage["wochenplan_dark"] === "true" || storage["wochenplan_dark"] === "false") {
      localStorage.setItem("wochenplan_dark", storage["wochenplan_dark"]);
    } else {
      localStorage.removeItem("wochenplan_dark");
    }

    if (storage[BACKUP_MEP_CALIBRATION_KEY] && typeof storage[BACKUP_MEP_CALIBRATION_KEY] === "object") {
      saveJson(BACKUP_MEP_CALIBRATION_KEY, storage[BACKUP_MEP_CALIBRATION_KEY]);
    } else {
      localStorage.removeItem(BACKUP_MEP_CALIBRATION_KEY);
    }
  } catch {
    // continue: core backup data is already restored as far as possible
  }

  if (!masterSaved || !planSaved || !uiSaved) {
    throw new Error("Die Sicherungsdaten konnten nicht vollständig gespeichert werden.");
  }

  saveJson(BACKUP_META_KEY, {
    lastExportAt: normalizedBackup.createdAt || new Date().toISOString(),
    lastImportAt: new Date().toISOString()
  });

  window.location.reload();
}

function handleBackupImportFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = typeof reader.result === "string" ? reader.result : "";
      const parsed = JSON.parse(text);

      importBackupFromObject(parsed);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Die Sicherungsdatei konnte nicht importiert werden.";
      alert(`Import fehlgeschlagen: ${message}`);
    }
  };

  reader.onerror = () => {
    alert("Die ausgewählte Datei konnte nicht gelesen werden.");
  };

  reader.readAsText(file);
}

/* ========= WARNINGS ========= */
function isClosingResolvedEntry(entry) {
  if (!entry || entry.type !== "shift") return false;
  return ["G1", "L1", "L2", "L3", "L4"].includes(entry.code);
}

function getClosingWorkersForIso(iso) {
  const yearMonth = String(iso || "").slice(0, 7);

  return state.employees.filter((emp) => {
    if (!isEmployeeActiveInMonth(emp, yearMonth)) return false;
    const entry = getScheduleEntry(emp.id, iso);
    return isClosingResolvedEntry(entry);
  });
}

function hasMissingCarryoverCoverageForIso(iso) {
  if (!iso || isSundayIsoDate(iso)) return false;

  const prevIso = getPreviousRelevantWorkdayIso(iso);
  if (!prevIso) return false;

  const yearMonth = String(iso).slice(0, 7);
  const previousDayClosers = state.employees.filter((emp) => {
    if (!isEmployeeActiveInMonth(emp, yearMonth)) return false;
    const previousEntry = getScheduleEntry(emp.id, prevIso);
    return previousEntry?.type === "shift" && previousEntry.end === "19:10";
  });

  if (previousDayClosers.length === 0) return false;

  return !previousDayClosers.some((emp) => {
    const currentEntry = getScheduleEntry(emp.id, iso);
    return isCarryoverMorningEligibleShift(currentEntry);
  });
}

function getDayWarningsByIndex(index) {
  const week = getActiveWeekDays();
  const day = week[index];
  if (!day) return [];

  const warnings = [];
  const closers = getClosingWorkersForIso(day.iso);

  if (closers.length > 2) {
    warnings.push(`⚠ ${day.weekdayLabel}: ${closers.length} Personen bis 19:10. Maximal 2 erlaubt.`);
  }

  if (hasMissingCarryoverCoverageForIso(day.iso)) {
    warnings.push(`⚠ ${day.weekdayLabel}: Keine Anschlussbesetzung aus dem vorherigen 19:10-Team.`);
  }

  return warnings;
}

function getWeekWarnings() {
  const week = getActiveWeekDays();
  return week.slice(0, 6).flatMap((_, index) => getDayWarningsByIndex(index));
}

/* ========= FORM / ORIGINAL HELPERS ========= */
function getFormPauseText(shiftKey) {
  switch (shiftKey) {
    case "G1":
      return "14:00-15:10";
    case "L1":
    case "L2":
      return "16:00-16:10";
    case "L3":
    case "L4":
      return "17:00-17:10";
    default:
      return "";
  }
}

function getFormDataForShift(shiftKey) {
  const shift = getShiftByKey(shiftKey);

  if (!shift.start || !shift.end) {
    return {
      start: "",
      end: "",
      pause: "",
      sum: ""
    };
  }

  return {
    start: shift.start,
    end: shift.end,
    pause: getFormPauseText(shiftKey),
    sum: minutesToHM(netMinutesForShift(shiftKey))
  };
}

/* ========= RENDER BASICS ========= */
function renderTeamSectionVisibility() {
  teamSectionEl.classList.toggle("hidden", !!uiState.teamCollapsed);
  btnToggleTeamEl.textContent = uiState.teamCollapsed ? "Team einblenden" : "Team ausblenden";
}

function isWeekViewActive() {
  return (uiState.currentView || "week") === "week";
}

function renderTopbarVisibility() {
  const isWeek = isWeekViewActive();
  const isMep = (uiState?.currentView || "week") === "mep";

  if (viewMetaLineEl) {
    viewMetaLineEl.classList.toggle("hidden", !isWeek);
  }

  if (btnResetWeekEl) {
    btnResetWeekEl.classList.toggle("hidden", !isWeek);
  }

  if (btnMepModeNormalEl) {
    btnMepModeNormalEl.classList.toggle("hidden", !isMep);
    btnMepModeNormalEl.classList.toggle("active", !uiState.mepAnonymized);
  }

  if (btnMepModeAnonymEl) {
    btnMepModeAnonymEl.classList.toggle("hidden", !isMep);
    btnMepModeAnonymEl.classList.toggle("active", !!uiState.mepAnonymized);
  }

  syncMobileMoreMenuState();
}

function closeMobileMoreMenu({ restoreFocus = false } = {}) {
  if (!btnMoreActionsEl || !mobileMoreMenuPanelEl) return;
  btnMoreActionsEl.setAttribute("aria-expanded", "false");
  mobileMoreMenuPanelEl.classList.add("hidden");
  if (restoreFocus && typeof btnMoreActionsEl.focus === "function") {
    btnMoreActionsEl.focus();
  }
}

function openMobileMoreMenu() {
  if (!btnMoreActionsEl || !mobileMoreMenuPanelEl) return;
  btnMoreActionsEl.setAttribute("aria-expanded", "true");
  mobileMoreMenuPanelEl.classList.remove("hidden");
  const firstVisibleAction = mobileMoreMenuPanelEl.querySelector("button:not(.hidden):not(:disabled)");
  firstVisibleAction?.focus();
}

function syncMobileMoreMenuState() {
  if (!mobileMoreMenuPanelEl) return;
  const menuItems = mobileMoreMenuPanelEl.querySelectorAll("[data-forward-target]");
  menuItems.forEach((item) => {
    const targetId = item.getAttribute("data-forward-target");
    if (!targetId) return;
    const targetButton = document.getElementById(targetId);
    const shouldHide = !targetButton || targetButton.classList.contains("hidden");
    item.classList.toggle("hidden", shouldHide);
    item.disabled = !!targetButton?.disabled;
  });
}

function renderView() {
  const view = uiState.currentView || "week";

  document.body.dataset.currentView = view;

  dayViewEl.classList.toggle("hidden", view !== "day");
  weekViewEl.classList.toggle("hidden", view !== "week");
  monthViewEl.classList.toggle("hidden", view !== "month");
  overviewViewEl.classList.toggle("hidden", view !== "overview");
  mepTemplateViewEl.classList.toggle("hidden", view !== "mep");

  btnViewDayEl.classList.toggle("active", view === "day");
  btnViewWeekEl.classList.toggle("active", view === "week");
  btnViewMonthEl.classList.toggle("active", view === "month");
  btnViewOverviewEl.classList.toggle("active", view === "overview");
  btnViewMepEl.classList.toggle("active", view === "mep");

  renderTopbarVisibility();
  updatePrintButtonLabel();
  requestActiveResponsiveViewRefresh();
}

function renderTeamSetup() {
  if (!teamListEl) return;

  teamListEl.innerHTML = "";

  state.employees.forEach((emp, idx) => {
    const row = document.createElement("div");
    row.className = "teamRow";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = `Mitarbeiter ${idx + 1}`;
    nameInput.value = emp.name;
    nameInput.addEventListener("change", () => {
      emp.name = nameInput.value;
      saveAppStateDebounced();
      renderAllViews();
    });

    const roleSel = document.createElement("select");
    ROLE_OPTIONS.forEach((role) => {
      const opt = document.createElement("option");
      opt.value = role.key;
      opt.textContent = role.label;
      roleSel.appendChild(opt);
    });
    roleSel.value = emp.roleKey;
    roleSel.addEventListener("change", () => {
      emp.roleKey = roleSel.value;
      emp.target = roleToTarget(emp.roleKey);
      emp.contractModel = roleToContractModel(emp.roleKey);
      saveAppStateDebounced();
      renderAllViews();
    });

    const targetInput = document.createElement("input");
    targetInput.type = "text";
    targetInput.placeholder = "Soll";
    targetInput.value = emp.target || "";
    targetInput.addEventListener("change", () => {
      emp.target = targetInput.value;
      saveAppStateDebounced();
      renderAllViews();
    });

    const vacationInput = document.createElement("input");
vacationInput.type = "number";
vacationInput.min = "0";
vacationInput.max = "36";
vacationInput.placeholder = "Urlaub";
vacationInput.value = Number(emp.totalVacationDays ?? emp.vacationDays ?? 30);

vacationInput.addEventListener("change", () => {
  const raw = Number(vacationInput.value || 0);
  const clamped = Math.max(0, Math.min(36, raw));

  emp.totalVacationDays = clamped;
  emp.vacationDays = clamped;
  emp.remainingVacationDays = clamped - Number(emp.usedVacationDays ?? 0);
  vacationInput.value = clamped;

  saveAppStateDebounced();
  renderAllViews();
});

    const usedVacationInfo = document.createElement("input");
    usedVacationInfo.type = "text";
    usedVacationInfo.value = String(Number(emp.usedVacationDays ?? 0));
    usedVacationInfo.title = "Genommene Urlaubstage (ohne Sonntage und Feiertage)";
    usedVacationInfo.readOnly = true;

    const remainingVacationInfo = document.createElement("input");
    remainingVacationInfo.type = "text";
    remainingVacationInfo.value = String(Number(emp.remainingVacationDays ?? 0));
    remainingVacationInfo.title = "Resturlaub";
    remainingVacationInfo.readOnly = true;
    

    const birthDateInput = document.createElement("input");
    birthDateInput.type = "date";
    birthDateInput.value = emp.birthDate || "";
    birthDateInput.addEventListener("change", () => {
      emp.birthDate = birthDateInput.value;
      saveAppStateDebounced();
      renderAllViews();
    });
    const serviceBonusInput = document.createElement("input");
serviceBonusInput.type = "checkbox";
serviceBonusInput.checked = Boolean(emp.serviceBonus);
serviceBonusInput.title = "10 Jahre Betriebszugehörigkeit";

serviceBonusInput.addEventListener("change", () => {
  emp.serviceBonus = serviceBonusInput.checked;
  saveAppStateDebounced();
  renderAllViews();
});

    const planning2FullDayInput = document.createElement("input");
    planning2FullDayInput.type = "checkbox";
    planning2FullDayInput.checked = emp.planning2FullDayCandidate === true;
    planning2FullDayInput.title = "Darf in Planung 2 für Ganztagsschichten vorgeschlagen werden";
    planning2FullDayInput.addEventListener("change", () => {
      emp.planning2FullDayCandidate = planning2FullDayInput.checked;
      saveAppStateDebounced();
      renderAllViews();
    });

    const planning2FullDayField = document.createElement("label");
    planning2FullDayField.className = "teamField teamCheckboxField";
    const planning2FullDayLabel = document.createElement("span");
    planning2FullDayLabel.className = "teamFieldLabel";
    planning2FullDayLabel.textContent = "Planung 2 Ganztag";
    planning2FullDayField.append(planning2FullDayLabel, planning2FullDayInput);

    const activeFromInput = document.createElement("input");
    activeFromInput.type = "month";
    activeFromInput.value = normalizeYearMonth(emp.activeFromMonth);
    activeFromInput.placeholder = "YYYY-MM";
    activeFromInput.title = "Ab diesem Monat im Plan sichtbar";
    activeFromInput.addEventListener("change", () => {
      emp.activeFromMonth = normalizeYearMonth(activeFromInput.value);

      if (emp.activeFromMonth && emp.activeToMonth && emp.activeToMonth < emp.activeFromMonth) {
        emp.activeToMonth = emp.activeFromMonth;
        activeToInput.value = emp.activeToMonth;
      }

      saveAppStateDebounced();
      renderAllViews();
    });

    const activeFromField = document.createElement("div");
    activeFromField.className = "teamField";
    const activeFromLabel = document.createElement("label");
    activeFromLabel.className = "teamFieldLabel";
    activeFromLabel.textContent = "Eintritt";
    activeFromField.append(activeFromLabel, activeFromInput);

    const activeToInput = document.createElement("input");
    activeToInput.type = "month";
    activeToInput.value = normalizeYearMonth(emp.activeToMonth);
    activeToInput.placeholder = "YYYY-MM";
    activeToInput.title = "Ab Folgemonat nicht mehr sichtbar";
    activeToInput.addEventListener("change", () => {
      emp.activeToMonth = normalizeYearMonth(activeToInput.value);

      if (emp.activeFromMonth && emp.activeToMonth && emp.activeToMonth < emp.activeFromMonth) {
        emp.activeFromMonth = emp.activeToMonth;
        activeFromInput.value = emp.activeFromMonth;
      }

      saveAppStateDebounced();
      renderAllViews();
    });

    const activeToField = document.createElement("div");
    activeToField.className = "teamField";
    const activeToLabel = document.createElement("label");
    activeToLabel.className = "teamFieldLabel";
    activeToLabel.textContent = "Austritt";
    activeToField.append(activeToLabel, activeToInput);
    const removeEmployeeButton = document.createElement("button");
    removeEmployeeButton.type = "button";
    removeEmployeeButton.textContent = "Mitarbeiter entfernen";
    removeEmployeeButton.title = "Mitarbeiter entfernen";
    removeEmployeeButton.addEventListener("click", () => {
      const employeeLabel = (emp.name || `Mitarbeiter ${idx + 1}`).trim();
      const shouldRemoveEmployee = confirm(`"${employeeLabel}" wirklich entfernen?`);
      if (!shouldRemoveEmployee) return;

      const shouldCleanupPlanData = confirm("Zugehörige Plan- und Absenzdaten ebenfalls löschen?\nOK = Ja, Abbrechen = Nein (nur Stammdaten entfernen)");
      removeEmployee(emp.id, { cleanupPlanData: shouldCleanupPlanData });
    });
    const manualMonthButton = document.createElement("button");
    manualMonthButton.type = "button";
    manualMonthButton.textContent = "Monats-Iststunden";
    manualMonthButton.title = "Monats-Iststunden";
    manualMonthButton.addEventListener("click", () => {
      openManualMonthDialog(emp);
    });

    row.appendChild(nameInput);
    row.appendChild(roleSel);
    row.appendChild(targetInput);
    row.appendChild(activeFromField);
    row.appendChild(activeToField);
    row.appendChild(vacationInput);
    row.appendChild(usedVacationInfo);
    row.appendChild(remainingVacationInfo);
    row.appendChild(birthDateInput);
    row.appendChild(serviceBonusInput);
    row.appendChild(planning2FullDayField);
    row.appendChild(manualMonthButton);
    row.appendChild(removeEmployeeButton);

    teamListEl.appendChild(row);
    });
}

btnManualMonthAddRowEl?.addEventListener("click", () => {
  if (manualMonthValidationEl) {
    manualMonthValidationEl.textContent = "";
    manualMonthValidationEl.style.color = "";
  }
  addManualMonthDialogRow();
});

btnManualMonthApplyBulkEl?.addEventListener("click", () => {
  if (manualMonthValidationEl) {
    manualMonthValidationEl.textContent = "";
    manualMonthValidationEl.style.color = "";
  }
  applyManualMonthBulkInput();
});

btnManualMonthCancelEl?.addEventListener("click", () => {
  closeManualMonthDialog();
});

btnManualMonthSaveEl?.addEventListener("click", () => {
  saveManualMonthDialog();
});

manualMonthDialogOverlayEl?.addEventListener("click", (event) => {
  if (event.target === manualMonthDialogOverlayEl) {
    closeManualMonthDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (manualMonthDialogOverlayEl?.classList.contains("hidden")) return;
  event.preventDefault();
  closeManualMonthDialog();
});

function getNextEmployeeId() {
  const maxEmployeeNumber = state.employees.reduce((maxValue, employee) => {
    const match = String(employee?.id || "").match(/^emp_(\d+)$/);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1]) || 0);
  }, 0);

  return `emp_${maxEmployeeNumber + 1}`;
}

function createEmptyEmployee() {
  return normalizeEmployee({
    id: getNextEmployeeId(),
    name: "",
    roleKey: "",
    target: "",
    contractModel: "",
    totalVacationDays: 30,
    usedVacationDays: 0,
    remainingVacationDays: 30,
    vacationDays: 30,
    birthDate: "",
    activeFromMonth: "",
    activeToMonth: "",
    serviceBonus: false,
    planning2FullDayCandidate: false
  }, state.employees.length);
}

function removeEmployee(employeeId, options = {}) {
  if (!employeeId) return;
  const { cleanupPlanData = true } = options;

  state.employees = (state.employees || []).filter((employee) => employee?.id !== employeeId);

  if (cleanupPlanData) {
    Object.keys(state.schedule || {}).forEach((isoDate) => {
      if (!state.schedule?.[isoDate]) return;
      delete state.schedule[isoDate][employeeId];
      if (!Object.keys(state.schedule[isoDate]).length) {
        delete state.schedule[isoDate];
      }
    });

    state.absences = (state.absences || []).filter((entry) => entry?.employeeId !== employeeId);
  }

  commitPlanChange();
  renderTeamSetup();
}
function renderSummary() {
  const weekDays = getActiveWeekDays();
  const weekSummary = getWeekPlannerSummaryForDays(weekDays);
  const differenceClass = getDeltaVisualState(weekSummary.differenceMinutes);

  weeklyHoursActualEl.textContent = minutesToHM(weekSummary.usedMinutes);
  weeklyHoursActualEl.className = differenceClass;
  weeklyHoursRemainingEl.textContent = minutesToHM(Math.abs(weekSummary.differenceMinutes));
  weeklyHoursRemainingEl.className = differenceClass;
  weeklyHoursStatusEl.textContent = weekSummary.differenceMinutes <= 0 ? "Noch frei" : "Überplant";

  if (mepWeekFromEl) mepWeekFromEl.textContent = state.weekFrom || "____________";
  if (mepWeekToEl) mepWeekToEl.textContent = state.weekTo || "____________";
  if (mepMonthYearEl) mepMonthYearEl.textContent = formatMonthYear(state.weekFrom);
}

function getDefaultOverviewSalesDateIso() {
  const activeMonthDays = getActiveMonthDays();
  return activeMonthDays[0]?.iso || state.weekFrom || toIsoDate(new Date());
}

function getSalesAmountInputValue() {
  const rawValue = String(overviewSalesAmountEl?.value || "").trim().replace(",", ".");
  const numericValue = Number(rawValue);
  if (!rawValue || !Number.isFinite(numericValue) || numericValue < 0) return null;
  return Math.round(numericValue * 100) / 100;
}

function getOverviewRevenueWeeks() {
  const monthWeeks = getCurrentMonthWeeks();
  return monthWeeks
    .map((weekDays, index) => {
      const days = weekDays.slice(0, 6).filter((day) => day?.inCurrentMonth && normalizeIsoDate(day?.iso));
      if (!days.length) return null;

      const startIso = days[0].iso;
      const endIso = days[days.length - 1].iso;
      return {
        key: startIso,
        days,
        label: `Abschnitt ${index + 1} · ${formatIsoDateForOverview(startIso).slice(0, 5)}–${formatIsoDateForOverview(endIso).slice(0, 5)}`
      };
    })
    .filter(Boolean);
}

function buildOverviewRevenueSnapshot(isoDate, salesAmount) {
  const normalizedIso = normalizeIsoDate(isoDate);
  const numericValue = Number(salesAmount);
  if (!normalizedIso || !Number.isFinite(numericValue) || numericValue < 0) return "";
  return `${normalizedIso}|${numericValue.toFixed(2)}`;
}

function getOverviewRevenuePersistedSnapshot(isoDate) {
  const normalizedIso = normalizeIsoDate(isoDate);
  if (!normalizedIso) return "";
  const persistedValue = Number(state.salesByDate?.[normalizedIso]);
  if (!Number.isFinite(persistedValue) || persistedValue < 0) return "";
  return buildOverviewRevenueSnapshot(normalizedIso, persistedValue);
}

function clearOverviewRevenueSaveStatusTimer() {
  if (!overviewRevenueSaveStatusTimerId) return;
  clearTimeout(overviewRevenueSaveStatusTimerId);
  overviewRevenueSaveStatusTimerId = null;
}

function setOverviewRevenueSaveStatus(status, options = {}) {
  if (!overviewSalesSaveStatusEl) return;
  const { persist = false } = options;

  clearOverviewRevenueSaveStatusTimer();
  overviewSalesSaveStatusEl.classList.remove("isSaving", "isSuccess", "isError");

  if (status === "saving") {
    overviewSalesSaveStatusEl.textContent = "Speichert …";
    overviewSalesSaveStatusEl.classList.add("isSaving");
    return;
  }

  if (status === "success") {
    overviewSalesSaveStatusEl.textContent = "Gespeichert";
    overviewSalesSaveStatusEl.classList.add("isSuccess");
    if (!persist) {
      overviewRevenueSaveStatusTimerId = setTimeout(() => {
        overviewSalesSaveStatusEl.textContent = "";
        overviewSalesSaveStatusEl.classList.remove("isSuccess");
      }, 1400);
    }
    return;
  }

  if (status === "error") {
    overviewSalesSaveStatusEl.textContent = "Speichern fehlgeschlagen";
    overviewSalesSaveStatusEl.classList.add("isError");
    if (!persist) {
      overviewRevenueSaveStatusTimerId = setTimeout(() => {
        overviewSalesSaveStatusEl.textContent = "";
        overviewSalesSaveStatusEl.classList.remove("isError");
      }, 2200);
    }
    return;
  }

  if (status === "unchanged") {
    overviewSalesSaveStatusEl.textContent = "Keine Änderung";
    if (!persist) {
      overviewRevenueSaveStatusTimerId = setTimeout(() => {
        overviewSalesSaveStatusEl.textContent = "";
      }, 1200);
    }
    return;
  }

  if (status === "deleted") {
    overviewSalesSaveStatusEl.textContent = "Gelöscht";
    overviewSalesSaveStatusEl.classList.add("isSuccess");
    if (!persist) {
      overviewRevenueSaveStatusTimerId = setTimeout(() => {
        overviewSalesSaveStatusEl.textContent = "";
        overviewSalesSaveStatusEl.classList.remove("isSuccess");
      }, 1400);
    }
    return;
  }

  if (status === "idle") {
    overviewSalesSaveStatusEl.textContent = "";
    return;
  }

  overviewSalesSaveStatusEl.textContent = "";
}

function clearOverviewRevenueDebounceTimer() {
  if (!overviewRevenueDebounceTimerId) return;
  clearTimeout(overviewRevenueDebounceTimerId);
  overviewRevenueDebounceTimerId = null;
}

function syncOverviewRevenueWeekUi(selectedIso) {
  if (!overviewSalesWeekSelectEl || !overviewSalesDayChipListEl) return;
  const weekEntries = getOverviewRevenueWeeks();
  if (!weekEntries.length) {
    overviewSalesWeekSelectEl.innerHTML = "";
    overviewSalesDayChipListEl.innerHTML = "";
    return;
  }

  const matchingWeek = weekEntries.find((entry) => entry.days.some((day) => day.iso === selectedIso)) || weekEntries[0];
  overviewSalesWeekSelectEl.innerHTML = weekEntries
    .map((entry) => `<option value="${entry.key}"${entry.key === matchingWeek.key ? " selected" : ""}>${entry.label}</option>`)
    .join("");

  const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  overviewSalesDayChipListEl.innerHTML = matchingWeek.days
    .map((day, dayIndex) => {
      const dayLabel = `${weekdayLabels[dayIndex] || "Tag"} ${formatIsoDateForOverview(day.iso).slice(0, 5)}`;
      const activeClass = day.iso === selectedIso ? " isActive" : "";
      return `<button type="button" class="revenue-day-chip${activeClass}" data-overview-sales-day="${day.iso}">${dayLabel}</button>`;
    })
    .join("");
}

function readOverviewRevenueEditorState() {
  const selectedIso = normalizeIsoDate(overviewSalesDateEl?.value || "");
  const salesAmount = getSalesAmountInputValue();
  return {
    selectedIso,
    salesAmount,
    hasValidDate: Boolean(selectedIso),
    hasValidAmount: Number.isFinite(salesAmount)
  };
}

function saveOverviewRevenueDraftForIso(targetIso, options = {}) {
  const { source = "manual", showValidationErrors = false } = options;
  const normalizedIso = normalizeIsoDate(targetIso);
  const salesAmount = getSalesAmountInputValue();

  if (!normalizedIso) {
    if (showValidationErrors) setOverviewRevenueSaveStatus("error");
    return false;
  }

  if (!Number.isFinite(salesAmount)) {
    if (showValidationErrors) setOverviewRevenueSaveStatus("error");
    return false;
  }

  const targetSnapshot = buildOverviewRevenueSnapshot(normalizedIso, salesAmount);
  const persistedSnapshot = getOverviewRevenuePersistedSnapshot(normalizedIso);

  if (!targetSnapshot || targetSnapshot === persistedSnapshot) {
    if (source === "manual") setOverviewRevenueSaveStatus("unchanged");
    return false;
  }

  setOverviewRevenueSaveStatus("saving");
  try {
    state.salesByDate[normalizedIso] = salesAmount;
    commitPlanChange();
    setOverviewRevenueSaveStatus("success");
    return true;
  } catch {
    setOverviewRevenueSaveStatus("error");
    return false;
  }
}

function maybeSaveOverviewRevenueBeforeDateSwitch() {
  const sourceIso = normalizeIsoDate(lastOverviewRevenueEditorDateIso || overviewSalesDateEl?.value || "");
  if (!sourceIso) return false;
  return saveOverviewRevenueDraftForIso(sourceIso, { source: "switch", showValidationErrors: false });
}

function saveOverviewRevenueFromEditor(options = {}) {
  const { source = "manual", showValidationErrors = false } = options;
  const isAutoSaveSource = source === "blur" || source === "debounce";
  if (isAutoSaveSource && uiState?.currentView !== "overview") return false;
  const { selectedIso, hasValidDate, hasValidAmount } = readOverviewRevenueEditorState();

  clearOverviewRevenueDebounceTimer();

  if (!hasValidDate) {
    if (showValidationErrors) setOverviewRevenueSaveStatus("error");
    return false;
  }

  if (!hasValidAmount) {
    if (showValidationErrors) setOverviewRevenueSaveStatus("error");
    return false;
  }

  return saveOverviewRevenueDraftForIso(selectedIso, { source, showValidationErrors });
}

function queueOverviewRevenueAutoSave(delayMs = 800) {
  clearOverviewRevenueDebounceTimer();
  overviewRevenueDebounceTimerId = setTimeout(() => {
    saveOverviewRevenueFromEditor({ source: "debounce", showValidationErrors: false });
  }, delayMs);
}

function renderOverviewSalesEditor() {
  if (!overviewSalesDateEl || !overviewSalesAmountEl) return;

  const normalizedIso = normalizeIsoDate(overviewSalesDateEl.value);
  const selectedIso = normalizedIso || getDefaultOverviewSalesDateIso();
  overviewSalesDateEl.value = selectedIso;

  const existingValue = Number(state.salesByDate?.[selectedIso]);
  overviewSalesAmountEl.value = Number.isFinite(existingValue) ? String(existingValue) : "";
  lastOverviewRevenueEditorDateIso = selectedIso;
  syncOverviewRevenueWeekUi(selectedIso);
  setOverviewRevenueSaveStatus("idle");
}

function renderOverviewView() {
  const overviewMonthContentEl = document.getElementById("overviewMonthContent");
  if (!overviewMonthContentEl) return;

  const overviewMonthTitleEl = document.getElementById("overviewMonthTitle");
  const activeMonthDays = getActiveMonthDays();
  renderOverviewSalesEditor();
  if (overviewMonthTitleEl) {
    overviewMonthTitleEl.textContent = activeMonthDays.length ? getMonthTitleFromDays(activeMonthDays) : "Monatsübersicht";
  }

  const monthWeeks = getCurrentMonthWeeks();
  if (!monthWeeks.length || typeof buildMonthViewMarkup !== "function") {
    overviewMonthContentEl.innerHTML = "<div class='small'>Kein Monat geladen.</div>";
    return;
  }

  const activeEmployees = state.employees.filter((emp) => isEmployeeActiveInMonth(emp, state.activeMonth));

  const weekBlocksHtml = monthWeeks
    .map((weekDays, index) => {
      const weekDaysInMonth = weekDays.filter((day) => day?.inCurrentMonth);
      if (!weekDaysInMonth.length) return "";

      const weekSummary = getWeekPlannerSummaryForDays(weekDays);
      const calculationDays = weekDays.slice(0, 6).filter(Boolean);
      const rangeStartIso = calculationDays[0]?.iso || "";
      const rangeEndIso = calculationDays[calculationDays.length - 1]?.iso || "";
      const weekRangeText = (rangeStartIso && rangeEndIso)
        ? `${formatIsoDateForOverview(rangeStartIso)} bis ${formatIsoDateForOverview(rangeEndIso)}`
        : "—";
      const differenceClass = getDeltaVisualState(weekSummary.differenceMinutes);
      const differenceLabel = weekSummary.differenceMinutes >= 0
        ? `Über ${formatSignedMinutes(weekSummary.differenceMinutes).replace("+", "")}`
        : `Rest ${minutesToHM(Math.abs(weekSummary.differenceMinutes))}`;
      const weekTableMarkup = buildOverviewWeekPlannerTable(weekDays, activeEmployees);
      const weekSalesSummary = getWeekSalesSummaryForDays(weekDays);

      return `
        <section class="overviewWeekSection">
          <div class="overviewWeekInfo week-summary-grid">
            <div class="overviewWeekCard summary-card summary-card--muted">
              <div class="miniLabel">Woche vom / bis</div>
              <strong>${weekRangeText}</strong>
            </div>
            <div class="overviewWeekCard summary-card summary-card--primary">
              <div class="miniLabel">Genutzte Wochenstunden</div>
              <strong class="${differenceClass}">${minutesToHM(weekSummary.usedMinutes)}</strong>
            </div>
            <div class="overviewWeekCard summary-card summary-card--muted">
              <div class="miniLabel">Sollstunden</div>
              <strong>${minutesToHM(weekSummary.targetMinutes)}</strong>
            </div>
            <div class="overviewWeekCard summary-card summary-card--success">
              <div class="miniLabel">Rest / Über</div>
              <strong class="${differenceClass}">${differenceLabel}</strong>
            </div>
          </div>
          <div class="overviewInternalMetrics internalOnly" aria-label="Interne Wochenkennzahl">
            <div class="overviewInternalMetricsItem">
              <span class="miniLabel">Umsatz</span>
              <strong>${formatEuroAmount(weekSalesSummary.totalSales)}</strong>
            </div>
            <div class="overviewInternalMetricsItem">
              <span class="miniLabel">Stunden</span>
              <strong>${minutesToHM(weekSalesSummary.workedMinutes)}</strong>
            </div>
            <div class="overviewInternalMetricsItem">
              <span class="miniLabel">€/h</span>
              <strong>${formatEuroPerHour(weekSalesSummary.euroPerHour)}</strong>
            </div>
          </div>
          <div class="overviewWeekTableWrap">
            ${weekTableMarkup}
          </div>
        </section>
      `;
    })
    .join("");

  overviewMonthContentEl.innerHTML = weekBlocksHtml || "<div class='small'>Kein Monat geladen.</div>";
}

function formatIsoDateForOverview(isoDate) {
  const date = fromIsoDate(isoDate);
  if (!date) return isoDate || "—";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function renderAllViews() {
  if (!isReconcilingMepEarlyStartForActiveMonth) {
    isReconcilingMepEarlyStartForActiveMonth = true;
    const reconciliation = reconcileMepEarlyStartForActiveMonth({ commit: false });
    isReconcilingMepEarlyStartForActiveMonth = false;
    if (reconciliation.changed) {
      refreshEmployeeVacationCounters();
      saveAppStateDebounced();
    }
  }

  renderSummary();

  if (typeof renderDayView === "function") renderDayView();
  if (typeof renderWeekView === "function") renderWeekView();
  if (typeof renderMonthView === "function") renderMonthView();
  renderOverviewView();
  if (typeof renderMepTemplateView === "function") renderMepTemplateView();
}

function renderAll() {
  syncMonthPlanToState();
  syncWeekRangeFromActiveWeek();
  renderTeamSectionVisibility();
  renderView();
  renderTeamSetup();
  renderAllViews();
  updateResponsiveViewportMetrics();
}

function showStartupFailureMessage(error) {
  const message = error?.message || "Unbekannter Startfehler";
  const fallbackText = `⚠️ App-Start fehlgeschlagen. Bitte Seite neu laden. Details: ${message}`;
  const fallbackId = "startupFailureBanner";
  let banner = document.getElementById(fallbackId);

  if (!banner) {
    banner = document.createElement("div");
    banner.id = fallbackId;
    banner.setAttribute("role", "alert");
    banner.style.cssText = "margin:8px;padding:10px;border-radius:8px;background:#b00020;color:#fff;font-weight:600;white-space:pre-wrap;";
    document.body?.prepend(banner);
  }

  banner.textContent = fallbackText;
}

function bootstrapApp() {
  window.__APP_BOOT_OK__ = false;

  try {
    updateResponsiveViewportMetrics();

    if (!state.weekFrom) {
      const today = new Date();
      state.weekFrom = toIsoDate(today);
    }

    if (!state.activeMonth) {
      state.activeMonth = (state.weekFrom || toIsoDate(new Date())).slice(0, 7);
    }

    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem("wochenplan_dark");
    } catch {
      savedTheme = null;
    }

    if (savedTheme === "true") {
      document.body.classList.add("dark");
    } else if (savedTheme === "false") {
      document.body.classList.remove("dark");
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.body.classList.add("dark");
    }

    updateDarkModeButton();
    updateBackupInfoLabel();
    refreshSaveStatusLabel();

    if (typeof bindMonthNavigation === "function") {
      bindMonthNavigation();
    }

    if (typeof bindMepMonthNavigation === "function") {
      bindMepMonthNavigation();
    }

    syncVacationScheduleFromAbsences();
    refreshEmployeeVacationCounters();
    syncMonthPlanToState();
    syncWeekRangeFromActiveWeek();

    renderAll();
    window.__APP_BOOT_OK__ = true;
    console.info("startup: render-complete");
  } catch (err) {
    console.error("startup-failed", err);
    showStartupFailureMessage(err);

    if (isMobileDebugPanelEnabled()) {
      showMobileRuntimeError({
        message: err?.message || "Startup fehlgeschlagen",
        file: "bootstrapApp",
        line: "-"
      }, { force: true });
    }
  }
}

/* ========= EVENTS ========= */
console.info("startup: begin");

const btnCloseMobileErrorPanelEl = document.getElementById("btnCloseMobileErrorPanel");
btnCloseMobileErrorPanelEl?.addEventListener("click", () => {
  document.getElementById("mobileErrorPanel")?.classList.add("hidden");
});

if (btnPrevWeekEl) {
  btnPrevWeekEl.addEventListener("click", () => {
    shiftActiveWeek(-7);
  });
}

if (btnNextWeekEl) {
  btnNextWeekEl.addEventListener("click", () => {
    shiftActiveWeek(7);
  });
}

if (btnCurrentWeekEl) {
  btnCurrentWeekEl.addEventListener("click", () => {
    const today = new Date();
    state.weekFrom = toIsoDate(today);
    state.activeMonth = state.weekFrom.slice(0, 7);

    syncMonthPlanToState();
    syncWeekRangeFromActiveWeek();
    commitPlanChange();
  });
}
if (weekFromEl) {
  weekFromEl.addEventListener("change", () => {
    state.weekFrom = weekFromEl.value;
    syncMonthPlanToState();
    syncWeekRangeFromActiveWeek();
    saveAppStateDebounced();
    renderAllViews();
  });
}

if (weekToEl) {
  weekToEl.addEventListener("change", () => {
    state.weekTo = weekToEl.value;
    saveAppStateDebounced();
    renderAllViews();
  });
}

if (btnToggleTeamEl) {
  btnToggleTeamEl.addEventListener("click", () => {
    uiState.teamCollapsed = !uiState.teamCollapsed;
    saveAppStateDebounced();
    renderTeamSectionVisibility();
  });
}

if (btnAddEmployeeEl) {
  btnAddEmployeeEl.addEventListener("click", () => {
    state.employees.push(createEmptyEmployee());
    saveAppStateDebounced();
    renderTeamSetup();
    renderAllViews();
  });
}

if (btnViewDayEl) {
  btnViewDayEl.addEventListener("click", () => {
    uiState.currentView = "day";
    saveAppStateDebounced();
    renderView();
    renderAllViews();
  });
}

if (btnViewMonthEl) {
  btnViewMonthEl.addEventListener("click", () => {
    uiState.currentView = "month";
    saveAppStateDebounced();
    renderView();
    renderAllViews();
  });
}

if (btnViewWeekEl) {
  btnViewWeekEl.addEventListener("click", () => {
    uiState.currentView = "week";
    saveAppStateDebounced();
    renderView();
    renderAllViews();
  });
}

if (btnViewOverviewEl) {
  btnViewOverviewEl.addEventListener("click", () => {
    uiState.currentView = "overview";
    saveAppStateDebounced();
    renderView();
    renderAllViews();
  });
}

if (btnViewMepEl) {
  btnViewMepEl.addEventListener("click", () => {
    uiState.currentView = "mep";
    saveAppStateDebounced();
    renderView();
    renderAllViews();
  });
}

overviewSalesDateEl?.addEventListener("change", () => {
  clearOverviewRevenueDebounceTimer();
  maybeSaveOverviewRevenueBeforeDateSwitch();
  renderOverviewSalesEditor();
});

overviewSalesWeekSelectEl?.addEventListener("change", () => {
  const weekStartIso = normalizeIsoDate(overviewSalesWeekSelectEl.value);
  if (!weekStartIso || !overviewSalesDateEl) return;
  maybeSaveOverviewRevenueBeforeDateSwitch();

  const matchingWeek = getOverviewRevenueWeeks().find((entry) => entry.key === weekStartIso);
  const nextIso = matchingWeek?.days[0]?.iso || weekStartIso;
  overviewSalesDateEl.value = nextIso;
  renderOverviewSalesEditor();
});

overviewSalesDayChipListEl?.addEventListener("click", (event) => {
  const trigger = event.target?.closest?.("[data-overview-sales-day]");
  const selectedIso = normalizeIsoDate(trigger?.dataset?.overviewSalesDay || "");
  if (!selectedIso || !overviewSalesDateEl) return;
  maybeSaveOverviewRevenueBeforeDateSwitch();
  overviewSalesDateEl.value = selectedIso;
  renderOverviewSalesEditor();
});

overviewSalesDateEl?.addEventListener("blur", () => {
  saveOverviewRevenueFromEditor({ source: "blur", showValidationErrors: false });
});

overviewSalesAmountEl?.addEventListener("blur", () => {
  saveOverviewRevenueFromEditor({ source: "blur", showValidationErrors: false });
});

overviewSalesAmountEl?.addEventListener("input", () => {
  if (uiState?.currentView !== "overview") return;
  queueOverviewRevenueAutoSave(800);
});

btnOverviewSalesSaveEl?.addEventListener("click", () => {
  saveOverviewRevenueFromEditor({ source: "manual", showValidationErrors: true });
});

btnOverviewSalesDeleteEl?.addEventListener("click", () => {
  const selectedIso = normalizeIsoDate(overviewSalesDateEl?.value || "");
  if (!selectedIso) {
    setOverviewRevenueSaveStatus("error");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(state.salesByDate || {}, selectedIso)) {
    overviewSalesAmountEl.value = "";
    setOverviewRevenueSaveStatus("idle");
    return;
  }

  clearOverviewRevenueDebounceTimer();
  delete state.salesByDate[selectedIso];
  commitPlanChange();
  renderOverviewSalesEditor();
  setOverviewRevenueSaveStatus("deleted");
});

btnMepModeNormalEl?.addEventListener("click", () => {
  if (!uiState.mepAnonymized) return;
  uiState.mepAnonymized = false;
  saveAppStateDebounced();
  renderTopbarVisibility();
  renderMepTemplateView({ scope: "month" });
});

btnMepModeAnonymEl?.addEventListener("click", () => {
  if (uiState.mepAnonymized) return;
  uiState.mepAnonymized = true;
  saveAppStateDebounced();
  renderTopbarVisibility();
  renderMepTemplateView({ scope: "month" });
});

document.getElementById("btnSaveMaster")?.addEventListener("click", () => {
  const ok = saveAppState();
  alert(ok ? "Stammdaten gespeichert." : "Speichern fehlgeschlagen.");
});
document.getElementById("btnResetWeek")?.addEventListener("click", () => {
  const weekDays = getActiveWeekDays();
  if (!weekDays.length) return;

  if (!confirm("Aktuell ausgewählte Woche leeren? Stammdaten bleiben erhalten.")) return;

  const weekIsos = weekDays.map((day) => day.iso);
  const weekStart = weekIsos[0];
  const weekEnd = weekIsos[weekIsos.length - 1];

  weekIsos.forEach((isoDate) => {
    delete state.schedule[isoDate];
  });

  state.absences = (state.absences || []).flatMap((entry) => {
    if (!entry) return [];

    const hasOverlap = !(entry.to < weekStart || entry.from > weekEnd);
    if (!hasOverlap) return [entry];

    return subtractRangeFromAbsenceEntry(entry, weekStart, weekEnd);
  });

  commitPlanChange();
  renderAll();
});
async function printCurrentView() {
  window.print();
}

btnPrintEl?.addEventListener("click", async () => {
  const currentView = uiState?.currentView || "week";
  if (currentView === "mep") {
    await exportMepTemplatePdf();
    return;
  }
  if (currentView === "overview") {
    await exportOverviewPdf();
    return;
  }

  await printCurrentView();
});

btnOverviewUploadEl?.addEventListener("click", async () => {
  await uploadOverviewPdf();
});

btnExportBackupEl?.addEventListener("click", () => {
  exportBackup();
});

btnExportPlanning2El?.addEventListener("click", async () => {
  await exportPlanning2Transfer();
});

btnImportBackupEl?.addEventListener("click", () => {
  if (!backupFileInputEl) return;

  flushPendingAutoSave();
  saveAppState();

  if (!confirm("Der aktuelle Stand wird überschrieben. Import jetzt durchführen?")) {
    return;
  }

  backupFileInputEl.value = "";
  backupFileInputEl.click();
});

backupFileInputEl?.addEventListener("change", () => {
  const file = backupFileInputEl.files?.[0];
  if (!file) return;

  handleBackupImportFile(file);
});


/* ========= DARK MODE ========= */

const btnDarkMode = document.getElementById("btnDarkMode");

function updateDarkModeButton() {
  if (!btnDarkMode) return;
  btnDarkMode.textContent = document.body.classList.contains("dark") ? "☀️" : "🌙";
}

btnDarkMode?.addEventListener("click", () => {
  document.body.classList.toggle("dark");

  try {
    localStorage.setItem(
      "wochenplan_dark",
      document.body.classList.contains("dark")
    );
  } catch {
    updateSaveStatus("Theme konnte nicht gespeichert werden", { isError: true, hideAfterMs: 3000 });
  }

  updateDarkModeButton();
});

btnMoreActionsEl?.addEventListener("click", () => {
  if (!mobileMoreMenuPanelEl) return;
  const isOpen = btnMoreActionsEl.getAttribute("aria-expanded") === "true";
  if (isOpen) {
    closeMobileMoreMenu();
    return;
  }
  syncMobileMoreMenuState();
  openMobileMoreMenu();
});

mobileMoreMenuPanelEl?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const triggerButton = event.target.closest("[data-forward-target]");
  if (!triggerButton) return;
  const targetId = triggerButton.getAttribute("data-forward-target");
  if (!targetId) return;
  const targetButton = document.getElementById(targetId);
  closeMobileMoreMenu({ restoreFocus: true });
  targetButton?.click();
});

document.addEventListener("click", (event) => {
  if (!btnMoreActionsEl || !mobileMoreMenuPanelEl) return;
  const clickTarget = event.target;
  if (!(clickTarget instanceof Node)) return;
  const clickedInsideMenu = mobileMoreMenuPanelEl.contains(clickTarget) || btnMoreActionsEl.contains(clickTarget);
  if (!clickedInsideMenu) {
    closeMobileMoreMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (!btnMoreActionsEl || !mobileMoreMenuPanelEl) return;
  const isMenuOpen = btnMoreActionsEl.getAttribute("aria-expanded") === "true";
  if (!isMenuOpen) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeMobileMoreMenu({ restoreFocus: true });
  }
});

const mobileToolbarMediaQuery = window.matchMedia("(max-width: 640px)");
const handleMobileToolbarBreakpointChange = (event) => {
  if (!event.matches) {
    closeMobileMoreMenu();
  }
};

if (typeof mobileToolbarMediaQuery.addEventListener === "function") {
  mobileToolbarMediaQuery.addEventListener("change", handleMobileToolbarBreakpointChange);
} else if (typeof mobileToolbarMediaQuery.addListener === "function") {
  mobileToolbarMediaQuery.addListener(handleMobileToolbarBreakpointChange);
}

console.info("startup: handlers-bound");

/* ========= INIT ========= */
window.addEventListener("load", () => {
  if (!isMobileDebugPanelEnabled()) {
    document.getElementById("mobileErrorPanel")?.classList.add("hidden");
  }

  bootstrapApp();
});

window.addEventListener("orientationchange", () => {
  scheduleResponsiveViewRefresh({
    delays: [180, 420],
    force: true
  });
}, { passive: true });
window.addEventListener("pageshow", () => {
  if (responsiveViewController?.triggerFirstPageShowRefresh()) return;
  scheduleResponsiveViewRefresh({ force: true });
}, { passive: true });
window.addEventListener("beforeunload", () => {
  flushPendingAutoSave();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPendingAutoSave();
  }
});

// DEBUG toggle with key "D"
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "d") {
    const root = document.documentElement;
    const active = root.getAttribute("data-debug") === "1";
    root.setAttribute("data-debug", active ? "0" : "1");
  }
});
