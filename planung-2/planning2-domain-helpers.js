"use strict";

/* Pure Planning-2 adapters around the central contract and absence rules.  They
 * exist outside app.js so the preview/optimizer can use the same domain sources
 * without depending on application state or orchestration. */
function isPlanning2DomainGfbEmployee(employee) {
  return String(employee?.roleKey || "").trim().toUpperCase() === "GFB";
}

function getPlanning2DomainContractTargetMinutesPerMonth(employee) {
  if (!employee) return 0;
  if (isPlanning2DomainGfbEmployee(employee)) return 43 * 60;

  const individual = Number(employee.contractTargetMinutesPerMonth);
  if (Number.isFinite(individual) && individual > 0) return Math.round(individual);

  const contractTarget = getContractModelTargetMinutesPerMonth(employee.contractModel || employee.roleKey || "");
  if (Number.isFinite(contractTarget) && contractTarget > 0) return Math.round(contractTarget);

  const weeklyTarget = hmToMinutes(employee.target || "0:00");
  return weeklyTarget > 0 ? Math.round((weeklyTarget * 52) / 12) : 0;
}

function getPlanning2DomainTargetMinutesPerWeek(employee) {
  return getAbsenceMinutesForEmployee(employee) * 6;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isPlanning2DomainGfbEmployee, getPlanning2DomainContractTargetMinutesPerMonth, getPlanning2DomainTargetMinutesPerWeek };
}
