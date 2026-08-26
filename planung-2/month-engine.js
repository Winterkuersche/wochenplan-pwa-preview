const MONTH_WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_WEEKLY_MINUTES = 159 * 60;
const PLANNING_DAYS_PER_WEEK = 6;
const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getStartOfVisibleMonthGrid(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const mondayIndex = getMondayBasedDayIndex(firstOfMonth);
  const gridStart = cloneDate(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - mondayIndex);
  return gridStart;
}

function getEndOfVisibleMonthGrid(year, monthIndex) {
  const lastOfMonth = new Date(year, monthIndex + 1, 0);
  const mondayIndex = getMondayBasedDayIndex(lastOfMonth);
  const daysUntilSunday = 6 - mondayIndex;
  const gridEnd = cloneDate(lastOfMonth);
  gridEnd.setDate(lastOfMonth.getDate() + daysUntilSunday);
  return gridEnd;
}

function buildMonthDayObject(date, targetYear, targetMonthIndex) {
  const monthIndex = date.getMonth();
  const weekdayIndex = getMondayBasedDayIndex(date);

  return {
    date: cloneDate(date),
    iso: toIsoDate(date),
    year: date.getFullYear(),
    monthIndex,
    month: monthIndex + 1,
    day: date.getDate(),
    weekdayIndex,
    weekdayLabel: MONTH_WEEKDAY_LABELS[weekdayIndex],
    inCurrentMonth: date.getFullYear() === targetYear && monthIndex === targetMonthIndex,
    isOutsideMonth: !(date.getFullYear() === targetYear && monthIndex === targetMonthIndex),
  };
}

function buildMonthWeeks(year, monthIndex) {
  const gridStart = getStartOfVisibleMonthGrid(year, monthIndex);
  const gridEnd = getEndOfVisibleMonthGrid(year, monthIndex);
  const weeks = [];

  let cursor = cloneDate(gridStart);

  while (cursor <= gridEnd) {
    const week = [];

    for (let i = 0; i < 7; i++) {
      week.push(buildMonthDayObject(cursor, year, monthIndex));
      const next = cloneDate(cursor);
      next.setDate(cursor.getDate() + 1);
      cursor = next;
    }

    weeks.push(week);
  }

  return weeks;
}

function getMonthMeta(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  return {
    year,
    monthIndex,
    month: monthIndex + 1,
    monthLabel: `${pad2(monthIndex + 1)}.${year}`,
    firstOfMonth: cloneDate(firstDay),
    lastOfMonth: cloneDate(lastDay),
    firstOfMonthIso: toIsoDate(firstDay),
    lastOfMonthIso: toIsoDate(lastDay),
  };
}

function buildMonthPlan(year, monthIndex) {
  return {
    meta: getMonthMeta(year, monthIndex),
    weeks: buildMonthWeeks(year, monthIndex),
  };
}

function getMonthPlanFromDateString(isoDateString) {
  if (!isoDateString) return null;

  const date = fromIsoDate(isoDateString);
  if (!date) return null;

  return buildMonthPlan(date.getFullYear(), date.getMonth());
}

function getMonthPlanFromYearMonth(yearMonth) {
  if (typeof yearMonth !== "string") return null;
  const normalized = yearMonth.trim().match(/^(\d{4})-(\d{2})$/);
  if (!normalized) return null;

  const month = Number(normalized[2]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;

  return getMonthPlanFromDateString(`${normalized[1]}-${normalized[2]}-01`);
}

function getMonthTitleFromDays(days = []) {
  if (!Array.isArray(days) || !days.length) return "Monat";
  const firstDate = days[0]?.date;
  if (!(firstDate instanceof Date)) return "Monat";
  return `${MONTH_NAMES[firstDate.getMonth()]} ${firstDate.getFullYear()}`;
}

function groupVisibleMonthDaysByCalendarWeek(days = []) {
  if (!Array.isArray(days)) return [];

  return days.reduce((groups, day) => {
    const date = day?.date instanceof Date ? day.date : fromIsoDate(day?.iso);
    const calendarWeek = getIsoCalendarWeek(date);
    if (!calendarWeek) return groups;

    const key = `${calendarWeek.year}-W${pad2(calendarWeek.week)}`;
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.key === key) {
      currentGroup.days.push(day);
      return groups;
    }

    groups.push({
      key,
      year: calendarWeek.year,
      week: calendarWeek.week,
      days: [day]
    });
    return groups;
  }, []);
}

function getBranchTargetMinutesForVisibleWeek(days = []) {
  if (!Array.isArray(days)) return 0;

  const visiblePlanningDays = days.reduce((count, day) => (
    day?.iso && !isSundayIsoDate(day.iso) ? count + 1 : count
  ), 0);

  return Math.round((MAX_WEEKLY_MINUTES * visiblePlanningDays) / PLANNING_DAYS_PER_WEEK);
}

function getMonthWeekSummaries(days = [], employees = [], options = {}) {
  const safeEmployees = Array.isArray(employees) ? employees : [];
  const getActualMinutes = typeof options.getActualMinutes === "function"
    ? options.getActualMinutes
    : () => 0;
  const getTargetMinutes = typeof options.getTargetMinutes === "function"
    ? options.getTargetMinutes
    : () => 0;

  return groupVisibleMonthDaysByCalendarWeek(days).map((weekGroup) => {
    const totals = safeEmployees.reduce((summary, employee) => ({
      actualMinutes: summary.actualMinutes + Math.max(0, Number(getActualMinutes(employee, weekGroup.days)) || 0),
      targetMinutes: summary.targetMinutes + Math.max(0, Number(getTargetMinutes(employee, weekGroup.days)) || 0)
    }), { actualMinutes: 0, targetMinutes: 0 });

    return {
      ...weekGroup,
      ...totals,
      branchTargetMinutes: getBranchTargetMinutesForVisibleWeek(weekGroup.days)
    };
  });
}

function formatMinutesAsDecimalHours(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  const hours = Math.round((safeMinutes / 60) * 100) / 100;
  return String(hours).replace(".", ",");
}

function getMonthCellClass(resolved, day, selectValue = "") {
  const classes = ["monthCell"];

  if (day?.weekdayIndex === 6) classes.push("monthCellSunday");
  if (resolved?.type === "holiday") classes.push("monthCellHoliday");

  if (typeof buildWeekSelectClass === "function") {
    classes.push(...buildWeekSelectClass(selectValue)
      .split(/\s+/)
      .filter((className) => className && className !== "weekSelect"));
  }

  return classes.join(" ");
}

function getMonthCellText(resolved, options = {}) {
  const { formatQuarterLabel = (value) => value } = options;
  const status = getResolvedStatus(resolved);
  let cellText = resolved?.label || "";

  if (status === ENTRY_STATUS.WORK) {
    const entry = resolved?.sourceEntry || resolved || {};
    if (entry.start && entry.end) {
      if (entry.mode === "flex") {
        cellText = `${formatQuarterLabel(entry.start)}-${formatQuarterLabel(entry.end)}`;
      } else {
        cellText = `${entry.start}-${entry.end}`;
      }
    } else if (entry.code) {
      cellText = entry.code;
    }
  } else if (status === ENTRY_STATUS.EXTERNAL) {
    cellText = getExternalHelpCompactDisplay(resolved);
  } else if ([ENTRY_STATUS.VACATION, ENTRY_STATUS.SICK].includes(status)) {
    cellText = getStatusShortLabel(status);
  }

  return cellText;
}

function getExternalHelpCompactDisplay(resolvedOrEntry) {
  const resolved = resolvedOrEntry && typeof resolvedOrEntry === "object"
    ? resolvedOrEntry
    : null;
  const entry = resolved?.sourceEntry || resolved;
  const baseLabel = "AH";

  if (!entry || typeof entry !== "object") return baseLabel;

  const branch = typeof entry.branch === "string"
    ? entry.branch.trim()
    : "";

  let minutes = null;
  if (typeof entry.minutes === "number" && Number.isFinite(entry.minutes) && entry.minutes >= 0) {
    minutes = entry.minutes;
  } else if (typeof entry.minutes === "string" && isValidHHMM(entry.minutes)) {
    const parseMinutes = typeof parseTimeToMinutes === "function"
      ? parseTimeToMinutes
      : hhmmToMinutes;
    minutes = parseMinutes(entry.minutes);
  }

  if (!branch && minutes === null) return baseLabel;

  const parts = [];
  if (branch) {
    const safeBranch = escapeHtml(branch);
    parts.push(`<span class="ahCellBranch" title="${safeBranch}">${safeBranch}</span>`);
  }
  if (minutes !== null) {
    parts.push(`<span class="ahCellDuration">${minutesToHM(minutes)}</span>`);
  }

  return [
    `<span class="ahCellContent">`,
    `  <span class="ahCellMain">${baseLabel}</span>`,
    `  <span class="ahCellSubrow">${parts.join('<span class="ahCellSeparator" aria-hidden="true"> · </span>')}</span>`,
    `</span>`
  ].join("");
}

function resolveMonthFallbackDialogOptions() {
  if (typeof getShiftSelectOptions !== "function") return [];

  return getShiftSelectOptions()
    .map((option) => ({
      ...option,
      code: option.code || (
        typeof getShiftCodeForSelectValue === "function"
          ? getShiftCodeForSelectValue(option.value)
          : option.value
      )
    }))
    .filter((option) => option.code !== "H");
}
