// Dieses Modul ist bewusst auf manuelle Monats-Iststunden begrenzt:
// - Parsing einzelner Zeilen und Bulk-Input
// - Validierung/Normalisierung von YYYY-MM innerhalb dieses manuellen Kontexts
// Keine allgemeine Monatskalender-Erzeugung; dafür ist month-engine.js zuständig.
function parseManualMonthHoursLine(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4}-\d{2})[\s;,\t|]+(\d+:[0-5]\d)$/);
  if (!match) return null;

  const yearMonth = normalizeManualMonthYearMonth(match[1]);
  const minutes = parseManualMonthHoursToMinutes(match[2]);
  if (!isValidManualMonthYearMonth(yearMonth) || minutes === null || minutes < 0) return null;

  return { yearMonth, minutes };
}

function normalizeManualMonthYearMonth(value) {
  if (typeof value !== "string") return "";
  const match = value.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function isValidManualMonthYearMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function parseManualMonthHoursToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) return null;
  return hours * 60 + minutes;
}

function parseManualMonthBulkInput(value) {
  const result = {
    values: {},
    lineErrors: []
  };

  if (typeof value !== "string" || !value.trim()) return result;

  value.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parsed = parseManualMonthHoursLine(trimmed);
    if (!parsed) {
      result.lineErrors.push(`Zeile ${index + 1}: Bitte Format YYYY-MM HH:MM verwenden.`);
      return;
    }

    result.values[parsed.yearMonth] = parsed.minutes;
  });

  return result;
}
