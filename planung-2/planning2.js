"use strict";

(function initPlanning2Prototype() {
  const VIEW_ID = "planning2View";
  const BUTTON_ID = "btnViewPlanning2";
  const WEEKDAY_DEMAND = [
    { icon: "📦 ✨", label: "Ware · Pflege" },
    { icon: "✨", label: "Pflege / Arbeitskapazität" },
    { icon: "🚚", label: "Lieferung" },
    { icon: "📦📦", label: "hoher Warenbedarf" },
    { icon: "🔥 🚚", label: "hoher Umsatz · Lieferung" },
    { icon: "🔥 ✨ 📦", label: "Umsatz · Optik · Ware soweit machbar" }
  ];

  let planning2Active = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getShiftBounds(employee, isoDate) {
    const entry = typeof getPlanEntry === "function" ? getPlanEntry(employee.id, isoDate) : null;
    if (!entry || entry.type !== "shift" || !entry.start || !entry.end) return null;
    return {
      start: typeof hhmmToMinutes === "function" ? hhmmToMinutes(entry.start) : 0,
      end: typeof hhmmToMinutes === "function" ? hhmmToMinutes(entry.end) : 0,
      entry
    };
  }

  function getActiveEmployeesForIso(isoDate) {
    const yearMonth = String(isoDate || "").slice(0, 7);
    return (state.employees || []).filter((employee) => (
      typeof isEmployeeActiveInMonth !== "function" || isEmployeeActiveInMonth(employee, yearMonth)
    ));
  }

  function getCoverageForDay(day) {
    if (!day?.iso) return { ok: false, reason: "Kein Datum" };
    const employees = getActiveEmployeesForIso(day.iso);
    const shifts = employees
      .map((employee) => ({ employee, bounds: getShiftBounds(employee, day.iso) }))
      .filter((item) => item.bounds && item.bounds.end > item.bounds.start);

    const countAt = (minute) => shifts.filter(({ bounds }) => bounds.start <= minute && bounds.end > minute).length;
    const openerCount = countAt(8 * 60 + 55);
    if (openerCount < 1) {
      return { ok: false, reason: "08:55 fehlt", openerCount, minCount: 0 };
    }

    let gapStart = null;
    let firstGap = null;
    let minCount = Number.POSITIVE_INFINITY;
    for (let minute = 9 * 60; minute < 19 * 60 + 10; minute += 5) {
      const count = countAt(minute);
      minCount = Math.min(minCount, count);
      if (count < 2 && gapStart === null) gapStart = minute;
      if (count >= 2 && gapStart !== null && !firstGap) {
        firstGap = [gapStart, minute];
        gapStart = null;
      }
    }
    if (gapStart !== null && !firstGap) firstGap = [gapStart, 19 * 60 + 10];

    if (firstGap) {
      return {
        ok: false,
        reason: `${formatMinute(firstGap[0])}–${formatMinute(firstGap[1])} < 2 MA`,
        openerCount,
        minCount: Number.isFinite(minCount) ? minCount : 0
      };
    }

    return { ok: true, reason: "2er-Besetzung gesichert", openerCount, minCount };
  }

  function formatMinute(minute) {
    const hours = Math.floor(minute / 60);
    const minutes = minute % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function getCellDisplay(employee, day) {
    const resolved = typeof getResolvedEntryForEmployeeOnIso === "function"
      ? getResolvedEntryForEmployeeOnIso(employee, day.iso)
      : null;
    const entry = typeof getPlanEntry === "function" ? getPlanEntry(employee.id, day.iso) : null;

    if (entry?.type === "shift" && entry.start && entry.end) {
      return {
        main: `${entry.start}–${entry.end}`,
        sub: entry.code || "Schicht",
        className: "p2Cell--shift"
      };
    }

    const status = typeof getResolvedStatus === "function" ? getResolvedStatus(resolved) : "";
    if (status === "vacation") return { main: "U", sub: "Urlaub", className: "p2Cell--absence" };
    if (status === "sick") return { main: "K", sub: "Krank", className: "p2Cell--absence" };
    if (entry?.type === "off") return { main: "Frei", sub: "AG-Frei", className: "p2Cell--off" };
    if (entry?.type === "external-help") return { main: "AH", sub: entry.branch || "Aushilfe", className: "p2Cell--external" };

    return { main: "—", sub: "", className: "p2Cell--empty" };
  }

  function employeeHasEmployerFree(employee, weekDays) {
    return weekDays.some((day) => {
      const entry = typeof getPlanEntry === "function" ? getPlanEntry(employee.id, day.iso) : null;
      return entry?.type === "off";
    });
  }

  function getEmployeeHourInfo(employee, weekDays) {
    if (typeof isGfbEmployee === "function" && isGfbEmployee(employee)) {
      const monthMinutes = typeof getEmployeeAccountMinutesForMonth === "function"
        ? getEmployeeAccountMinutesForMonth(employee, state.activeMonth)
        : 0;
      return {
        text: `${minutesToHM(monthMinutes)} / 43:00 Monat`,
        detail: `${minutesToHM(Math.max(0, 43 * 60 - monthMinutes))} Reserve`,
        className: monthMinutes > 43 * 60 ? "p2Hours--danger" : monthMinutes >= 38 * 60 ? "p2Hours--warn" : ""
      };
    }

    const accountMinutes = typeof getEmployeeAccountMinutesForWeek === "function"
      ? getEmployeeAccountMinutesForWeek(employee, weekDays, state.activeMonth)
      : 0;
    const targetMinutes = typeof getEmployeeTargetMinutesForWeek === "function"
      ? getEmployeeTargetMinutesForWeek(employee, weekDays, state.activeMonth)
      : (typeof hmToMinutes === "function" ? hmToMinutes(employee.target || "0:00") : 0);
    const delta = accountMinutes - targetMinutes;
    return {
      text: `${minutesToHM(accountMinutes)} / ${minutesToHM(targetMinutes)}`,
      detail: delta < 0 ? `${minutesToHM(Math.abs(delta))} offen` : delta > 0 ? `+${minutesToHM(delta)}` : "Soll erreicht",
      className: delta < 0 ? "p2Hours--open" : "p2Hours--done"
    };
  }

  function getWeekSummary(weekDays, employees) {
    let tzOpenMinutes = 0;
    let gfbMinutes = 0;
    let gfbCount = 0;

    employees.forEach((employee) => {
      if (typeof isGfbEmployee === "function" && isGfbEmployee(employee)) {
        gfbCount += 1;
        gfbMinutes += typeof getEmployeeAccountMinutesForMonth === "function"
          ? getEmployeeAccountMinutesForMonth(employee, state.activeMonth)
          : 0;
        return;
      }

      const account = typeof getEmployeeAccountMinutesForWeek === "function"
        ? getEmployeeAccountMinutesForWeek(employee, weekDays, state.activeMonth)
        : 0;
      const target = typeof getEmployeeTargetMinutesForWeek === "function"
        ? getEmployeeTargetMinutesForWeek(employee, weekDays, state.activeMonth)
        : 0;
      tzOpenMinutes += Math.max(0, target - account);
    });

    const coverageProblems = weekDays.filter((day) => !getCoverageForDay(day).ok).length;
    return { tzOpenMinutes, gfbMinutes, gfbCount, coverageProblems };
  }

  function renderPlanning2() {
    const root = document.getElementById(VIEW_ID);
    if (!root || typeof getActiveWeekDays !== "function") return;

    const weekDays = getActiveWeekDays().slice(0, 6).filter(Boolean);
    const employees = (state.employees || []).filter((employee) => (
      typeof isEmployeeActiveInMonth !== "function" || isEmployeeActiveInMonth(employee, state.activeMonth)
    ));
    const summary = getWeekSummary(weekDays, employees);
    const activeMonthDate = weekDays[0]?.date || (state.activeMonth ? new Date(`${state.activeMonth}-01T00:00:00`) : new Date());
    const monthLabel = activeMonthDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

    const weekChoices = (typeof getCurrentMonthWeeks === "function" ? getCurrentMonthWeeks() : [])
      .map((week) => week.slice(0, 6).filter(Boolean))
      .filter((week) => week.length && week.some((day) => day.inCurrentMonth));

    const weekButtons = weekChoices.map((week, index) => {
      const isActive = week.some((day) => day.iso === state.weekFrom);
      const first = week[0]?.date;
      const last = week[week.length - 1]?.date;
      const label = first && last
        ? `${String(first.getDate()).padStart(2, "0")}.${String(first.getMonth() + 1).padStart(2, "0")}–${String(last.getDate()).padStart(2, "0")}.${String(last.getMonth() + 1).padStart(2, "0")}`
        : `W${index + 1}`;
      return `<button type="button" class="p2WeekChip${isActive ? " isActive" : ""}" data-p2-week="${escapeHtml(week[0]?.iso || "")}">${label}</button>`;
    }).join("");

    const dayHeads = weekDays.map((day, index) => {
      const coverage = getCoverageForDay(day);
      const demand = WEEKDAY_DEMAND[index] || { icon: "", label: "" };
      return `<div class="p2DayHead">
        <div class="p2DayTitle">${escapeHtml(day.weekdayLabel || ["Mo", "Di", "Mi", "Do", "Fr", "Sa"][index])} <span>${String(day.date?.getDate?.() || "").padStart(2, "0")}.${String((day.date?.getMonth?.() ?? -1) + 1).padStart(2, "0")}</span></div>
        <div class="p2Demand" title="${escapeHtml(demand.label)}">${demand.icon}</div>
        <div class="p2Coverage ${coverage.ok ? "isOk" : "isBad"}">${coverage.ok ? "✓ Besetzung" : `⚠ ${escapeHtml(coverage.reason)}`}</div>
      </div>`;
    }).join("");

    const employeeRows = employees.map((employee) => {
      const hours = getEmployeeHourInfo(employee, weekDays);
      const hasFree = employeeHasEmployerFree(employee, weekDays);
      const cells = weekDays.map((day) => {
        const display = getCellDisplay(employee, day);
        return `<div class="p2Cell ${display.className}">
          <strong>${escapeHtml(display.main)}</strong>
          ${display.sub ? `<span>${escapeHtml(display.sub)}</span>` : ""}
        </div>`;
      }).join("");

      return `<div class="p2EmployeeRow">
        <div class="p2EmployeeMeta">
          <strong class="p2EmployeeName">${escapeHtml(employee.name || "—")}</strong>
          <div class="p2EmployeeRole">${escapeHtml(employee.roleKey || "-")}</div>
          <div class="p2EmployeeHours ${hours.className}"><strong>${escapeHtml(hours.text)}</strong><span>${escapeHtml(hours.detail)}</span></div>
          ${hasFree ? "" : '<div class="p2EmployeeWarn">⚠ Frei fehlt</div>'}
        </div>
        <div class="p2EmployeeDays">${cells}</div>
      </div>`;
    }).join("");

    root.innerHTML = `
      <div class="p2Shell">
        <div class="p2Top">
          <div>
            <div class="p2Eyebrow">PROTOTYP · PLANUNG 2</div>
            <h2>${escapeHtml(monthLabel)}</h2>
          </div>
          <div class="p2MonthNav">
            <button type="button" data-p2-month="-1" aria-label="Vorheriger Monat">◀</button>
            <button type="button" data-p2-month="1" aria-label="Nächster Monat">▶</button>
          </div>
        </div>

        <div class="p2Summary">
          <div><span>TZ noch offen</span><strong>${minutesToHM(summary.tzOpenMinutes)}</strong></div>
          <div><span>GFB Monat</span><strong>${minutesToHM(summary.gfbMinutes)}${summary.gfbCount ? ` · ${summary.gfbCount} MA` : ""}</strong></div>
          <div class="${summary.coverageProblems ? "isBad" : "isOk"}"><span>Grundbesetzung</span><strong>${summary.coverageProblems ? `${summary.coverageProblems} Tag(e) prüfen` : "✓ komplett"}</strong></div>
        </div>

        <div class="p2WeekPicker" aria-label="Wochenabschnitt">${weekButtons}</div>

        <div class="p2GridViewport">
          <div class="p2GridHeader">
            <div class="p2EmployeeHead">Mitarbeiter · Stunden</div>
            <div class="p2DayHeads">${dayHeads}</div>
          </div>
          <div class="p2Rows">${employeeRows || '<div class="p2Empty">Keine aktiven Mitarbeiter.</div>'}</div>
        </div>

        <div class="p2PrototypeNote">Erste Testversion: Übersicht und Prüfmarker. Schichten werden hier noch nicht bearbeitet.</div>
      </div>
    `;
  }

  function shiftMonth(delta) {
    const current = state.activeMonth || String(state.weekFrom || "").slice(0, 7);
    const match = /^(\d{4})-(\d{2})$/.exec(current || "");
    if (!match) return;
    const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
    state.activeMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (typeof syncMonthPlanToState === "function") syncMonthPlanToState();
    const firstWeek = typeof getCurrentMonthWeeks === "function"
      ? getCurrentMonthWeeks().find((week) => week.some((day) => day.inCurrentMonth))
      : null;
    if (firstWeek?.[0]?.iso) state.weekFrom = firstWeek[0].iso;
    if (typeof syncWeekRangeFromActiveWeek === "function") syncWeekRangeFromActiveWeek();
    if (typeof saveAppStateDebounced === "function") saveAppStateDebounced();
    renderPlanning2();
  }

  function activatePlanning2() {
    planning2Active = true;
    ["dayView", "weekView", "monthView", "overviewView", "mepTemplateView"].forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });
    document.getElementById(VIEW_ID)?.classList.remove("hidden");
    document.querySelectorAll("#viewSwitch .viewBtn").forEach((button) => button.classList.remove("active"));
    document.getElementById(BUTTON_ID)?.classList.add("active");
    document.getElementById("viewMetaLine")?.classList.add("hidden");
    document.getElementById("teamSection")?.classList.add("hidden");
    document.body.dataset.currentView = "planning2";
    renderPlanning2();
  }

  function deactivatePlanning2() {
    if (!planning2Active) return;
    planning2Active = false;
    document.getElementById(VIEW_ID)?.classList.add("hidden");
    if (typeof renderTeamSectionVisibility === "function") renderTeamSectionVisibility();
  }

  function installPrototype() {
    if (document.getElementById(BUTTON_ID)) return;
    const viewSwitch = document.getElementById("viewSwitch");
    const weekView = document.getElementById("weekView");
    if (!viewSwitch || !weekView) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "viewBtn p2ViewButton";
    button.textContent = "Planung 2";
    viewSwitch.appendChild(button);

    const section = document.createElement("section");
    section.id = VIEW_ID;
    section.className = "overview hidden no-print planning2View";
    weekView.insertAdjacentElement("afterend", section);

    button.addEventListener("click", activatePlanning2);
    ["btnViewDay", "btnViewWeek", "btnViewMonth", "btnViewOverview", "btnViewMep"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => {
        deactivatePlanning2();
      });
    });

    section.addEventListener("click", (event) => {
      const monthButton = event.target.closest?.("[data-p2-month]");
      if (monthButton) {
        shiftMonth(Number(monthButton.dataset.p2Month) || 0);
        return;
      }
      const weekButton = event.target.closest?.("[data-p2-week]");
      if (weekButton?.dataset?.p2Week) {
        state.weekFrom = weekButton.dataset.p2Week;
        state.activeMonth = state.weekFrom.slice(0, 7);
        if (typeof syncMonthPlanToState === "function") syncMonthPlanToState();
        if (typeof syncWeekRangeFromActiveWeek === "function") syncWeekRangeFromActiveWeek();
        if (typeof saveAppStateDebounced === "function") saveAppStateDebounced();
        renderPlanning2();
      }
    });

    window.Planning2Prototype = { render: renderPlanning2, activate: activatePlanning2 };
  }

  function waitForAppBoot(attempt = 0) {
    if (window.__APP_BOOT_OK__) {
      installPrototype();
      return;
    }
    if (attempt > 80) return;
    window.setTimeout(() => waitForAppBoot(attempt + 1), 100);
  }

  if (document.readyState === "complete") {
    waitForAppBoot();
  } else {
    window.addEventListener("load", () => waitForAppBoot(), { once: true });
  }
})();
