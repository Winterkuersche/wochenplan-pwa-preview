const MEP_EMPLOYEES_PER_SHEET = 9;
const MEP_HAND_VARIANT_COUNT = 8;

function formatMepHeaderDate(isoDate) {
  if (!isoDate) return "";
  const date = fromIsoDate(isoDate);
  if (!date) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.`;
}

function formatMepMonthYear(isoDate) {
  if (!isoDate) return "____________";
  const date = fromIsoDate(isoDate);
  if (!date) return "____________";
  return `${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatMepVisibleMonthTitle(yearMonth = state.activeMonth) {
  const normalizedYearMonth = yearMonth || state.activeMonth || toIsoDate(new Date()).slice(0, 7);
  const [year, month] = normalizedYearMonth.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);

  if (Number.isNaN(date.getTime())) return "Monatsansicht";

  return date.toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric"
  });
}

function updateMepMonthHeaderTitle(yearMonth = state.activeMonth) {
  const titleEl = document.getElementById("mepMonthTitle");
  if (!titleEl) return;

  titleEl.textContent = `Sichtbarer Monat: ${formatMepVisibleMonthTitle(yearMonth)}`;
}

function bindMepMonthNavigation() {
  document.getElementById("mepMonthPrev")?.addEventListener("click", () => {
    shiftActiveMonth(-1);
  });

  document.getElementById("mepMonthNext")?.addEventListener("click", () => {
    shiftActiveMonth(1);
  });
}

function formatMepFullDate(isoDate) {
  if (!isoDate) return "____________";
  const date = fromIsoDate(isoDate);
  if (!date) return "____________";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function getMepRoleLabel(employee) {
  if (!employee) return "";
  const roleLabel = employee.roleKey || employee.contractModel || "";

  if (["TZ15", "TZ20", "TZ30"].includes(roleLabel)) {
    return "TZ";
  }

  return roleLabel;
}

function getMepWeekTargetLabel(employee, weekDays = [], activeMonth = state.activeMonth) {
  if (!employee) return "";
  const targetMinutes = getEmployeeTargetMinutesForWeek(employee, weekDays, activeMonth);
  return minutesToHM(targetMinutes);
}

function getMepPauseLabel(entry) {
  if (!entry) return "";
  // AH-Sonderdarstellung bleibt in getMepResolvedDayContent:
  // Bei EXTERNAL wird weiterhin die Filiale statt eines Pausenbereichs gezeigt.
  return getPauseRangeForMep(entry);
}

function getMepPauseTooltip(entry) {
  if (!entry || !entry.start || !entry.end) return "";

  const spanMinutes = diffMinutesBetweenHHMM(entry.start, entry.end);
  if (spanMinutes <= 0) return "";

  const pauseMinutes = getPauseMinutesForMepDisplay(entry);
  if (pauseMinutes <= 0) return "";

  return `Pause gesamt: ${pauseMinutes} Minuten (darstellungstechnisch im Raster platziert, Fallback für Altdaten aktiv)`;
}

function getMepResolvedDayContent(employee, isoDate) {
  if (!employee || !isoDate) {
    return {
      start: "",
      pause: "",
      end: "",
      sum: ""
    };
  }

  const resolved = getResolvedEntryForEmployeeOnIso(employee, isoDate);
  const status = getResolvedStatus(resolved);
  const sourceEntry = normalizePlanEntry(resolved?.sourceEntry) || resolved?.sourceEntry || null;
  const dailyTarget = minutesToHM(getAbsenceMinutesForEmployee(employee));

  if (resolved?.type === "holiday") {
    return {
      start: "H",
      pause: "",
      end: "",
      sum: dailyTarget
    };
  }

  if (status === ENTRY_STATUS.VACATION) {
    return {
      start: "U",
      pause: "",
      end: "",
      sum: dailyTarget
    };
  }

  if (status === ENTRY_STATUS.SICK) {
    return {
      start: "K",
      pause: "",
      end: "",
      sum: dailyTarget
    };
  }

  if (!sourceEntry) {
    return {
      start: "",
      pause: "",
      end: "",
      sum: ""
    };
  }

  const sourceEntryStatus = getEntryStatus(sourceEntry);
  const isExternalEntry = sourceEntryStatus === ENTRY_STATUS.EXTERNAL;
  const pauseLabel = isExternalEntry ? sourceEntry.branch?.trim() || "" : getMepPauseLabel(sourceEntry);
  const pauseTooltip = isExternalEntry ? "" : getMepPauseTooltip(sourceEntry);

  return {
    start: sourceEntry.start || "",
    pause: pauseLabel,
    pauseTooltip,
    end: sourceEntry.end || "",
    sum: sourceEntry.minutes ? minutesToHM(sourceEntry.minutes) : ""
  };
}

function escapeMepHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMepHandVariantClass(variant = 0) {
  return `mepTplHandVariant${((variant % MEP_HAND_VARIANT_COUNT) + MEP_HAND_VARIANT_COUNT) % MEP_HAND_VARIANT_COUNT}`;
}

function renderMepHandText(value, variant = 0, extraClass = "") {
  if (value === null || value === undefined || value === "") return "";
  const variantClass = getMepHandVariantClass(variant);
  const className = ["mepTplHandwrite", variantClass, extraClass].filter(Boolean).join(" ");
  return `<span class="${className}">${escapeMepHtml(value)}</span>`;
}

function getMepNameLines(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return [];

  if (normalized.includes(",")) {
    const [lastName, ...firstNameParts] = normalized.split(",");
    const firstName = firstNameParts.join(",").trim();
    return [lastName.trim(), firstName].filter(Boolean);
  }

  return [normalized];
}

function renderMepEmployeeName(value, variant = 0) {
  const lines = getMepNameLines(value);
  if (!lines.length) return "";

  if (lines.length === 1) {
    return renderMepHandText(lines[0], variant, "mepTplHandName");
  }

  return `
    <span class="mepTplNameStack">
      ${lines
        .map((line, index) => renderMepHandText(line, variant + index, "mepTplHandNameLine"))
        .join("")}
    </span>
  `;
}

function getMepEmployeeNameCellContent(employee, employeeOffset, uiState) {
  if (uiState?.mepAnonymized) return "";
  return renderMepEmployeeName(employee?.name || "", employeeOffset);
}

function getMepDayColumnClass(dayIndex) {
  const dayColumnClasses = [
    "mepTplDayCell--mon",
    "mepTplDayCell--tue",
    "mepTplDayCell--wed",
    "mepTplDayCell--thu",
    "mepTplDayCell--fri",
    "mepTplDayCell--sat",
    "mepTplDayCell--sun"
  ];

  return dayColumnClasses[dayIndex] || "";
}

function getMepDayCellClasses(dayIndex, day) {
  return [
    "mepTplDayCell",
    getMepDayColumnClass(dayIndex),
    dayIndex === 4 ? "mepTplCellSeparator" : "",
    dayIndex === 5 ? "mepTplCellSeparator" : "",
    dayIndex === 6 ? "mepTplCellBeforeSummary" : "",
    day?.isOutsideMonth ? "mepTplDayCell--outside" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function getOutsideMonthRuns(weekDays) {
  const runs = [];
  const safeWeekDays = Array.isArray(weekDays) ? weekDays : [];
  let runStartIndex = -1;

  safeWeekDays.forEach((day, index) => {
    const isOutsideMonth = Boolean(day?.isOutsideMonth);

    if (isOutsideMonth && runStartIndex === -1) {
      runStartIndex = index;
      return;
    }

    if (!isOutsideMonth && runStartIndex !== -1) {
      runs.push({
        startIndex: runStartIndex,
        length: index - runStartIndex
      });
      runStartIndex = -1;
    }
  });

  if (runStartIndex !== -1) {
    runs.push({
      startIndex: runStartIndex,
      length: safeWeekDays.length - runStartIndex
    });
  }

  return runs;
}

function getMepMonthDateRangeUntilWeek(sheetModel = {}) {
  const activeMonth = String(sheetModel?.activeMonth || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(activeMonth)) {
    return { startIso: "", endIso: "" };
  }

  const [year, month] = activeMonth.split("-").map(Number);
  const startDate = new Date(year, month - 1, 1);
  const monthEndDate = new Date(year, month, 0);
  const weekToDate = new Date(`${sheetModel?.weekTo || ""}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(monthEndDate.getTime()) || Number.isNaN(weekToDate.getTime())) {
    return { startIso: "", endIso: "" };
  }

  const endDate = weekToDate < monthEndDate ? weekToDate : monthEndDate;
  const startIso = toIsoDate(startDate);
  const endIso = toIsoDate(endDate);

  if (!startIso || !endIso || endIso < startIso) {
    return { startIso: "", endIso: "" };
  }

  return { startIso, endIso };
}

function getEmployeeAccountMinutesForIsoRange(employee, startIso, endIso) {
  if (!employee || !startIso || !endIso || endIso < startIso) return 0;

  let sum = 0;
  const cursor = new Date(`${startIso}T00:00:00`);
  const endDate = new Date(`${endIso}T00:00:00`);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime())) return 0;

  while (cursor <= endDate) {
    const isoDate = toIsoDate(cursor);
    const resolved = getResolvedEntryForEmployeeOnIso(employee, isoDate);
    const status = getResolvedStatus(resolved);

    if (isCreditableResolvedAccountEntry(resolved)) {
      if (status === ENTRY_STATUS.VACATION) {
        sum += getAbsenceMinutesForEmployee(employee);
      } else if (resolved?.type === "holiday") {
        sum += Math.max(0, resolved.minutesForMonth || getAbsenceMinutesForEmployee(employee));
      } else {
        sum += Math.max(0, resolved.minutesForMonth || 0);
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return sum;
}

function getMepCumulativeMonthMinutes(employee, sheetModel = {}) {
  if (!employee) return 0;

  const { startIso, endIso } = getMepMonthDateRangeUntilWeek(sheetModel);
  if (!startIso || !endIso) return 0;

  return getEmployeeAccountMinutesForIsoRange(employee, startIso, endIso);
}

function getMepEmployeeRowClasses(rowTypeKey) {
  return [
    "mepTplEmployeeRow",
    `mepTplEmployeeRow--${rowTypeKey}`,
    rowTypeKey === "start" ? "mepTplEmployeeRow--blockStart" : "",
    rowTypeKey === "sum" ? "mepTplEmployeeRow--blockEnd" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function renderMepOutsideRunMarker(outsideRun) {
  if (!outsideRun?.length) return "";

  return `<span class="mepTplOutsideRunMarker" aria-hidden="true"></span>`;
}

function syncMepOutsideRunMarkers(root = document) {
  const markerRoot = root?.querySelectorAll ? root : document;

  markerRoot.querySelectorAll("[data-mep-outside-run-start='true']").forEach((startCell) => {
    const markerEl = startCell.querySelector(".mepTplOutsideRunMarker");
    const startDayIndex = Number(startCell.dataset.mepDayIndex || 0);
    const runColumns = Number(startCell.dataset.mepOutsideRunColumns || 0);

    if (!markerEl || !runColumns) return;

    let endRow = startCell.parentElement;
    for (let offset = 0; offset < 3; offset += 1) {
      endRow = endRow?.nextElementSibling;
    }

    const endDayIndex = startDayIndex + runColumns - 1;
    const endCell = endRow?.querySelector(`[data-mep-day-index="${endDayIndex}"]`);

    if (!endCell) return;

    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();
    const runWidth = Math.max(0, endRect.right - startRect.left);
    const runHeight = Math.max(0, endRect.bottom - startRect.top);
    const lineLength = Math.hypot(runWidth, runHeight);
    const lineAngle = Math.atan2(runHeight, runWidth);

    markerEl.style.width = `${lineLength}px`;
    markerEl.style.transform = `rotate(${lineAngle}rad)`;
  });
}

function buildMepEmployeeRows(employee, weekDays, employeeOffset = 0, sheetModel = {}) {
  const safeWeekDays = Array.isArray(weekDays) ? [...weekDays] : [];
  const activeMonthPrefix = String(sheetModel?.activeMonth || "").trim();
  const weekSummaryDays = /^\d{4}-(0[1-9]|1[0-2])$/.test(activeMonthPrefix)
    ? safeWeekDays.filter((day) => String(day?.iso || "").startsWith(activeMonthPrefix))
    : safeWeekDays;
  const weekTargetLabel = getMepWeekTargetLabel(employee, weekSummaryDays, sheetModel?.activeMonth);

  while (safeWeekDays.length < 7) {
    safeWeekDays.push({ iso: "", isOutsideMonth: false });
  }

  const rowTypes = [
    { key: "start", label: "Beginn" },
    { key: "pause", label: "Pause" },
    { key: "end", label: "Ende" },
    { key: "sum", label: "Summe / Tag" }
  ];
  const outsideMonthRuns = getOutsideMonthRuns(safeWeekDays);
  const outsideRunMap = new Map(
    outsideMonthRuns.map((run) => [run.startIndex, run])
  );

  return rowTypes
    .map((rowType, index) => {
      const dayCells = safeWeekDays
        .map((day, dayIndex) => {
          const isoDate = day?.iso || "";
          const variant = employeeOffset * 7 + index * 3 + dayIndex;
          const dayCellClassNames = [getMepDayCellClasses(dayIndex, day)];
          const isOutsideRunStart = index === 0 && outsideRunMap.has(dayIndex);

          if (isOutsideRunStart) {
            dayCellClassNames.push("mepTplDayCell--outsideRunStart");
          }

          const outsideRun = isOutsideRunStart ? outsideRunMap.get(dayIndex) : null;
          const outsideRunMarker = renderMepOutsideRunMarker(outsideRun);
          const dayCellClassName = dayCellClassNames.filter(Boolean).join(" ");
          const dayCellAttributes = [
            `class="${dayCellClassName}"`,
            `data-mep-day-index="${dayIndex}"`
          ];

          if (outsideRun) {
            dayCellAttributes.push(`data-mep-outside-run-columns="${outsideRun.length}"`);
          }

          if (isOutsideRunStart) {
            dayCellAttributes.push('data-mep-outside-run-start="true"');
          }

          if (day?.isOutsideMonth) {
            return `<td ${dayCellAttributes.join(" ")}>${outsideRunMarker}</td>`;
          }

          const resolvedDayContent = getMepResolvedDayContent(employee, isoDate);

          if (rowType.key === "start") {
            return `<td ${dayCellAttributes.join(" ")}>${renderMepHandText(resolvedDayContent.start, variant, "mepTplHandValue")}</td>`;
          }

          if (rowType.key === "pause") {
            const tooltipAttribute = resolvedDayContent.pauseTooltip
              ? ` title="${escapeMepHtml(resolvedDayContent.pauseTooltip)}"`
              : "";
            return `<td ${dayCellAttributes.join(" ")}${tooltipAttribute}>${renderMepHandText(resolvedDayContent.pause, variant + 1, "mepTplHandValue")}</td>`;
          }

          if (rowType.key === "end") {
            return `<td ${dayCellAttributes.join(" ")}>${renderMepHandText(resolvedDayContent.end, variant + 2, "mepTplHandValue")}</td>`;
          }

          if (rowType.key === "sum") {
            return `<td ${dayCellAttributes.join(" ")}>${renderMepHandText(resolvedDayContent.sum, variant + 3, "mepTplHandValue")}</td>`;
          }

          return `<td ${dayCellAttributes.join(" ")}></td>`;
        })
        .join("");

      const baseColumns =
        index === 0
          ? `
            <td rowspan="4" class="mepTplEmployee mepTplColEmployee">${
              getMepEmployeeNameCellContent(employee, employeeOffset, uiState)
            }</td>
            <td rowspan="4" class="mepTplColRole">${renderMepHandText(getMepRoleLabel(employee), employeeOffset + 1, "mepTplHandMeta")}</td>
            <td rowspan="4" class="mepTplColTarget" title="anteilig nach Tagen im sichtbaren Monat">${renderMepHandText(weekTargetLabel, employeeOffset + 2, "mepTplHandMeta")}</td>
          `
          : "";

      const summaryColumns =
        index === 0
          ? `
            <td rowspan="4" class="mepTplSummary mepTplSummaryWeek mepTplSummaryCell mepTplSummaryCellWeek"><div class="mepTplSummaryBox">${renderMepHandText(employee ? minutesToHM(getEmployeeAccountMinutesForWeek(employee, weekSummaryDays)) : "", employeeOffset + 3, "mepTplHandSummary")}</div></td>
            <td rowspan="4" class="mepTplSummary mepTplSummaryMonth mepTplSummaryCell mepTplSummaryCellMonth"><div class="mepTplSummaryBox">${renderMepHandText(employee ? minutesToHM(getMepCumulativeMonthMinutes(employee, sheetModel)) : "", employeeOffset + 4, "mepTplHandSummary")}</div></td>
          `
          : "";

      return `
        <tr class="${getMepEmployeeRowClasses(rowType.key)}">
          ${baseColumns}
          <td class="mepTplMetric mepTplColMetric">${rowType.label}</td>
          ${dayCells}
          ${summaryColumns}
        </tr>
      `;
    })
    .join("");
}

function isEmployeeActiveInWeekDays(employee, weekDays) {
  const months = [...new Set((Array.isArray(weekDays) ? weekDays : [])
    .map((day) => String(day?.iso || "").slice(0, 7))
    .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)))];

  if (!months.length) {
    return isEmployeeActiveInMonth(employee, state.activeMonth);
  }

  return months.some((month) => isEmployeeActiveInMonth(employee, month));
}

function getMepTemplateSheetModelsForMonth() {
  const monthWeeks = state.monthPlan?.weeks || [];
  const allEmployees = Array.isArray(state.employees) ? state.employees : [];
  const activeMonthEmployees = allEmployees.filter((employee) => isEmployeeActiveInMonth(employee, state.activeMonth));
  const employeePageCount = Math.max(1, Math.ceil(Math.max(activeMonthEmployees.length, 1) / MEP_EMPLOYEES_PER_SHEET));

  if (!monthWeeks.length) {
    return [
      {
        weekDays: getActiveWeekDays(),
        weekIndex: 0,
        pageIndex: 0,
        employees: activeMonthEmployees.slice(0, MEP_EMPLOYEES_PER_SHEET),
        weekFrom: state.weekFrom || "",
        weekTo: state.weekTo || "",
        activeMonth: state.activeMonth || (state.weekFrom || "").slice(0, 7)
      }
    ];
  }

  return monthWeeks.flatMap((weekDays, weekIndex) => {
    const safeWeekDays = Array.isArray(weekDays) ? weekDays : [];
    const weekFrom = safeWeekDays[0]?.iso || "";
    const weekTo = safeWeekDays[safeWeekDays.length - 1]?.iso || weekFrom;
    const activeMonth =
      state.activeMonth ||
      safeWeekDays.find((day) => day?.inCurrentMonth)?.iso?.slice(0, 7) ||
      weekFrom.slice(0, 7);

    const weekEmployees = activeMonthEmployees.filter((employee) => isEmployeeActiveInWeekDays(employee, safeWeekDays));
    const weekEmployeePageCount = Math.max(1, Math.ceil(Math.max(weekEmployees.length, 1) / MEP_EMPLOYEES_PER_SHEET));

    return Array.from({ length: weekEmployeePageCount }, (_, pageIndex) => ({
      weekDays: safeWeekDays,
      weekIndex,
      pageIndex,
      employees: weekEmployees.slice(
        pageIndex * MEP_EMPLOYEES_PER_SHEET,
        (pageIndex + 1) * MEP_EMPLOYEES_PER_SHEET
      ),
      weekFrom,
      weekTo,
      activeMonth
    }));
  });
}

function getMepTemplateSheetModelsForWeek() {
  const weekDays = getActiveWeekDays();
  const employees = (Array.isArray(state.employees) ? state.employees : [])
    .filter((employee) => isEmployeeActiveInWeekDays(employee, weekDays));
  const totalPages = Math.max(1, Math.ceil(Math.max(employees.length, 1) / MEP_EMPLOYEES_PER_SHEET));

  return Array.from({ length: totalPages }, (_, pageIndex) => ({
    weekDays,
    weekIndex: 0,
    pageIndex,
    employees: employees.slice(
      pageIndex * MEP_EMPLOYEES_PER_SHEET,
      (pageIndex + 1) * MEP_EMPLOYEES_PER_SHEET
    ),
    weekFrom: state.weekFrom || weekDays[0]?.iso || "",
    weekTo: state.weekTo || weekDays[weekDays.length - 1]?.iso || "",
    activeMonth: state.activeMonth || (weekDays[0]?.iso || "").slice(0, 7)
  }));
}

function renderMepTemplateView(options = {}) {
  const { scope = "month" } = options;
  const pagesEl = document.getElementById("mepTemplatePages");
  const sheetTemplate = document.getElementById("mepTemplateSheetTemplate");
  if (!pagesEl || !sheetTemplate) return;

  updateMepMonthHeaderTitle(state.activeMonth);

  const sheetModels =
    scope === "week" ? getMepTemplateSheetModelsForWeek() : getMepTemplateSheetModelsForMonth();

  pagesEl.innerHTML = "";

  sheetModels.forEach((sheetModel, sheetIndex) => {
    const sheetFragment = sheetTemplate.content.cloneNode(true);
    const bodyEl = sheetFragment.querySelector(".mepTemplateBody");
    if (!bodyEl) return;

    const weekDays = Array.isArray(sheetModel.weekDays) ? sheetModel.weekDays : [];
    const monthSourceDate = `${sheetModel.activeMonth || ""}-01`;

    const monthYearEl = sheetFragment.querySelector("[data-mep-month-year]");
    const weekFromEl = sheetFragment.querySelector("[data-mep-week-from]");
    const weekToEl = sheetFragment.querySelector("[data-mep-week-to]");

    if (monthYearEl) monthYearEl.textContent = formatMepMonthYear(monthSourceDate);
    if (weekFromEl) weekFromEl.textContent = formatMepFullDate(sheetModel.weekFrom);
    if (weekToEl) weekToEl.textContent = formatMepFullDate(sheetModel.weekTo);

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateEl = sheetFragment.querySelector(`[data-mep-date-index="${dayIndex}"]`);
      if (!dateEl) continue;

      const day = weekDays[dayIndex] || null;
      const isoDate = day?.iso || "";
      const headerCell = dateEl.closest("th");
      dateEl.textContent = day?.isOutsideMonth ? "" : formatMepHeaderDate(isoDate);
      dateEl.className = [
        "mepTplHeaderDate",
        getMepHandVariantClass(sheetIndex * 7 + dayIndex)
      ].filter(Boolean).join(" ");
      headerCell?.classList.toggle("mepTplDayHeader--outsideMonth", Boolean(day?.isOutsideMonth));
    }

    let rowsHtml = "";

    for (let slotIndex = 0; slotIndex < MEP_EMPLOYEES_PER_SHEET; slotIndex += 1) {
      rowsHtml += buildMepEmployeeRows(sheetModel.employees[slotIndex], weekDays, slotIndex, sheetModel);
    }

    bodyEl.innerHTML = rowsHtml;
    pagesEl.appendChild(sheetFragment);
  });

  requestAnimationFrame(() => {
    syncMepOutsideRunMarkers(pagesEl);
  });
}
