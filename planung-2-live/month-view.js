function getMonthViewContentEl() {
  return document.getElementById("monthViewContent");
}

const monthFallbackOverlayEl = document.getElementById("monthFallbackOverlay");
const monthFallbackOptionsEl = document.getElementById("monthFallbackOptions");
const monthFallbackCancelEl = document.getElementById("monthFallbackCancel");
const monthFallbackSheetEl = document.getElementById("monthFallbackSheet");
const monthFallbackTitleEl = document.getElementById("monthFallbackTitle");
let monthFallbackDialogState = null;
let lastMonthWorkShift = null;
// Deliberately transient: this is a UI mode, not part of the persisted plan state.
let monthMultiPlanShift = null;
let monthMultiPlanFeedback = "";
let monthMultiPlanFeedbackTimer = null;

function cloneMonthWorkShift(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof structuredClone === "function") return structuredClone(entry);
  return JSON.parse(JSON.stringify(entry));
}

function isValidLastMonthWorkShift(entry) {
  return Boolean(entry)
    && getEntryStatus(entry) === ENTRY_STATUS.WORK
    && entry.type === "shift"
    && !entry.externalHelp;
}

function rememberLastMonthWorkShift(entry) {
  if (!isValidLastMonthWorkShift(entry)) return false;
  lastMonthWorkShift = cloneMonthWorkShift(entry);
  return true;
}

function getLastMonthWorkShift() {
  return cloneMonthWorkShift(lastMonthWorkShift);
}

function getLastMonthWorkShiftLabel(entry = lastMonthWorkShift) {
  if (!isValidLastMonthWorkShift(entry)) return "";
  if (entry.mode === "flex" && entry.start && entry.end) {
    return `Flex ${entry.start}–${entry.end}`;
  }
  return entry.code || entry.shiftKey || (entry.start && entry.end ? `${entry.start}–${entry.end}` : "");
}

function getMonthMultiPlanShiftLabel(entry = monthMultiPlanShift) {
  const label = getLastMonthWorkShiftLabel(entry);
  if (!label || entry?.mode !== "flex" || !Number.isFinite(Number(entry.minutes))) return label;
  return `${label} · ${formatMinutesAsDecimalHours(Number(entry.minutes))} h`;
}

function applyLastMonthWorkShift() {
  if (!monthFallbackDialogState || !isValidLastMonthWorkShift(lastMonthWorkShift)) return false;
  const { emp, isoDate } = monthFallbackDialogState;
  const entryCopy = cloneMonthWorkShift(lastMonthWorkShift);
  closeMonthFallbackDialog();
  const applied = setShift(emp.id, isoDate, entryCopy);
  if (applied) {
    rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    renderAllViews();
  }
  return Boolean(applied);
}

function startMonthMultiPlan() {
  if (!monthFallbackDialogState || !isValidLastMonthWorkShift(lastMonthWorkShift)) return false;
  monthMultiPlanShift = cloneMonthWorkShift(lastMonthWorkShift);
  monthMultiPlanFeedback = "";
  closeMonthFallbackDialog();
  renderAllViews();
  return true;
}

function stopMonthMultiPlan() {
  if (!monthMultiPlanShift) return false;
  monthMultiPlanShift = null;
  monthMultiPlanFeedback = "";
  if (monthMultiPlanFeedbackTimer) clearTimeout(monthMultiPlanFeedbackTimer);
  monthMultiPlanFeedbackTimer = null;
  renderAllViews();
  return true;
}

function isMonthMultiPlanCellEmpty(emp, isoDate) {
  if (!emp || !isoDate || typeof getResolvedEntryForEmployeeOnIso !== "function") return false;
  const resolved = getResolvedEntryForEmployeeOnIso(emp, isoDate);
  return Boolean(resolved)
    && normalizeStatusValue(resolved.status) === ENTRY_STATUS.EMPTY
    && !resolved.sourceEntry
    && !resolved.isHoliday
    && !resolved.isSunday;
}

function setMonthMultiPlanFeedback(message, cell = null, kind = "skipped") {
  monthMultiPlanFeedback = message;
  if (monthMultiPlanFeedbackTimer) clearTimeout(monthMultiPlanFeedbackTimer);
  const bar = document.querySelector?.(".monthMultiPlanFeedback");
  if (bar) bar.textContent = message;
  if (cell?.classList) {
    cell.classList.remove("monthMultiPlanJustSet", "monthMultiPlanSkipped");
    cell.classList.add(kind === "success" ? "monthMultiPlanJustSet" : "monthMultiPlanSkipped");
  }
  monthMultiPlanFeedbackTimer = setTimeout(() => {
    monthMultiPlanFeedback = "";
    if (bar) bar.textContent = "";
    cell?.classList?.remove("monthMultiPlanJustSet", "monthMultiPlanSkipped");
    monthMultiPlanFeedbackTimer = null;
  }, 1600);
  monthMultiPlanFeedbackTimer?.unref?.();
}

function captureMonthMultiPlanScroll(cell = null) {
  const content = getMonthViewContentEl();
  const scrollEl = cell?.closest?.(".tableWrap, .compactTableWrap")
    || content?.closest?.(".tableWrap, .compactTableWrap")
    || content?.parentElement;
  if (!scrollEl) return null;

  const sectionId = cell?.closest?.("section[id]")?.id || content?.closest?.("section[id]")?.id || "";
  const containerClass = scrollEl.classList?.contains?.("tableWrap") ? "tableWrap" : "compactTableWrap";
  return {
    scrollEl,
    sectionId,
    contentId: content?.id || "monthViewContent",
    containerClass,
    left: scrollEl.scrollLeft,
    top: scrollEl.scrollTop
  };
}

function findCurrentMonthMultiPlanScrollEl(snapshot) {
  if (!snapshot) return null;
  if (snapshot.sectionId) {
    const section = document.getElementById?.(snapshot.sectionId);
    const sectionScrollEl = section?.querySelector?.(`.${snapshot.containerClass}`);
    if (sectionScrollEl) return sectionScrollEl;
  }
  const currentContent = document.getElementById?.(snapshot.contentId);
  return currentContent?.closest?.(`.${snapshot.containerClass}`)
    || currentContent?.parentElement
    || snapshot.scrollEl;
}

function restoreMonthMultiPlanScroll(snapshot, empId, isoDate) {
  const restore = () => {
    const currentScrollEl = findCurrentMonthMultiPlanScrollEl(snapshot);
    if (currentScrollEl) {
      currentScrollEl.scrollLeft = snapshot.left;
      currentScrollEl.scrollTop = snapshot.top;
    }
    const cell = document.querySelector?.(`.monthCellClickable[data-emp-id="${empId}"][data-iso="${isoDate}"]`);
    setMonthMultiPlanFeedback("Schicht eingetragen", cell, "success");
  };
  restore();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
}

function applyMonthMultiPlanShift(emp, isoDate, cell = null) {
  if (!emp || !isoDate || !isValidLastMonthWorkShift(monthMultiPlanShift)) return false;
  if (!isMonthMultiPlanCellEmpty(emp, isoDate)) {
    setMonthMultiPlanFeedback("Bereits belegt – nicht überschrieben", cell);
    return false;
  }
  const scrollSnapshot = captureMonthMultiPlanScroll(cell);
  const applied = setShift(emp.id, isoDate, cloneMonthWorkShift(monthMultiPlanShift));
  if (applied) {
    monthMultiPlanFeedback = "Schicht eingetragen";
    renderAllViews();
    restoreMonthMultiPlanScroll(scrollSnapshot, emp.id, isoDate);
  } else {
    setMonthMultiPlanFeedback("Eintragen nicht möglich", cell);
  }
  return Boolean(applied);
}

function setMonthFallbackBodyScrollLock(isLocked) {
  const body = document.body;
  if (!body?.style) return;

  if (isLocked) {
    if (!body.dataset.monthFallbackPrevOverflow) {
      body.dataset.monthFallbackPrevOverflow = body.style.overflow || "";
    }
    body.style.overflow = "hidden";
    return;
  }

  if (Object.prototype.hasOwnProperty.call(body.dataset, "monthFallbackPrevOverflow")) {
    body.style.overflow = body.dataset.monthFallbackPrevOverflow;
    delete body.dataset.monthFallbackPrevOverflow;
  }
}

function getActiveMonthDays() {
  const monthPlan = state.monthPlan;
  if (!monthPlan?.weeks) return [];

  const days = [];
  monthPlan.weeks.forEach((week) => {
    week.forEach((day) => {
      if (day.inCurrentMonth) {
        days.push(day);
      }
    });
  });

  return days;
}

function buildMonthWeekSummaryRow(days, employees, options = {}) {
  const { includeSummaryColumns = true } = options;
  const weekSummaries = getMonthWeekSummaries(days, employees, {
    getActualMinutes: (employee, weekDays) => (
      getEmployeeBranchMinutesForWeek(employee, weekDays, state.activeMonth)
    ),
    getTargetMinutes: (employee, weekDays) => (
      getEmployeeTargetMinutesForWeek(employee, weekDays, state.activeMonth)
    )
  });

  let html = `
    <tr class="monthWeekSummaryRow">
      <th class="monthWeekSummaryLead" aria-label="Wochenübersicht">KW</th>
  `;

  weekSummaries.forEach((summary) => {
    const summaryLabel = [
      `KW ${summary.week}`,
      `Einsatz ${formatMinutesAsDecimalHours(summary.actualMinutes)} h`,
      `MA-Soll ${formatMinutesAsDecimalHours(summary.targetMinutes)} h`,
      `Filial-Soll ${formatMinutesAsDecimalHours(summary.branchTargetMinutes)} h`
    ].join(" · ");
    html += `
      <th class="monthWeekSummaryCell${summary.days.length <= 2 ? " monthWeekSummaryCellCompact" : ""}" colspan="${summary.days.length}" title="${summaryLabel}" aria-label="${summaryLabel}">
        <span class="monthWeekSummaryFull">${summaryLabel}</span>
        <span class="monthWeekSummaryCompact">KW ${summary.week} · ${formatMinutesAsDecimalHours(summary.actualMinutes)} h</span>
      </th>
    `;
  });

  if (includeSummaryColumns) {
    html += `
      <th class="monthWeekSummarySpacer" aria-hidden="true"></th>
      <th class="monthWeekSummarySpacer" aria-hidden="true"></th>
      <th class="monthWeekSummarySpacer" aria-hidden="true"></th>
    `;
  }

  return `${html}</tr>`;
}

function buildMonthHeaderRow(days, options = {}) {
  const { includeSummaryColumns = true } = options;
  let html = `
    <tr class="monthDateHeaderRow">
      <th>Name</th>
  `;

  days.forEach((day) => {
    const isSunday = day.weekdayIndex === 6;
    const className = isSunday ? ` class="monthHeadSunday"` : "";
    html += `<th${className}>${pad2(day.date.getDate())}<br>${day.weekdayLabel}</th>`;
  });

  if (includeSummaryColumns) {
    html += `
      <th>Monat Ist</th>
      <th>Δ Monat</th>
      <th>Gesamtminus</th>
    `;
  }

  html += `
    </tr>
  `;

  return html;
}

function buildMonthEmployeeRow(emp, days, options = {}) {
  const { includeSummaryColumns = true } = options;
  let html = `
    <tr>
      <td class="nameRoleCell">
        <div class="nameRoleName">${emp.name || "—"}</div>
        <div class="nameRoleSub">${emp.roleKey || "-"}</div>
      </td>
  `;

  let monthMinutes = 0;

  days.forEach((day) => {
    const resolved = getResolvedEntryForEmployeeOnIso(emp, day.iso);
    const selectValue = getWeekSelectValueForDay(emp, day.iso);
    const className = getMonthCellClass(resolved, day, selectValue);

    monthMinutes += resolved.minutesForMonth || 0;
    const cellText = getMonthCellText(resolved, {
      formatQuarterLabel: formatHMToQuarterLabel
    });

    html += `
  <td
    class="${className} monthCellClickable"
    data-emp-id="${emp.id}"
    data-iso="${day.iso}"
    title="Klicken zum Bearbeiten"
  >
    ${cellText}
  </td>
`;
  });

  if (includeSummaryColumns) {
    const monthIsManual = isMonthActualManual(emp, state.activeMonth);
    const manualMarker = monthIsManual
      ? '<span class="manualMonthMarker" aria-label="Monats-Ist manuell" title="Monats-Iststunden manuell hinterlegt.">•</span>'
      : "";
    const monthDisplayMinutes = getEffectiveMonthActualMinutes(emp, state.activeMonth, monthMinutes);
    const monthDifferenceMinutes = getEmployeeMonthDifferenceMinutes(emp);
    const totalMinusMinutes = getEmployeeTotalMinusMinutes(emp);
    const monthDeltaTitle = monthIsManual
      ? "Delta des Monats. Iststunden manuell hinterlegt."
      : "Delta des Monats.";
    const monthActualTitle = monthIsManual
      ? "Monats-Iststunden manuell hinterlegt."
      : "Monats-Iststunden planbasiert berechnet.";

    html += `
      <td class="weekHoursCell" title="${monthActualTitle}">${minutesToHM(monthDisplayMinutes)}${manualMarker}</td>
      <td class="weekDeltaCell" title="${monthDeltaTitle}">${formatSignedMinutes(monthDifferenceMinutes)}</td>
      <td class="weekDeltaCell">${totalMinusMinutes > 0 ? `-${minutesToHM(totalMinusMinutes)}` : "0:00"}</td>
    `;
  }

  html += `
    </tr>
  `;

  return html;
}
function bindMonthCellActions(scopeEl = document) {
  const tables = scopeEl?.querySelectorAll?.("table")?.length
    ? [...scopeEl.querySelectorAll("table")]
    : [document.getElementById("monthTable")].filter(Boolean);
  if (!tables.length) return;

  tables.forEach((table) => {
    table.querySelectorAll(".monthCellClickable").forEach((cell) => {
      cell.addEventListener("click", () => {
        const empId = cell.dataset.empId;
        const isoDate = cell.dataset.iso;

        const emp = state.employees.find((e) => e.id === empId);
        if (!emp || !isoDate) return;

        const currentValue = getWeekSelectValueForDay(emp, isoDate);
        if (monthMultiPlanShift) {
          applyMonthMultiPlanShift(emp, isoDate, cell);
          return;
        }
        if (currentValue === "H") return;

        const dialogType = getShiftCodeForSelectValue(currentValue);
        if (dialogType) {
          if (openShiftDialogForSelectValue(dialogType, { emp, isoDate, source: "month" })) return;
        }

        openMonthFallbackDialog(emp, isoDate, cell);
      });
    });
  });
}

function positionMonthFallbackSheet(anchorEl) {
  if (!monthFallbackSheetEl || !anchorEl?.getBoundingClientRect || typeof window === "undefined") return;
  const anchor = anchorEl.getBoundingClientRect();
  const sheet = monthFallbackSheetEl.getBoundingClientRect();
  if (!sheet.width || !sheet.height) return;
  const margin = 12;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const preferredLeft = anchor.left + (anchor.width - sheet.width) / 2;
  const left = Math.max(viewportLeft + margin, Math.min(preferredLeft, viewportLeft + viewportWidth - sheet.width - margin));
  const below = anchor.bottom + 8;
  const top = below + sheet.height <= viewportTop + viewportHeight - margin
    ? below
    : Math.max(viewportTop + margin, anchor.top - sheet.height - 8);

  monthFallbackSheetEl.style.left = `${Math.round(left)}px`;
  monthFallbackSheetEl.style.top = `${Math.round(top)}px`;
}

function scheduleMonthFallbackPosition(anchorEl) {
  const position = () => positionMonthFallbackSheet(anchorEl);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(position);
  else setTimeout(position, 0);
}

function setMonthFallbackTitle(title) {
  if (monthFallbackTitleEl) monthFallbackTitleEl.textContent = title;
}

function renderMonthFallbackMainLevel(anchorEl) {
  if (!monthFallbackDialogState || !monthFallbackOptionsEl) return;
  const { options } = monthFallbackDialogState;
  monthFallbackOptionsEl.innerHTML = "";
  monthFallbackOptionsEl.className = "monthFallbackOptions";
  setMonthFallbackTitle("Schicht wählen");

  const primaryLabels = { G: "Lang", FR: "Frei", U: "Urlaub" };
  const createButton = (label, handler, className = "monthFallbackOptionBtn monthFallbackOptionPrimary") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    monthFallbackOptionsEl.appendChild(button);
    return button;
  };

  const lastShiftLabel = getLastMonthWorkShiftLabel();
  if (lastShiftLabel) {
    createButton(`↻ ${lastShiftLabel}`, applyLastMonthWorkShift, "monthFallbackOptionBtn monthFallbackLastShiftBtn");
    createButton("⊕ Mehrfach eintragen", startMonthMultiPlan, "monthFallbackOptionBtn monthFallbackMultiPlanBtn");
  }

  createButton("Früh", () => renderMonthFallbackEarlyLevel(anchorEl));
  createButton("Spät", () => renderMonthFallbackLateLevel(anchorEl));
  ["G", "FLEX", "FR", "U"].forEach((code) => {
    const option = options.find((candidate) => candidate.code === code);
    if (!option) return;
    createButton(primaryLabels[code] || option.label, code === "FLEX"
      ? () => renderMonthFallbackFlexEditor(anchorEl)
      : () => selectMonthFallbackOption(option.value));
  });
  createButton("Mehr", () => renderMonthFallbackMoreLevel(anchorEl));
  scheduleMonthFallbackPosition(anchorEl);
}

function renderMonthFallbackSubmenu(title, codes, anchorEl, { includeFlex = false, flexContext = "main" } = {}) {
  if (!monthFallbackDialogState || !monthFallbackOptionsEl) return;
  monthFallbackOptionsEl.innerHTML = "";
  monthFallbackOptionsEl.className = "monthFallbackOptions monthFallbackOptionsMore";
  setMonthFallbackTitle(title);
  codes.forEach((code) => {
    const option = monthFallbackDialogState.options.find((candidate) => candidate.code === code);
    if (!option) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "monthFallbackOptionBtn";
    button.textContent = option.label;
    button.addEventListener("click", () => selectMonthFallbackOption(option.value));
    monthFallbackOptionsEl.appendChild(button);
  });
  if (includeFlex) {
    const flex = document.createElement("button");
    flex.type = "button";
    flex.className = "monthFallbackOptionBtn";
    flex.textContent = "Flex";
    flex.addEventListener("click", () => renderMonthFallbackFlexEditor(anchorEl, flexContext));
    monthFallbackOptionsEl.appendChild(flex);
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "monthFallbackBackBtn";
  back.textContent = "← Zurück";
  back.addEventListener("click", () => renderMonthFallbackMainLevel(anchorEl));
  monthFallbackOptionsEl.appendChild(back);
  scheduleMonthFallbackPosition(anchorEl);
  monthFallbackOptionsEl.querySelector("button")?.focus();
}

function renderMonthFallbackEarlyLevel(anchorEl) {
  renderMonthFallbackSubmenu("Früh", ["F3", "F4", "F5", "F6", "FO"], anchorEl, {
    includeFlex: true,
    flexContext: "early"
  });
}

function renderMonthFallbackLateLevel(anchorEl) {
  renderMonthFallbackSubmenu("Spät", ["L"], anchorEl, { includeFlex: true, flexContext: "late" });
}

function renderMonthFallbackMoreLevel(anchorEl) {
  if (!monthFallbackDialogState || !monthFallbackOptionsEl) return;
  const groupedCodes = new Set(["FO", "L", "G", "FLEX", "FR", "U", "F3", "F4", "F5", "F6"]);
  monthFallbackOptionsEl.innerHTML = "";
  monthFallbackOptionsEl.className = "monthFallbackOptions monthFallbackOptionsMore";
  setMonthFallbackTitle("Weitere");
  const back = document.createElement("button");
  back.type = "button";
  back.className = "monthFallbackBackBtn";
  back.textContent = "← Zurück";
  back.addEventListener("click", () => renderMonthFallbackMainLevel(anchorEl));
  monthFallbackOptionsEl.appendChild(back);
  monthFallbackDialogState.options.filter((option) => !groupedCodes.has(option.code)).forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "monthFallbackOptionBtn";
    button.textContent = option.label;
    button.addEventListener("click", () => selectMonthFallbackOption(option.value));
    monthFallbackOptionsEl.appendChild(button);
  });
  scheduleMonthFallbackPosition(anchorEl);
  back.focus();
}

function getMonthFallbackFlexDefaultStartMinutes(context) {
  return context === "late" ? 13 * 60 : 9 * 60;
}

function renderMonthFallbackFlexEditor(anchorEl, context = "main") {
  if (!monthFallbackDialogState || !monthFallbackOptionsEl) return;
  monthFallbackOptionsEl.innerHTML = "";
  monthFallbackOptionsEl.className = "monthFallbackIndividual";
  setMonthFallbackTitle("Flexible Schicht");
  const fields = [
    { key: "start", label: "Start", min: 0, max: 23 * 60 + 45, value: getMonthFallbackFlexDefaultStartMinutes(context) },
    { key: "pause", label: "Pause", min: 0, max: 120, value: 0 }
  ];
  const selects = {};
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.textContent = field.label;
    const select = document.createElement("select");
    select.dataset.field = field.key;
    for (let minutes = field.min; minutes <= field.max; minutes += 15) {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = field.key === "start" ? minutesToHHMM(minutes) : `${minutesToHM(minutes)} h`;
      option.selected = minutes === field.value;
      select.appendChild(option);
    }
    if (field.key === "start" && context === "early") {
      const openerOption = document.createElement("option");
      openerOption.value = String(8 * 60 + 55);
      openerOption.textContent = "08:55";
      select.appendChild(openerOption);
    }
    label.appendChild(select);
    monthFallbackOptionsEl.appendChild(label);
    selects[field.key] = select;
  });
  const workLabel = document.createElement("label");
  workLabel.textContent = "Arbeit";
  const workSelects = document.createElement("span");
  workSelects.className = "monthFallbackWorkSelects";
  const workHours = document.createElement("select");
  workHours.dataset.field = "workHours";
  workHours.setAttribute("aria-label", "Arbeitsstunden");
  for (let hours = 3; hours <= 12; hours += 1) {
    const option = document.createElement("option");
    option.value = String(hours);
    option.textContent = `${hours} h`;
    option.selected = hours === 6;
    workHours.appendChild(option);
  }
  const workMinutes = document.createElement("select");
  workMinutes.dataset.field = "workMinutes";
  workMinutes.setAttribute("aria-label", "Arbeitsminuten");
  for (const minutes of [0, 15, 30, 45]) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = `${minutes} min`;
    workMinutes.appendChild(option);
  }
  workSelects.append(workHours, workMinutes);
  workLabel.appendChild(workSelects);
  monthFallbackOptionsEl.insertBefore(workLabel, selects.pause.parentElement);
  selects.workHours = workHours;
  selects.workMinutes = workMinutes;
  const checkoutLabel = document.createElement("label");
  checkoutLabel.className = "monthFallbackCheckoutLabel";
  const checkout = document.createElement("input");
  checkout.type = "checkbox";
  let valuesBeforeCheckout = null;
  let pauseBeforeAutomaticOpener = "0";
  let automaticallyAppliedOpenerPause = false;
  let openerPauseManuallyOverridden = false;
  checkoutLabel.appendChild(checkout);
  checkoutLabel.appendChild(document.createTextNode("Bis Kassenschluss 19:10"));
  monthFallbackOptionsEl.appendChild(checkoutLabel);
  const endRow = document.createElement("div");
  endRow.className = "monthFallbackEndRow";
  endRow.innerHTML = "<span>Ende</span><strong>15:00</strong>";
  monthFallbackOptionsEl.appendChild(endRow);
  const validation = document.createElement("p");
  validation.className = "monthFallbackValidation";
  monthFallbackOptionsEl.appendChild(validation);
  const actions = document.createElement("div");
  actions.className = "monthFallbackIndividualActions";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "← Zurück";
  back.addEventListener("click", () => {
    if (context === "early") renderMonthFallbackEarlyLevel(anchorEl);
    else if (context === "late") renderMonthFallbackLateLevel(anchorEl);
    else renderMonthFallbackMainLevel(anchorEl);
  });
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Übernehmen";
  const setSelectMinutes = (select, minutes) => {
    const value = String(minutes);
    if (![...select.options].some((option) => option.value === value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${minutesToHM(minutes)} h`;
      select.appendChild(option);
    }
    select.value = value;
  };
  const getSelectedWorkMinutes = () => Number(selects.workHours.value) * 60 + Number(selects.workMinutes.value);
  const setSelectedWorkMinutes = (minutes) => {
    const hours = Math.floor(minutes / 60);
    if (![...selects.workHours.options].some((option) => option.value === String(hours))) {
      const option = document.createElement("option");
      option.value = String(hours);
      option.textContent = `${hours} h`;
      selects.workHours.appendChild(option);
    }
    selects.workHours.value = String(hours);
    selects.workMinutes.value = String(minutes % 60);
  };
  const update = () => {
    const start = minutesToHHMM(Number(selects.start.value));
    // The established opener exception starts five minutes before the quarter.
    // Its five-minute offset remains a pause, so net work and the resulting
    // quarter-hour end continue to use the central FLEX builder unchanged.
    if (start === "08:55") {
      if (!automaticallyAppliedOpenerPause && !openerPauseManuallyOverridden && Number(selects.pause.value) === 0) {
        pauseBeforeAutomaticOpener = selects.pause.value;
        setSelectMinutes(selects.pause, 5);
        automaticallyAppliedOpenerPause = true;
      }
    } else {
      if (automaticallyAppliedOpenerPause) {
        selects.pause.value = pauseBeforeAutomaticOpener;
      }
      automaticallyAppliedOpenerPause = false;
      openerPauseManuallyOverridden = false;
    }
    const selectedWorkMinutes = getSelectedWorkMinutes();
    const entry = checkout.checked
      ? buildIndividualCheckoutShiftEntry(start)
      : buildIndividualShiftEntry(start, selectedWorkMinutes, Number(selects.pause.value));
    if (checkout.checked && entry) {
      setSelectedWorkMinutes(entry.minutes);
      setSelectMinutes(selects.pause, entry.pause);
    }
    selects.workHours.disabled = checkout.checked;
    selects.workMinutes.disabled = checkout.checked;
    selects.pause.disabled = checkout.checked;
    endRow.querySelector("strong").textContent = checkout.checked
      ? "19:10"
      : addMinutesToHHMM(start, selectedWorkMinutes + Number(selects.pause.value));
    validation.textContent = entry ? "" : "Pause oder Dauer entspricht nicht den Schichtregeln.";
    apply.disabled = !entry;
    scheduleMonthFallbackPosition(anchorEl);
    return entry;
  };
  Object.entries(selects).forEach(([key, select]) => {
    if (key === "pause") return;
    select.addEventListener("change", update);
  });
  selects.pause.addEventListener("change", () => {
    if (minutesToHHMM(Number(selects.start.value)) === "08:55") {
      automaticallyAppliedOpenerPause = false;
      openerPauseManuallyOverridden = true;
    }
    update();
  });
  checkout.addEventListener("change", () => {
    if (checkout.checked) {
      valuesBeforeCheckout = {
        workHours: selects.workHours.value,
        workMinutes: selects.workMinutes.value,
        pause: selects.pause.value
      };
    } else if (valuesBeforeCheckout) {
      selects.workHours.value = valuesBeforeCheckout.workHours;
      selects.workMinutes.value = valuesBeforeCheckout.workMinutes;
      selects.pause.value = valuesBeforeCheckout.pause;
      valuesBeforeCheckout = null;
    }
    update();
  });
  apply.addEventListener("click", () => {
    const entry = update();
    if (!entry || !monthFallbackDialogState) return;
    const { emp, isoDate } = monthFallbackDialogState;
    closeMonthFallbackDialog();
    const applied = setShift(emp.id, isoDate, cloneMonthWorkShift(entry));
    if (applied) {
      rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
      renderAllViews();
    }
  });
  actions.appendChild(back);
  actions.appendChild(apply);
  monthFallbackOptionsEl.appendChild(actions);
  update();
  back.focus();
}

function openMonthFallbackDialog(emp, isoDate, anchorEl = null) {
  if (!monthFallbackOverlayEl || !monthFallbackOptionsEl) return;
  if (monthFallbackDialogState) closeMonthFallbackDialog();

  const options = getMonthFallbackDialogOptions();
  if (!options.length) return;

  const activeElement = document.activeElement;
  const canRestoreFocus = (
    (typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement)
    || (activeElement && typeof activeElement.focus === "function")
  );

  monthFallbackDialogState = {
    emp,
    isoDate,
    options,
    previousFocusEl: canRestoreFocus ? activeElement : null
  };

  monthFallbackOverlayEl.classList.remove("hidden");
  monthFallbackOverlayEl.setAttribute("aria-hidden", "false");
  setMonthFallbackBodyScrollLock(true);
  renderMonthFallbackMainLevel(anchorEl);
  monthFallbackOptionsEl.querySelector("button")?.focus();
}

function getShiftedYearMonth(yearMonth, offset) {
  const activeMonth = yearMonth || state.activeMonth || toIsoDate(new Date()).slice(0, 7);
  const [year, month] = activeMonth.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + offset, 1);

  return `${nextDate.getFullYear()}-${pad2(nextDate.getMonth() + 1)}`;
}

function shiftActiveMonth(offset) {
  state.activeMonth = getShiftedYearMonth(state.activeMonth, offset);

  // state.weekFrom bleibt bewusst unverändert: Für die aktuelle MEP-Monatsansicht
  // ist state.activeMonth die maßgebliche Quelle, und getActiveWeekDays fällt bei
  // einem Monatssprung ohnehin auf die erste sichtbare Woche des neuen Monats zurück.
  syncMonthPlanToState();
  saveAppStateDebounced();
  renderAllViews();
}

function bindMonthNavigation() {
  document.getElementById("monthPrev")?.addEventListener("click", () => {
    shiftActiveMonth(-1);
  });

  document.getElementById("monthNext")?.addEventListener("click", () => {
    shiftActiveMonth(1);
  });

  document.getElementById("overviewMonthPrev")?.addEventListener("click", () => {
    shiftActiveMonth(-1);
  });

  document.getElementById("overviewMonthNext")?.addEventListener("click", () => {
    shiftActiveMonth(1);
  });
}

function updateMonthHeaderTitle(days) {
  const titleEl = document.getElementById("monthTitle");
  if (!titleEl) return;

  titleEl.textContent = getMonthTitleFromDays(days);
}

function buildMonthViewMarkup(days, options = {}) {
  const {
    tableId = "monthTable",
    tableClass = "",
    activeEmployees = state.employees.filter((emp) => isEmployeeActiveInMonth(emp, state.activeMonth)),
    includeSummaryColumns = true,
    withViewHeader = true
  } = options;
  const effectiveTableClass = [tableClass, monthMultiPlanShift ? "monthMultiPlanActive" : ""].filter(Boolean).join(" ");
  const tableClassAttr = effectiveTableClass ? ` class="${effectiveTableClass}"` : "";
  let html = `
  `;

  if (withViewHeader) {
    html += `
    <div class="monthViewHeader">
      <strong>${getMonthTitleFromDays(days)}</strong>
      <span class="small">${days.length} Tage im aktuellen Monat</span>
    </div>
    `;
  }

  if (monthMultiPlanShift) {
    html += `
      <div class="monthMultiPlanBar" role="status">
        <strong>Mehrfach: ${getMonthMultiPlanShiftLabel(monthMultiPlanShift)}</strong>
        <span class="monthMultiPlanFeedback" aria-live="polite">${monthMultiPlanFeedback}</span>
        <button type="button" class="monthMultiPlanStopBtn">Beenden</button>
      </div>
    `;
  }

  html += `
    <table id="${tableId}"${tableClassAttr}>
      <thead>
        ${buildMonthWeekSummaryRow(days, activeEmployees, { includeSummaryColumns })}
        ${buildMonthHeaderRow(days, { includeSummaryColumns })}
      </thead>
      <tbody>
  `;

  activeEmployees.forEach((emp) => {
    html += buildMonthEmployeeRow(emp, days, { includeSummaryColumns });
  });

  html += `
      </tbody>
    </table>
  `;

  return html;
}

function renderMonthTableInto(container, options = {}) {
  if (!container) return;
  const {
    withHeaderTitle = true,
    tableId = "monthTable",
    tableClass = "",
    days = null,
    activeEmployees = null,
    includeSummaryColumns = true,
    withViewHeader = true
  } = options;

  container.innerHTML = "";

  const tableDays = Array.isArray(days) ? days : getActiveMonthDays();
  if (!tableDays.length) {
    container.innerHTML = "<div class='small'>Kein Monat geladen.</div>";
    return;
  }

  if (withHeaderTitle) updateMonthHeaderTitle(tableDays);
  container.innerHTML = buildMonthViewMarkup(tableDays, {
    tableId,
    tableClass,
    activeEmployees: Array.isArray(activeEmployees) ? activeEmployees : undefined,
    includeSummaryColumns,
    withViewHeader
  });

  bindMonthCellActions(container);
  container.querySelector?.(".monthMultiPlanStopBtn")?.addEventListener("click", stopMonthMultiPlan);
}

function renderMonthView() {
  renderMonthTableInto(getMonthViewContentEl(), {
    withHeaderTitle: true,
    tableId: "monthTable"
  });
}

function getMonthFallbackDialogOptions() {
  return resolveMonthFallbackDialogOptions();
}

function closeMonthFallbackDialog() {
  if (!monthFallbackOverlayEl || !monthFallbackDialogState) return;

  monthFallbackOverlayEl.classList.add("hidden");
  monthFallbackOverlayEl.setAttribute("aria-hidden", "true");
  setMonthFallbackBodyScrollLock(false);
  if (monthFallbackOptionsEl) monthFallbackOptionsEl.innerHTML = "";

  const previousFocusEl = monthFallbackDialogState.previousFocusEl;
  monthFallbackDialogState = null;
  if (previousFocusEl && typeof previousFocusEl.focus === "function") {
    previousFocusEl.focus();
  }
}

function getMonthFallbackFocusableElements() {
  const optionControls = monthFallbackOptionsEl
    ? [...monthFallbackOptionsEl.querySelectorAll("button, select")]
    : [];
  return [...optionControls, monthFallbackCancelEl].filter((element) => element && !element.disabled);
}

function selectMonthFallbackOption(value) {
  if (!monthFallbackDialogState) return;
  const selectedOption = monthFallbackDialogState.options.find((option) => option.value === value);
  if (!selectedOption) return;

  const { emp, isoDate } = monthFallbackDialogState;
  const dialogType = selectedOption.code || getShiftCodeForSelectValue(selectedOption.value);
  if (openShiftDialogForSelectValue(dialogType, { emp, isoDate, source: "month" })) {
    closeMonthFallbackDialog();
    return;
  }
  closeMonthFallbackDialog();
  const result = applyWeekSelection(emp, isoDate, selectedOption.value);
  if (result?.applied) {
    rememberLastMonthWorkShift(getPlanEntry(emp.id, isoDate));
    renderAllViews();
  }
}

function handleMonthFallbackDialogKeydown(event) {
  if (event.key === "Escape" && monthMultiPlanShift) {
    event.preventDefault();
    stopMonthMultiPlan();
    return;
  }
  if (monthFallbackOverlayEl?.classList.contains("hidden")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeMonthFallbackDialog();
    return;
  }

  if (event.key !== "Tab") return;

  const focusableEls = getMonthFallbackFocusableElements();
  if (!focusableEls.length) return;

  const firstEl = focusableEls[0];
  const lastEl = focusableEls[focusableEls.length - 1];
  const activeEl = document.activeElement;

  if (event.shiftKey) {
    if (activeEl === firstEl || !focusableEls.includes(activeEl)) {
      event.preventDefault();
      lastEl.focus();
    }
    return;
  }

  if (activeEl === lastEl || !focusableEls.includes(activeEl)) {
    event.preventDefault();
    firstEl.focus();
  }
}

if (monthFallbackCancelEl) {
  monthFallbackCancelEl.addEventListener("click", () => {
    closeMonthFallbackDialog();
  });
}

if (monthFallbackOverlayEl) {
  monthFallbackOverlayEl.addEventListener("click", (event) => {
    if (event.target === monthFallbackOverlayEl) {
      closeMonthFallbackDialog();
    }
  });
}

document.addEventListener("keydown", handleMonthFallbackDialogKeydown);
