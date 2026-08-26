const shiftDialogOverlay = document.getElementById("shiftDialogOverlay");
const shiftDialogTitle = document.getElementById("shiftDialogTitle");

const shiftDialogLateFields = document.getElementById("shiftDialogLateFields");
const shiftDialogFullFields = document.getElementById("shiftDialogFullFields");
const shiftDialogFlexFields = document.getElementById("shiftDialogFlexFields");
const shiftDialogFoFields = document.getElementById("shiftDialogFoFields");

const shiftDialogLateStart = document.getElementById("shiftDialogLateStart");
const shiftDialogLateCheckout = document.getElementById("shiftDialogLateCheckout");

const shiftDialogFullCheckout = document.getElementById("shiftDialogFullCheckout");
const shiftDialogFoStart = document.getElementById("shiftDialogFoStart");
const shiftDialogFoEnd = document.getElementById("shiftDialogFoEnd");
const shiftDialogFoCheckout = document.getElementById("shiftDialogFoCheckout");

const shiftDialogFlexStartHour = document.getElementById("shiftDialogFlexStartHour");
const shiftDialogFlexStartMinute = document.getElementById("shiftDialogFlexStartMinute");
const shiftDialogFlexEndHour = document.getElementById("shiftDialogFlexEndHour");
const shiftDialogFlexEndMinute = document.getElementById("shiftDialogFlexEndMinute");

const shiftDialogAbsenceFields = document.getElementById("shiftDialogAbsenceFields");
const shiftDialogAbsenceType = document.getElementById("shiftDialogAbsenceType");
const shiftDialogAbsenceFrom = document.getElementById("shiftDialogAbsenceFrom");
const shiftDialogAbsenceTo = document.getElementById("shiftDialogAbsenceTo");

const shiftDialogCancel = document.getElementById("shiftDialogCancel");
const shiftDialogSave = document.getElementById("shiftDialogSave");
const shiftDialogDelete = document.getElementById("shiftDialogDelete");

const shiftDialogExternalHelpFields = document.getElementById("shiftDialogExternalHelpFields");
const shiftDialogExternalHelpBranch = document.getElementById("shiftDialogExternalHelpBranch");
const shiftDialogExternalHelpStartHour = document.getElementById("shiftDialogExternalHelpStartHour");
const shiftDialogExternalHelpStartMinute = document.getElementById("shiftDialogExternalHelpStartMinute");
const shiftDialogExternalHelpEndHour = document.getElementById("shiftDialogExternalHelpEndHour");
const shiftDialogExternalHelpEndMinute = document.getElementById("shiftDialogExternalHelpEndMinute");
const shiftDialogExternalHelpPauseHour = document.getElementById("shiftDialogExternalHelpPauseHour");
const shiftDialogExternalHelpPauseMinute = document.getElementById("shiftDialogExternalHelpPauseMinute");
const shiftDialogExternalHelpDuration = document.getElementById("shiftDialogExternalHelpDuration");

let shiftDialogContext = null;
let shiftDialogPreviousFocusEl = null;

const PLAN_MINUTE_OPTIONS = ["00", "10", "15", "30", "45", "55"];
const FO_START_TIME = "08:55";

function getFoRule() {
  return getShiftRuleByCode("FO");
}

function getFoStartTime() {
  return getFoRule()?.startPolicy?.value || FO_START_TIME;
}

function buildFoEndOptions() {
  return [...(getFoRule()?.endPolicy?.options || [])];
}

function initLateStartSelect() {
  if (!shiftDialogLateStart) return;
  const lateRule = getShiftRuleByCode("L");
  const options = lateRule?.startPolicy?.options || [];
  if (!options.length) return;

  shiftDialogLateStart.innerHTML = "";
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    shiftDialogLateStart.appendChild(option);
  });
}

function initFoEndSelect() {
  if (!shiftDialogFoEnd) return;
  shiftDialogFoEnd.innerHTML = "";

  buildFoEndOptions().forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    shiftDialogFoEnd.appendChild(option);
  });
}

function initHourSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  for (let hour = 0; hour <= 23; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour).padStart(2, "0");
    option.textContent = String(hour).padStart(2, "0");
    selectEl.appendChild(option);
  }
}

function initQuarterMinuteSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  PLAN_MINUTE_OPTIONS.forEach((minute) => {
    const option = document.createElement("option");
    option.value = minute;
    option.textContent = minute;
    selectEl.appendChild(option);
  });
}

function initQuarterTimePicker(hourEl, minuteEl) {
  initHourSelect(hourEl);
  initQuarterMinuteSelect(minuteEl);
}

function setQuarterPickerValue(hourEl, minuteEl, hhmm) {
  const normalized = normalizePlanTime(hhmm || "") || "00:00";
  const [hour, minute] = normalized.split(":");
  if (hourEl) hourEl.value = hour;
  if (minuteEl) minuteEl.value = minute;
}

function getQuarterPickerValue(hourEl, minuteEl) {
  if (!hourEl || !minuteEl) return "";
  const hour = hourEl.value || "00";
  const minute = minuteEl.value || "00";
  return `${hour}:${minute}`;
}

function syncEndPickerToStartIfNeeded(startHourEl, startMinuteEl, endHourEl, endMinuteEl, options = {}) {
  const start = normalizePlanTime(getQuarterPickerValue(startHourEl, startMinuteEl));
  const end = normalizePlanTime(getQuarterPickerValue(endHourEl, endMinuteEl));
  if (!start || !end) return;

  const startMinutes = hhmmToMinutes(start);
  const endMinutes = hhmmToMinutes(end);
  if (endMinutes >= startMinutes && options.forceAlign !== true) return;

  const defaultMinutes = Number.isFinite(options.defaultMinutes) ? options.defaultMinutes : 0;
  const alignedEnd = addMinutesToHHMM(start, defaultMinutes);
  setQuarterPickerValue(endHourEl, endMinuteEl, alignedEnd);
}

initQuarterTimePicker(shiftDialogFlexStartHour, shiftDialogFlexStartMinute);
initQuarterTimePicker(shiftDialogFlexEndHour, shiftDialogFlexEndMinute);
initQuarterTimePicker(shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute);
initQuarterTimePicker(shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute);
initQuarterTimePicker(shiftDialogExternalHelpPauseHour, shiftDialogExternalHelpPauseMinute);
initLateStartSelect();
initFoEndSelect();

function getAbsenceTypeMeta(type) {
  if (type === "sick") {
    return {
      dialogType: "K",
      title: "Krank",
      invalidRangeMessage: "Ungültiger Krankzeitraum.",
      confirmDeleteMessage: "OK = gesamte Krankmeldung löschen\nAbbrechen = Krankmeldung ab diesem Tag kürzen"
    };
  }

  return {
    dialogType: "U",
    title: "Urlaub",
    invalidRangeMessage: "Ungültiger Urlaubszeitraum.",
    confirmDeleteMessage: "OK = gesamten Urlaub löschen\nAbbrechen = Urlaub ab diesem Tag kürzen"
  };
}

function getAbsenceTypeFromDialogContext(type) {
  if (shiftDialogAbsenceType?.value === "sick") return "sick";
  return type === "K" ? "sick" : "vacation";
}

function getDialogTypeFromResolvedEntry(resolved) {
  const status = getResolvedStatus(resolved);
  if (status === ENTRY_STATUS.VACATION) return "U";
  if (status === ENTRY_STATUS.SICK) return "K";
  if (status === ENTRY_STATUS.EXTERNAL) return "AH";
  return null;
}

function resetShiftDialogInputs(isoDate) {
  shiftDialogLateStart.value = "13:00";
  shiftDialogLateCheckout.value = "yes";
  shiftDialogFullCheckout.value = "yes";
  if (shiftDialogFoStart) shiftDialogFoStart.value = getFoStartTime();
  if (shiftDialogFoEnd) shiftDialogFoEnd.value = "12:00";
  if (shiftDialogFoCheckout) shiftDialogFoCheckout.value = "no";
  if (shiftDialogFoEnd) shiftDialogFoEnd.disabled = false;
  setQuarterPickerValue(shiftDialogFlexStartHour, shiftDialogFlexStartMinute, "00:00");
  setQuarterPickerValue(shiftDialogFlexEndHour, shiftDialogFlexEndMinute, "00:00");
  syncEndPickerToStartIfNeeded(
    shiftDialogFlexStartHour,
    shiftDialogFlexStartMinute,
    shiftDialogFlexEndHour,
    shiftDialogFlexEndMinute,
    { forceAlign: true }
  );

  shiftDialogExternalHelpBranch.value = "";
  setQuarterPickerValue(shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute, "09:00");
  setQuarterPickerValue(shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute, "14:00");
  syncEndPickerToStartIfNeeded(
    shiftDialogExternalHelpStartHour,
    shiftDialogExternalHelpStartMinute,
    shiftDialogExternalHelpEndHour,
    shiftDialogExternalHelpEndMinute,
    { forceAlign: true, defaultMinutes: 300 }
  );
  setQuarterPickerValue(shiftDialogExternalHelpPauseHour, shiftDialogExternalHelpPauseMinute, "00:00");
  shiftDialogExternalHelpDuration.value = "05:00";
  refreshExternalHelpDurationField();

  shiftDialogAbsenceType.value = "vacation";
  shiftDialogAbsenceFrom.value = isoDate || "";
  shiftDialogAbsenceTo.value = isoDate || "";
}

function updateAbsenceDialogTitle() {
  if (!shiftDialogContext) return;
  const absenceType = getAbsenceTypeFromDialogContext(shiftDialogContext.type);
  shiftDialogTitle.textContent = getAbsenceTypeMeta(absenceType).title;
}

function openShiftDialog(type, context) {
  if (!shiftDialogOverlay) return;
  shiftDialogContext = context;
  resetShiftDialogInputs(context.isoDate);

  shiftDialogLateFields.classList.add("hidden");
  shiftDialogFullFields.classList.add("hidden");
  shiftDialogFlexFields.classList.add("hidden");
  shiftDialogFoFields.classList.add("hidden");
  shiftDialogAbsenceFields.classList.add("hidden");
  shiftDialogExternalHelpFields.classList.add("hidden");

  const rule = getShiftRuleByCode(type);
  shiftDialogTitle.textContent = rule?.label || type;

  if (type === "AH") {
    shiftDialogTitle.textContent = "Aushilfe";
    shiftDialogExternalHelpFields.classList.remove("hidden");
  }

  if (type === "U" || type === "K") {
    shiftDialogAbsenceType.value = type === "K" ? "sick" : "vacation";
    shiftDialogAbsenceFields.classList.remove("hidden");
    updateAbsenceDialogTitle();
  }

  if (type === "L") {
    shiftDialogTitle.textContent = "Spätschicht";
    shiftDialogLateFields.classList.remove("hidden");
  }

  if (type === "G") {
    shiftDialogTitle.textContent = "Ganztag";
    shiftDialogFullFields.classList.remove("hidden");
  }

  if (type === "FO") {
    shiftDialogFoFields.classList.remove("hidden");
  }

  if (type === "FLEX") {
    shiftDialogTitle.textContent = "Flexible Schicht";
    shiftDialogFlexFields.classList.remove("hidden");
  }

  if (shiftDialogDelete) {
    shiftDialogDelete.classList.toggle("hidden", !isDialogShift(type));
  }

  fillShiftDialogFromExisting(type, context);
  if (type === "FLEX") {
    syncEndPickerToStartIfNeeded(
      shiftDialogFlexStartHour,
      shiftDialogFlexStartMinute,
      shiftDialogFlexEndHour,
      shiftDialogFlexEndMinute,
      { forceAlign: false }
    );
  }
  if (type === "AH") {
    syncEndPickerToStartIfNeeded(
      shiftDialogExternalHelpStartHour,
      shiftDialogExternalHelpStartMinute,
      shiftDialogExternalHelpEndHour,
      shiftDialogExternalHelpEndMinute
    );
  }
  const isHtmlEl = typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement;
  shiftDialogPreviousFocusEl = isHtmlEl ? document.activeElement : null;
  shiftDialogOverlay.classList.remove("hidden");
  shiftDialogOverlay.setAttribute("aria-hidden", "false");
  const firstFocusable = shiftDialogOverlay.querySelector("select, input, button, textarea");
  firstFocusable?.focus();
}

function closeShiftDialog() {
  if (!shiftDialogOverlay) return;
  shiftDialogOverlay.classList.add("hidden");
  shiftDialogOverlay.setAttribute("aria-hidden", "true");
  if (shiftDialogDelete) {
    shiftDialogDelete.classList.add("hidden");
  }
  shiftDialogContext = null;
  shiftDialogPreviousFocusEl?.focus?.();
  shiftDialogPreviousFocusEl = null;
}
shiftDialogCancel.addEventListener("click", () => {
  closeShiftDialog();
});
shiftDialogDelete?.addEventListener("click", () => {
  if (!shiftDialogContext) return;

  const { emp, isoDate, type } = shiftDialogContext;

  if (["shift", "external-help"].includes(getShiftRuleByCode(type)?.entryType || "")) {
    clearDay(emp.id, isoDate);
    closeShiftDialog();
    return;
  }

  if (type === "U" || type === "K") {
    const absenceType = getAbsenceTypeFromDialogContext(type);
    const meta = getAbsenceTypeMeta(absenceType);
    const choice = confirm(meta.confirmDeleteMessage);

    if (choice) {
      removeAbsenceEntryForEmployeeOnIso(emp.id, isoDate, absenceType);
    } else {
      trimAbsenceEntryFromIso(emp.id, isoDate, absenceType);
    }

    closeShiftDialog();
    return;
  }
});
shiftDialogSave.addEventListener("click", () => {
  if (!shiftDialogContext) return;

  const { emp, isoDate, type } = shiftDialogContext;

  if (type === "L") {
    const start = shiftDialogLateStart.value;
    const checkout = shiftDialogLateCheckout.value === "yes";

    const entry = buildLateShiftEntry(start, checkout);
    if (!entry) {
      alert("Ungültige Spätschicht.");
      return;
    }

    const applied = setShift(emp.id, isoDate, entry);
    if (applied && shiftDialogContext.source === "month" && typeof rememberLastMonthWorkShift === "function") {
      rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    }
    closeShiftDialog();
    return;
  }

  if (type === "G") {
    const checkout = shiftDialogFullCheckout.value === "yes";
    const entry = buildFullShiftEntry(checkout);

    const applied = setShift(emp.id, isoDate, entry);
    if (applied && shiftDialogContext.source === "month" && typeof rememberLastMonthWorkShift === "function") {
      rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    }
    closeShiftDialog();
    return;
  }

  if (type === "FO") {
    const withCheckout = shiftDialogFoCheckout.value === "yes";
    const selectedEnd = withCheckout ? "19:10" : shiftDialogFoEnd.value;
    const entry = buildFoShiftEntry(selectedEnd);

    if (!entry) {
      alert("Ungültige FÖ-Schicht.");
      return;
    }

    const applied = setShift(emp.id, isoDate, entry);
    if (applied && shiftDialogContext.source === "month" && typeof rememberLastMonthWorkShift === "function") {
      rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    }
    closeShiftDialog();
    return;
  }

  if (type === "FLEX") {
    const start = getQuarterPickerValue(shiftDialogFlexStartHour, shiftDialogFlexStartMinute);
    const end = getQuarterPickerValue(shiftDialogFlexEndHour, shiftDialogFlexEndMinute);

    if (!start || !end) {
      alert("Start und Ende wählen.");
      return;
    }

    const entry = buildFlexibleShiftEntry(start, end);

    if (!entry) {
      alert("Ungültige flexible Schicht. Bitte Zeiten prüfen.");
      return;
    }

    const applied = setShift(emp.id, isoDate, entry);
    if (applied && shiftDialogContext.source === "month" && typeof rememberLastMonthWorkShift === "function") {
      rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    }
    closeShiftDialog();
    return;
  }

  if (type === "U" || type === "K") {
    const absenceType = getAbsenceTypeFromDialogContext(type);
    const meta = getAbsenceTypeMeta(absenceType);
    const fromIso = shiftDialogAbsenceFrom.value;
    const toIso = shiftDialogAbsenceTo.value;

    if (!fromIso || !toIso || !fromIsoDate(fromIso) || !fromIsoDate(toIso) || toIso < fromIso) {
      alert(meta.invalidRangeMessage);
      return;
    }

    const savedAbsence = setAbsence(emp.id, fromIso, toIso, absenceType, "", { commit: true });
    if (!savedAbsence) {
      alert("Feiertage können nicht überschrieben werden.");
      return;
    }
    closeShiftDialog();
    return;
  }

  if (type === "AH") {
    const branch = (shiftDialogExternalHelpBranch.value || "").trim();
    const start = getQuarterPickerValue(shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute);
    const end = getQuarterPickerValue(shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute);
    clearDay(emp.id, isoDate, { commit: false });

    const ok = setExternalHelpForEmployeeOnDate(emp.id, isoDate, {
      branch,
      start,
      end
    });

    if (!ok) {
      alert("Ungültige Aushilfe-Zeiten. Bitte Start/Ende prüfen (15-Minuten-Schritte plus definierte Ausnahmezeiten wie 19:10).");
      return;
    }

    closeShiftDialog();
    return;
  }

  saveAppStateDebounced();
  renderAllViews();
  closeShiftDialog();
});

shiftDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === shiftDialogOverlay) {
    closeShiftDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (shiftDialogOverlay?.classList.contains("hidden")) return;
  event.preventDefault();
  closeShiftDialog();
});

function renderWeekWarnings() {
  if (!weekWarningsEl) return;

  const warnings = getWeekWarnings();
  weekWarningsEl.innerHTML = "";

  if (warnings.length === 0) {
    const div = document.createElement("div");
    div.className = "warnLine";
    div.textContent = "Keine Warnungen.";
    weekWarningsEl.appendChild(div);
    return;
  }

  warnings.forEach((text) => {
    const div = document.createElement("div");
    div.className = "warnLine";
    div.textContent = text;
    weekWarningsEl.appendChild(div);
  });
}

function shiftIsoDateByDays(isoDate, dayOffset) {
  const date = fromIsoDate(isoDate);
  if (!date) return isoDate;

  date.setDate(date.getDate() + dayOffset);
  return toIsoDate(date);
}
function clearDayRange(employeeId, fromIso, toIso, options = {}) {
  const mutationDecision = decideMutationForIsoRange(fromIso, toIso, "direct-day");
  if (!mutationDecision.allow) return false;

  let current = fromIso;

  while (current <= toIso) {
    clearDay(employeeId, current, { commit: false });
    current = shiftIsoDateByDays(current, 1);
  }

  if (options.commit !== false) {
    commitPlanChange();
  }

  return true;
}

function replaceAbsenceCoverageForEmployee(employeeId, fromIso, toIso, replacementType = null) {
  const mutationDecision = decideMutationForIsoRange(fromIso, toIso, "absence-range");
  if (!mutationDecision.allow) return false;

  state.absences = replaceAbsenceCoverage(
    state.absences || [],
    employeeId,
    fromIso,
    toIso,
    replacementType
  );

  return true;
}

function removeAbsenceCoverageForEmployee(employeeId, removeFromIso, removeToIso, type) {
  const mutationDecision = decideMutationForIsoRange(removeFromIso, removeToIso, "absence-range");
  if (!mutationDecision.allow) return false;

  if (type === "vacation" || type === "sick") {
    state.absences = normalizeAbsences(
      removeAbsenceCoverage(
        state.absences || [],
        employeeId,
        removeFromIso,
        removeToIso,
        type
      )
    );
    return true;
  }

  state.absences = replaceAbsenceCoverage(
    state.absences || [],
    employeeId,
    removeFromIso,
    removeToIso,
    null
  );
  return true;
}

function removeExternalHelpForEmployeeOnDate(employeeId, isoDate) {
  const entry = getPlanEntry(employeeId, isoDate);
  if (!entry) return;

  if (entry.type === "external-help") {
    clearPlanEntry(employeeId, isoDate);
  }
}

function removeScheduledShiftForEmployeeOnDate(employeeId, isoDate) {
  const entry = getPlanEntry(employeeId, isoDate);
  if (!entry) return;

  if (entry.type === "shift") {
    clearPlanEntry(employeeId, isoDate);
  }
}

function setExternalHelpForEmployeeOnDate(employeeId, isoDate, options = {}) {
  const branch = (options.branch || "").trim();
  const start = normalizePlanTime(options.start || "");
  const end = normalizePlanTime(options.end || "");
  if (!start || !end) return false;
  if (!isAllowedPlanTime(start) || !isAllowedPlanTime(end)) return false;

  const spanMinutes = diffMinutesBetweenHHMM(start, end);
  if (spanMinutes <= 0) return false;
  const pauseMinutes = getExternalHelpBreakDeductionMinutes(start, end);
  if (pauseMinutes >= spanMinutes) return false;

  const workedMinutes = getExternalHelpWorkedMinutes(start, end);
  if (workedMinutes <= 0) return false;

  setPlanEntry(employeeId, isoDate, {
    type: "external-help",
    status: ENTRY_STATUS.EXTERNAL,
    label: "AH",
    branch,
    externalHelp: true,
    start,
    end,
    pause: pauseMinutes,
    breakMinutes: pauseMinutes,
    minutes: workedMinutes
  });

  return true;
}

function getWeekSelectValueForDay(emp, isoDate) {
  const resolved = getResolvedEntryForEmployeeOnIso(emp, isoDate);

  if (resolved.type === "holiday") return "H";

  const dialogType = getDialogTypeFromResolvedEntry(resolved);
  if (dialogType) return dialogType;

  if (resolved.type === "shift" && resolved.sourceEntry) {
    const entry = resolved.sourceEntry;

    if (entry.mode === "early") {
      if (entry.code === "FO") return "FÖ";
      return entry.code || "-";
    }
    if (entry.mode === "late") return "L";
    if (entry.mode === "full") return "G";
    if (entry.mode === "flex") return "FLEX";
  }

  if (resolved.type === "off" && resolved.sourceEntry && getEntryStatus(resolved.sourceEntry) === ENTRY_STATUS.OFF) {
    return "FR";
  }

  return "-";
}

function buildWeekSelectClass(value) {
  if (value === "U" || value === "K" || value === "AH" || value === "FR") {
    return `weekSelect ${value === "U" ? "vacation" : "free"}`;
  }

  const normalizedValue = getShiftCodeForSelectValue(value);
  return `weekSelect ${getShiftClassByKey(normalizedValue === "H" ? "-" : normalizedValue)}`;
}

function getEmployeeLastShiftLabel(emp) {
  const shiftDays = Object.keys(state.schedule || {}).sort().reverse();

  for (const isoDate of shiftDays) {
    const value = getWeekSelectValueForDay(emp, isoDate);
    if (["FO", "F3", "F4", "F5", "F6", "L", "G", "FLEX", "FÖ"].includes(value)) {
      return value;
    }
  }

  return null;
}

function getAbsenceEntryForEmployeeOnIso(employeeId, isoDate, type) {
  return (state.absences || []).find((entry) => {
    if (!entry || entry.employeeId !== employeeId) return false;
    if (entry.type !== type) return false;
    return isoDate >= entry.from && isoDate <= entry.to;
  }) || null;
}

function minutesToHHMMInput(minutes) {
  return formatQuarterHourTime(Math.max(0, Number(minutes) || 0));
}

function removeAbsenceEntryForEmployeeOnIso(employeeId, isoDate, type) {
  const mutationDecision = decideMutationForIsoRange(isoDate, isoDate, "direct-day");
  if (!mutationDecision.allow) return false;

  const entry = getAbsenceEntryForEmployeeOnIso(employeeId, isoDate, type);
  if (!entry) return false;

  state.absences = (state.absences || []).filter((item) => item.id !== entry.id);
  syncVacationScheduleFromAbsences(employeeId);
  commitPlanChange();
  return true;
}
function trimAbsenceEntryFromIso(employeeId, isoDate, type) {
  const mutationDecision = decideMutationForIsoRange(isoDate, isoDate, "direct-day");
  if (!mutationDecision.allow) return false;

  const entry = getAbsenceEntryForEmployeeOnIso(employeeId, isoDate, type);
  if (!entry) return false;

  // Wenn der Eintrag genau an diesem Tag beginnt → komplett löschen
  if (entry.from === isoDate) {
    state.absences = state.absences.filter((a) => a.id !== entry.id);
    syncVacationScheduleFromAbsences(employeeId);
    commitPlanChange();
    return true;
  }

  // sonst bis zum Tag davor kürzen
  const prevDate = shiftIsoDateByDays(isoDate, -1);
  entry.to = prevDate;

  syncVacationScheduleFromAbsences(employeeId);

  commitPlanChange();
  return true;
}

function fillShiftDialogFromExisting(type, context) {
  const { emp, isoDate } = context;
  const resolved = getResolvedEntryForEmployeeOnIso(emp, isoDate);

  if (type === "L" && resolved.type === "shift" && resolved.sourceEntry?.mode === "late") {
    const entry = resolved.sourceEntry;
    shiftDialogLateStart.value = entry.start || "13:00";
    shiftDialogLateCheckout.value = entry.end === "19:10" ? "yes" : "no";
  }

  if (type === "G" && resolved.type === "shift" && resolved.sourceEntry?.mode === "full") {
    const entry = resolved.sourceEntry;
    shiftDialogFullCheckout.value = entry.end === "19:10" ? "yes" : "no";
  }

  if (type === "FLEX" && resolved.type === "shift" && resolved.sourceEntry?.mode === "flex") {
    const entry = normalizePlanEntry(resolved.sourceEntry) || resolved.sourceEntry;
    setQuarterPickerValue(shiftDialogFlexStartHour, shiftDialogFlexStartMinute, entry.start || "00:00");
    setQuarterPickerValue(shiftDialogFlexEndHour, shiftDialogFlexEndMinute, entry.end || "00:00");
  }

  if (type === "FO" && resolved.type === "shift" && resolved.sourceEntry?.code === "FO") {
    const entry = normalizePlanEntry(resolved.sourceEntry) || resolved.sourceEntry;
    if (shiftDialogFoStart) shiftDialogFoStart.value = getFoStartTime();
    if (shiftDialogFoEnd) {
      shiftDialogFoEnd.value = entry.end === "19:10" ? "19:10" : (entry.end || "12:00");
      shiftDialogFoEnd.disabled = entry.end === "19:10";
    }
    if (shiftDialogFoCheckout) shiftDialogFoCheckout.value = entry.end === "19:10" ? "yes" : "no";
  }

  if (type === "AH" && resolved.type === "external-help" && resolved.sourceEntry) {
    const entry = normalizePlanEntry(resolved.sourceEntry) || resolved.sourceEntry;
    const start = entry.start || "09:00";
    const end = entry.end || addMinutesToHHMM(start, entry.minutes || 0);
    shiftDialogExternalHelpBranch.value = entry.branch || "";
    setQuarterPickerValue(shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute, start);
    setQuarterPickerValue(shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute, end);
    shiftDialogExternalHelpDuration.value = minutesToHHMMInput(entry.minutes);
    refreshExternalHelpDurationField();
  }

  if (type === "U") {
    const absence = getAbsenceEntryForEmployeeOnIso(emp.id, isoDate, "vacation");
    if (absence) {
      shiftDialogAbsenceType.value = "vacation";
      shiftDialogAbsenceFrom.value = absence.from;
      shiftDialogAbsenceTo.value = absence.to;
    }
  }

  if (type === "K") {
    const absence = getAbsenceEntryForEmployeeOnIso(emp.id, isoDate, "sick");
    if (absence) {
      shiftDialogAbsenceType.value = "sick";
      shiftDialogAbsenceFrom.value = absence.from;
      shiftDialogAbsenceTo.value = absence.to;
    }
  }
}

shiftDialogAbsenceType?.addEventListener("change", () => {
  updateAbsenceDialogTitle();
});

function refreshExternalHelpDurationField() {
  if (!shiftDialogExternalHelpDuration) return;

  const start = normalizePlanTime(
    getQuarterPickerValue(shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute)
  );
  const end = normalizePlanTime(
    getQuarterPickerValue(shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute)
  );
  const pauseMinutes = getExternalHelpBreakDeductionMinutes(start, end);

  if (!start || !end) {
    shiftDialogExternalHelpDuration.value = "";
    return;
  }

  const spanMinutes = diffMinutesBetweenHHMM(start, end);
  if (spanMinutes <= 0 || pauseMinutes >= spanMinutes) {
    shiftDialogExternalHelpDuration.value = "";
    return;
  }

  shiftDialogExternalHelpDuration.value = minutesToHHMMInput(spanMinutes - pauseMinutes);
}

[shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute,
  shiftDialogExternalHelpEndHour, shiftDialogExternalHelpEndMinute].forEach((el) => {
  el?.addEventListener("change", refreshExternalHelpDurationField);
});

[shiftDialogFlexStartHour, shiftDialogFlexStartMinute].forEach((el) => {
  el?.addEventListener("change", () => {
    syncEndPickerToStartIfNeeded(
      shiftDialogFlexStartHour,
      shiftDialogFlexStartMinute,
      shiftDialogFlexEndHour,
      shiftDialogFlexEndMinute
    );
  });
});

[shiftDialogExternalHelpStartHour, shiftDialogExternalHelpStartMinute].forEach((el) => {
  el?.addEventListener("change", () => {
    syncEndPickerToStartIfNeeded(
      shiftDialogExternalHelpStartHour,
      shiftDialogExternalHelpStartMinute,
      shiftDialogExternalHelpEndHour,
      shiftDialogExternalHelpEndMinute
    );
    refreshExternalHelpDurationField();
  });
});

shiftDialogFoCheckout?.addEventListener("change", () => {
  const withCheckout = shiftDialogFoCheckout.value === "yes";
  if (shiftDialogFoEnd) {
    shiftDialogFoEnd.disabled = withCheckout;
    if (withCheckout) {
      shiftDialogFoEnd.value = "19:10";
    } else if (shiftDialogFoEnd.value === "19:10") {
      shiftDialogFoEnd.value = "19:00";
    }
  }
});


function openShiftDialogForSelectValue(value, context) {
  const normalizedValue = getShiftCodeForSelectValue(value);
  if (!isDialogShift(normalizedValue)) return false;

  openShiftDialog(normalizedValue, { ...context, type: normalizedValue });
  return true;
}

function applyWeekSelection(emp, isoDate, selectedValue, previousValue) {
  const priorValue = previousValue ?? getWeekSelectValueForDay(emp, isoDate);

  if (openShiftDialogForSelectValue(selectedValue, { emp, isoDate })) {
    return { openedDialog: true, previousValue: priorValue };
  }

  if (selectedValue === "FR") {
    const applied = setOffDay(emp.id, isoDate);
    if (!applied) {
      return { rejected: true, previousValue: priorValue };
    }
    return { applied: true };
  }

  if (selectedValue !== "-") {
    const normalizedValue = getShiftCodeForSelectValue(selectedValue);
    const entry = buildEarlyShiftEntry(normalizedValue);

    if (!entry) {
      alert("Ungültige Frühschicht.");
      return { rejected: true, previousValue: priorValue };
    }

    const applied = setShift(emp.id, isoDate, entry);
    if (!applied) {
      return { rejected: true, previousValue: priorValue };
    }
    return { applied: true };
  }

  const cleared = clearDay(emp.id, isoDate);
  if (!cleared) {
    return { rejected: true, previousValue: priorValue };
  }
  return { applied: true };
}

let weekMobileSelectDialogState = null;

function closeWeekMobileSelectDialog() {
  if (!weekMobileSelectDialogState) return;
  const { overlay, previousFocusEl } = weekMobileSelectDialogState;
  overlay?.remove?.();
  previousFocusEl?.focus?.();
  weekMobileSelectDialogState = null;
}

function openWeekMobileSelectDialog(emp, isoDate) {
  if (!emp || !isoDate) return false;
  if (getBlockingTypeForEmployeeOnIso(emp, isoDate) === "holiday") return false;
  if (!document?.body || typeof document.createElement !== "function") return false;

  if (weekMobileSelectDialogState) closeWeekMobileSelectDialog();

  const previousFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const options = getShiftSelectOptions().filter((option) => option?.value && option.value !== "H");
  if (!Array.isArray(options) || !options.length) return false;

  const overlay = document.createElement("div");
  overlay.className = "dialogOverlay dialogOverlayBottomSheet";
  overlay.setAttribute("role", "presentation");
  overlay.setAttribute("aria-hidden", "false");

  const box = document.createElement("div");
  box.className = "dialogBox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Tag auswählen");

  const title = document.createElement("h3");
  title.textContent = "Tag auswählen";
  box.appendChild(title);

  const optionsWrap = document.createElement("div");
  optionsWrap.className = "dialogButtonRow";
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.value = option.value;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      closeWeekMobileSelectDialog();
      applyWeekSelection(emp, isoDate, option.value);
      renderWeekView();
    });
    optionsWrap.appendChild(button);
  });
  box.appendChild(optionsWrap);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Abbrechen";
  cancelButton.addEventListener("click", () => {
    closeWeekMobileSelectDialog();
  });
  box.appendChild(cancelButton);

  overlay.appendChild(box);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeWeekMobileSelectDialog();
  });
  document.body.appendChild(overlay);

  weekMobileSelectDialogState = {
    overlay,
    previousFocusEl
  };

  return true;
}

function handleWeekMobileSelectDialogKeydown(event) {
  if (!weekMobileSelectDialogState) return;
  if (event.key !== "Escape") return;

  event.preventDefault();
  closeWeekMobileSelectDialog();
}

document.addEventListener("keydown", handleWeekMobileSelectDialogKeydown);

function createWeekSelect(emp, isoDate) {
  const currentValue = getWeekSelectValueForDay(emp, isoDate);
  const blockingType = getBlockingTypeForEmployeeOnIso(emp, isoDate);

  const wrap = document.createElement("div");
  wrap.className = "weekCellControl";

  const cellFlags = getWeekCellFlags(emp, isoDate);
  if (cellFlags.isLateToEarlyBridge) {
    wrap.classList.add("weekCellHandoverOk");
    wrap.title = "Vortag bis 19:10 und heute Frühstart";
  }

  const sel = document.createElement("select");
  sel.className = buildWeekSelectClass(currentValue);

  

 if (blockingType === "holiday") {
  const opt = document.createElement("option");
  opt.value = "H";
  opt.textContent = "H";
  sel.appendChild(opt);
  sel.value = "H";
  sel.disabled = true;
  wrap.appendChild(sel);
  return wrap;
}
  const groupedOptions = getShiftSelectOptions().reduce((acc, option) => {
    const group = option.group || "Schichten";
    if (!acc[group]) acc[group] = [];
    acc[group].push(option);
    return acc;
  }, {});

  Object.entries(groupedOptions).forEach(([groupLabel, options]) => {
    const optGroup = document.createElement("optgroup");
    optGroup.label = groupLabel;

    options.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      optGroup.appendChild(opt);
    });

    sel.appendChild(optGroup);
  });
  sel.value = currentValue;

  sel.addEventListener("change", () => {
    const selectedValue = sel.value;
    const previousValue = getWeekSelectValueForDay(emp, isoDate);
    const result = applyWeekSelection(emp, isoDate, selectedValue, previousValue);
    if (result?.openedDialog || result?.rejected) {
      sel.value = previousValue;
    }
  });

  sel.addEventListener("dblclick", () => {
    const currentEntryValue = getWeekSelectValueForDay(emp, isoDate);
    if (openShiftDialogForSelectValue(currentEntryValue, { emp, isoDate })) {
      sel.value = currentEntryValue;
    }
  });

  wrap.appendChild(sel);

  return wrap;
}
function isEarlyStartEntry(entry) {
  if (!entry || entry.type !== "shift") return false;

  if (entry.mode === "early" || entry.mode === "full") return true;

  if (!entry.start) return false;
  return hhmmToMinutes(entry.start) <= hhmmToMinutes("09:00");
}

function getWeekDayHeaderMeta(index, visibleDays) {
  const day = visibleDays[index];
  if (!day) return null;

  const closers = getClosingWorkersForIso(day.iso);
  const hasClosingCoverage = closers.length > 0;
  const hasTooManyClosers = closers.length > 2;

  let handoverState = "none";
  let handoverText = "Übergabe —";

  if (index > 0) {
    const prevDay = visibleDays[index - 1];
    const prevClosers = prevDay ? getClosingWorkersForIso(prevDay.iso) : [];

    if (prevClosers.length > 0) {
      const hasEarlyHandover = prevClosers.some((emp) => {
        const entry = getPlanEntry(emp.id, day.iso);
        return isEarlyStartEntry(entry);
      });

      handoverState = hasEarlyHandover ? "ok" : "missing";
      handoverText = hasEarlyHandover ? "Übergabe ✓" : "Übergabe ✗";
    }
  }

  return {
    closers,
    closersText: `19:10 ${closers.length}/2`,
    closersState: hasTooManyClosers ? "high" : hasClosingCoverage ? "ok" : "low",
    handoverState,
    handoverText
  };
}

function getWeekCellFlags(emp, isoDate) {
  const prevIso = shiftIsoDateByDays(isoDate, -1);
  const prevEntry = getPlanEntry(emp.id, prevIso);
  const currentEntry = getPlanEntry(emp.id, isoDate);

  return {
    isLateToEarlyBridge: isClosingResolvedEntry(prevEntry) && isEarlyStartEntry(currentEntry)
  };
}

function renderWeekHeader() {
  const table = document.getElementById("weekTable");
  if (!table) return;

  const thead = table.querySelector("thead");
  if (!thead) return;

  const weekDays = getActiveWeekDays();
  if (!weekDays.length) return;

  const visibleDays = weekDays.slice(0, 6);

  let headerHtml = `
    <tr>
      <th>Name</th>
  `;

  visibleDays.forEach((day, index) => {
    const minutes = totalMinutesForDayIso(day.iso);
    const hoursText = minutesToHM(minutes);
    const meta = getWeekDayHeaderMeta(index, visibleDays);
    const isToday = day.iso === toIsoDate(new Date());

    let hoursClass = "weekDayHours";

    if (minutes < 600) {
      hoursClass += " hoursLow";
    } else if (minutes > 1200) {
      hoursClass += " hoursHigh";
    } else {
      hoursClass += " hoursOk";
    }

    const classes = [];
    if (isToday) classes.push("todayCol");

    const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
    const grayStyle = day.isOutsideMonth ? ` style="background:#eee;color:#666;"` : "";

    headerHtml += `
      <th${classAttr}${grayStyle}>
        ${day.weekdayLabel}<br>
        ${pad2(day.date.getDate())}.${pad2(day.date.getMonth() + 1)}<br>
        <span class="${hoursClass}">${hoursText}</span><br>
        <span class="weekDayMeta weekDayMeta--${meta.closersState}">${meta.closersText}</span>
        ${meta.handoverState !== "none" ? `<br><span class="weekDayMeta weekDayMeta--${meta.handoverState}">${meta.handoverText}</span>` : ""}
      </th>
    `;
  });

  headerHtml += `
      <th class="weekSummaryCol weekSummaryStart">Ist</th>
      <th class="weekSummaryCol">Konto</th>
      <th class="weekSummaryCol">Δ Woche</th>
      <th class="weekSummaryCol">Δ Monat</th>
      <th class="weekSummaryCol">Gesamtminus</th>
      <th class="weekSummaryCol">Soll</th>
    </tr>
  `;

  thead.innerHTML = headerHtml;
}

function renderWeekTable() {
  if (!weekTableBodyEl) return;

  weekTableBodyEl.innerHTML = "";

  const weekDays = getActiveWeekDays();
  if (!weekDays.length) return;

  const visibleDays = weekDays.slice(0, 6);
  const visibleEmployees = getWeekVisibleEmployees(visibleDays);

  visibleEmployees.forEach((emp) => {
    const tr = document.createElement("tr");
    const metrics = getEmployeeWeekMetrics(emp, visibleDays);
    const lastShift = metrics.lastShift;

    const tdNameRole = document.createElement("td");
    tdNameRole.className = "nameRoleCell";
    tdNameRole.innerHTML = `
      <div class="nameRoleName">${emp.name || "—"}</div>
      <div class="nameRoleSub">${emp.roleKey || "-"}</div>
      ${lastShift ? `<div class="nameRoleLast">zuletzt verwendet: ${lastShift}</div>` : ""}
    `;
    tr.appendChild(tdNameRole);

    visibleDays.forEach((day) => {
      const td = document.createElement("td");

      if (day.isOutsideMonth) {
        td.style.background = "#eee";
      }

      if (day.iso === toIsoDate(new Date())) {
        td.classList.add("todayCol");
      }

      td.appendChild(createWeekSelect(emp, day.iso));
      tr.appendChild(td);
    });

    const tdActual = document.createElement("td");
    tdActual.className = "weekHoursCell weekSummaryCol weekSummaryStart";
    tdActual.textContent = metrics.actualText;
    tdActual.title = "Ist der aktuellen Woche (Mo–Sa).";
    tr.appendChild(tdActual);

    const tdAccount = document.createElement("td");
    tdAccount.className = "weekHoursCell weekSummaryCol";
    tdAccount.textContent = metrics.accountText;
    tdAccount.title = "Arbeitszeit plus konto-relevante Abwesenheiten (Urlaub, Krank, Feiertag) der aktuellen Woche (Mo–Sa).";
    tr.appendChild(tdAccount);

    const tdDelta = document.createElement("td");
    tdDelta.className = "weekDeltaCell weekSummaryCol";
    tdDelta.textContent = metrics.weekDeltaText;
    tdDelta.title = metrics.weekDeltaTitle;
    tr.appendChild(tdDelta);

    const tdMonthDelta = document.createElement("td");
    tdMonthDelta.className = "weekDeltaCell weekSummaryCol";
    tdMonthDelta.textContent = metrics.monthDeltaText;
    tdMonthDelta.title = metrics.monthDeltaTitle;
    tr.appendChild(tdMonthDelta);

    const tdTotalMinus = document.createElement("td");
    tdTotalMinus.className = "weekDeltaCell weekSummaryCol";
    tdTotalMinus.textContent = metrics.totalMinusText;
    tdTotalMinus.title = metrics.totalMinusTitle;
    tr.appendChild(tdTotalMinus);

    const tdTarget = document.createElement("td");
    tdTarget.className = "weekTargetCell weekSummaryCol";
    tdTarget.textContent = metrics.targetText;
    tdTarget.title = "Sollzeit der aktuellen Woche (Mo–Sa).";
    tr.appendChild(tdTarget);

    weekTableBodyEl.appendChild(tr);
  });
}

function getWeekVisibleEmployees(visibleDays) {
  const visibleMonths = [...new Set(visibleDays.map((day) => String(day?.iso || "").slice(0, 7)).filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)))];
  return state.employees.filter((emp) => {
    if (!visibleMonths.length) return isEmployeeActiveInMonth(emp, state.activeMonth);
    return visibleMonths.some((yearMonth) => isEmployeeActiveInMonth(emp, yearMonth));
  });
}

function getEmployeeWeekMetrics(emp, visibleDays) {
  const isGfb = isGfbEmployee(emp);
  const lastShift = getEmployeeLastShiftLabel(emp);
  const plannedMinutes = getEmployeePlannedMinutesForWeek(emp, visibleDays);
  const accountMinutes = getEmployeeAccountMinutesForWeek(emp, visibleDays, null);
  const weekDifferenceMinutes = getEmployeeWeekDifferenceMinutes(emp, visibleDays, null);
  const monthDifferenceMinutes = getEmployeeMonthDifferenceMinutes(emp);
  const monthIsManual = isMonthActualManual(emp, state.activeMonth);
  const manualSuffix = monthIsManual ? " Iststunden manuell hinterlegt." : "";
  const manualMarker = monthIsManual ? " •" : "";
  const totalMinusMinutes = getEmployeeTotalMinusMinutes(emp);
  const remainingContingentMinutes = getEmployeeMonthContingentRemainingMinutes(emp);
  const overuseMinutes = getEmployeeMonthContingentOveruseMinutes(emp);

  return {
    lastShift,
    actualText: minutesToHM(plannedMinutes),
    accountText: minutesToHM(accountMinutes),
    weekDeltaClass: isGfb ? getDeltaVisualState(Math.max(weekDifferenceMinutes, 0)) : getDeltaVisualState(weekDifferenceMinutes),
    weekDeltaText: isGfb ? `${minutesToHM(weekDifferenceMinutes)} genutzt` : formatSignedMinutes(weekDifferenceMinutes),
    weekDeltaTitle: isGfb
      ? "GfB: Kontingentnutzung in der aktuellen Woche (Mo–Sa)."
      : "Delta der aktuellen Woche (Mo–Sa).",
    monthDeltaClass: isGfb ? getDeltaVisualState(Math.max(monthDifferenceMinutes, 0)) : getDeltaVisualState(monthDifferenceMinutes),
    monthDeltaText: isGfb
      ? `${minutesToHM(monthDifferenceMinutes)} genutzt${manualMarker}`
      : `${formatSignedMinutes(monthDifferenceMinutes)}${manualMarker}`,
    monthDeltaTitle: isGfb
      ? `GfB: Kontingentnutzung im aktuellen Monat.${manualSuffix}`
      : `Delta des Monats.${manualSuffix}`,
    totalMinusClass: isGfb
      ? getRestOverVisualState(overuseMinutes)
      : getRestOverVisualState(totalMinusMinutes),
    totalMinusText: isGfb
      ? (overuseMinutes > 0 ? `Über ${minutesToHM(overuseMinutes)}` : `Rest ${minutesToHM(remainingContingentMinutes)}`)
      : (totalMinusMinutes > 0 ? `-${minutesToHM(totalMinusMinutes)}` : "0:00"),
    totalMinusTitle: isGfb ? "GfB: Restkontingent bzw. Übernutzung im aktuellen Monat" : "Gesamtminus.",
    targetText: minutesToHM(getEmployeeTargetMinutesForWeek(emp, visibleDays, null))
  };
}

function getMobileChipLabel(value) {
  if (value === "FLEX") return "Flex";
  return value || "-";
}

function getMobileChipAriaLabel(day, chipValue, isOutsideMonth) {
  const stateSuffix = isOutsideMonth
    ? ", außerhalb des aktiven Monats, bearbeitbar"
    : ", tippen zum Bearbeiten";
  return `${day.weekdayLabel} ${pad2(day.date.getDate())}.${pad2(day.date.getMonth() + 1)}, aktuell ${chipValue}${stateSuffix}`;
}

function renderWeekMobileCards() {
  const cardsEl = document.getElementById("weekMobileCards");
  if (!cardsEl) return;

  cardsEl.innerHTML = "";

  const weekDays = getActiveWeekDays();
  if (!weekDays.length) return;

  const visibleDays = weekDays.slice(0, 6);
  const visibleEmployees = getWeekVisibleEmployees(visibleDays);

  visibleEmployees.forEach((emp) => {
    const metrics = getEmployeeWeekMetrics(emp, visibleDays);
    const card = document.createElement("article");
    card.className = "weekMobileCard";

    const header = document.createElement("div");
    header.className = "weekMobileCardHeader";
    header.innerHTML = `
      <div class="nameRoleName">${emp.name || "—"}</div>
      <div class="nameRoleSub">${emp.roleKey || "-"}</div>
      ${metrics.lastShift ? `<div class="nameRoleLast">zuletzt verwendet: ${metrics.lastShift}</div>` : ""}
    `;
    card.appendChild(header);

    const chips = document.createElement("div");
    chips.className = "weekMobileChipGrid";

    visibleDays.forEach((day) => {
      const chipValue = getMobileChipLabel(getWeekSelectValueForDay(emp, day.iso));
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `weekMobileDayChip ${buildWeekSelectClass(getWeekSelectValueForDay(emp, day.iso))}`;
      chip.dataset.isoDate = day.iso;
      chip.dataset.employeeId = emp.id;
      chip.title = `${day.weekdayLabel} ${pad2(day.date.getDate())}.${pad2(day.date.getMonth() + 1)}`;
      chip.setAttribute("aria-label", getMobileChipAriaLabel(day, chipValue, day.isOutsideMonth));
      if (day.isOutsideMonth) {
        chip.classList.add("weekMobileDayChipOutsideMonth");
      }
      chip.innerHTML = `
        <span class="weekMobileChipDay">${day.weekdayLabel}</span>
        <span class="weekMobileChipValue">${chipValue}</span>
      `;
      chip.addEventListener("click", () => {
        openWeekMobileSelectDialog(emp, day.iso);
      });
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    const metricsGrid = document.createElement("dl");
    metricsGrid.className = "weekMobileMetrics";
    [
      ["Ist", metrics.actualText, "weekHoursCell"],
      ["Konto", metrics.accountText, "weekHoursCell"],
      ["Δ Woche", metrics.weekDeltaText, "weekDeltaCell"],
      ["Δ Monat", metrics.monthDeltaText, "weekDeltaCell"],
      ["Gesamtminus", metrics.totalMinusText, "weekDeltaCell"],
      ["Soll", metrics.targetText, "weekTargetCell"]
    ].forEach(([label, value, className]) => {
      const item = document.createElement("div");
      item.className = "weekMobileMetricItem";
      item.innerHTML = `<dt>${label}</dt><dd class="${className}">${value}</dd>`;
      metricsGrid.appendChild(item);
    });
    card.appendChild(metricsGrid);

    cardsEl.appendChild(card);
  });
}

function renderWeekView() {
  renderWeekHeader();
  renderWeekWarnings();
  renderWeekTable();
  renderWeekMobileCards();
}
