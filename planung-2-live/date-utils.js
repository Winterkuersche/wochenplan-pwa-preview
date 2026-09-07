function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeYearMonth(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : "";
}

function shiftYearMonthByMonths(yearMonth, offsetMonths = 0) {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";

  const [year, month] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.getTime())) return "";

  date.setMonth(date.getMonth() + Number(offsetMonths || 0));
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function getYearMonthFromIsoDate(isoDate) {
  if (typeof isoDate !== "string" || isoDate.length < 7) return "";
  return normalizeYearMonth(isoDate.slice(0, 7));
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fromIsoDate(isoDate) {
  if (typeof isoDate !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function cloneDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isIsoDateInRange(isoDate, fromIso, toIso) {
  if (!isoDate || !fromIso || !toIso) return false;
  return isoDate >= fromIso && isoDate <= toIso;
}

function getMondayBasedDayIndex(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return -1;
  return (date.getDay() + 6) % 7;
}

// ISO 8601 calendar week: weeks start on Monday and week 1 contains January 4.
// Returning the week-year as well avoids merging adjacent years at month boundaries.
function getIsoCalendarWeek(date) {
  const normalizedDate = cloneDate(date);
  if (!normalizedDate) return null;

  const thursday = cloneDate(normalizedDate);
  thursday.setDate(normalizedDate.getDate() + 3 - getMondayBasedDayIndex(normalizedDate));

  const weekYear = thursday.getFullYear();
  const firstThursday = new Date(weekYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - getMondayBasedDayIndex(firstThursday));

  return {
    year: weekYear,
    week: 1 + Math.round((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000))
  };
}

function isSundayDate(date) {
  return getMondayBasedDayIndex(date) === 6;
}

function isSundayIsoDate(isoDate) {
  const date = fromIsoDate(isoDate);
  if (!date) return false;
  return isSundayDate(date);
}

function formatShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
}

function formatIsoToShortDate(isoDate) {
  const date = fromIsoDate(isoDate);
  if (!date) return "";
  return formatShortDate(date);
}

function formatMonthYearFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function getYearFromIsoDate(isoDate) {
  if (typeof isoDate !== "string" || isoDate.length < 4) return NaN;
  return Number(isoDate.slice(0, 4));
}

function eachIsoDateInRange(fromIso, toIso) {
  const startDate = fromIsoDate(fromIso);
  const endDate = fromIsoDate(toIso);

  if (!startDate || !endDate || startDate > endDate) return [];

  const result = [];
  let cursor = cloneDate(startDate);

  while (cursor && cursor <= endDate) {
    result.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}
