"use strict";

function planning2ShiftDayIso(isoDate, amount) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isPlanning2RelevantWorkday(isoDate, plan = {}) {
  if (new Date(`${isoDate}T00:00:00Z`).getUTCDay() === 0) return false;
  if (typeof isHolidayDate === "function" && isHolidayDate(plan.stateKey || "schleswig-holstein", isoDate)) return false;
  return !Array.isArray(plan.closedDates) || !plan.closedDates.includes(isoDate);
}

function previousPlanning2RelevantWorkday(isoDate, plan = {}) {
  let candidate = planning2ShiftDayIso(isoDate, -1);
  while (!isPlanning2RelevantWorkday(candidate, plan)) candidate = planning2ShiftDayIso(candidate, -1);
  return candidate;
}

function nextPlanning2RelevantWorkday(isoDate, plan = {}) {
  let candidate = planning2ShiftDayIso(isoDate, 1);
  while (!isPlanning2RelevantWorkday(candidate, plan)) candidate = planning2ShiftDayIso(candidate, 1);
  return candidate;
}

function planning2CarryoverRolePriority(employee) {
  const tokens = [employee?.roleKey, employee?.functionKey, employee?.role, employee?.funktion]
    .flatMap(value => String(value || "").trim().toUpperCase().split(/[^A-Z0-9]+/)).filter(Boolean);
  return tokens.includes("TL") ? 2 : tokens.includes("SV") || tokens.includes("STV") ? 1 : 0;
}

function isPlanning2ExplicitCarryoverOpener(employee, getShift, morningIso) {
  const morning = getShift(employee, morningIso);
  return morning?.start === "08:55"
    && morning.planning2AutoOpener !== true
    && (["FO", "FLEX"].includes(morning.code) || morning.shiftKey === "FO" || morning.mode === "early" || morning.shiftType === "early");
}

function rankPlanning2CarryoverCandidates(employees, getShift, closingIso, morningIso, allowedEnds = ["19:10"]) {
  const eligible = (employees || []).map((employee, index) => ({ employee, index }))
    .filter(({ employee }) => {
      const closing = getShift(employee, closingIso);
      const morning = getShift(employee, morningIso);
      return closing && allowedEnds.includes(closing.end) && ["08:55", "09:00"].includes(morning?.start);
    });
  const explicit = eligible.filter(({ employee }) => isPlanning2ExplicitCarryoverOpener(employee, getShift, morningIso));
  return (explicit.length ? explicit : eligible)
    .sort((left, right) => planning2CarryoverRolePriority(right.employee) - planning2CarryoverRolePriority(left.employee) || left.index - right.index)
    .map(item => item.employee);
}

function evaluatePlanning2CarryoverRule({ plan, employees, morningIso, getShift }) {
  const closingIso = previousPlanning2RelevantWorkday(morningIso, plan);
  const result = { ok: true, closingIso, morningIso, expectedOpenerEmployeeId: null, actualOpenerEmployeeIds: [], eligibleEmployeeIds: [], violations: [] };
  if (!isPlanning2RelevantWorkday(morningIso, plan)) return result;
  const shift = getShift || ((employee, isoDate) => plan?.schedule?.[isoDate]?.[employee.id]);
  const hasCloser = (employees || []).some(employee => shift(employee, closingIso)?.end === "19:10");
  if (!hasCloser) return result;
  const eligible = rankPlanning2CarryoverCandidates(employees, shift, closingIso, morningIso);
  const expected = eligible[0] || null;
  const actual = (employees || []).filter(employee => shift(employee, morningIso)?.start === "08:55");
  result.expectedOpenerEmployeeId = expected?.id ?? null;
  result.actualOpenerEmployeeIds = actual.map(employee => employee.id);
  result.eligibleEmployeeIds = eligible.map(employee => employee.id);
  if (!expected) result.violations.push({ code: "NO_ELIGIBLE_CARRYOVER_OPENER" });
  if (!actual.length) result.violations.push({ code: "MISSING_0855_OPENER" });
  if (actual.length > 1) result.violations.push({ code: "MULTIPLE_0855_OPENERS" });
  if (expected && (actual.length !== 1 || String(actual[0].id) !== String(expected.id))) result.violations.push({ code: "WRONG_0855_OPENER" });
  result.ok = result.violations.length === 0;
  return result;
}

function planning2CarryoverProblem(evaluation) {
  if (!evaluation || evaluation.ok) return null;
  return { problemId: `${evaluation.morningIso}|carryover-opener`, type: "carryover-opener", closingIso: evaluation.closingIso, morningIso: evaluation.morningIso, isoDate: evaluation.morningIso, expectedEmployeeId: evaluation.expectedOpenerEmployeeId, actualEmployeeIds: [...evaluation.actualOpenerEmployeeIds], eligibleEmployeeIds: [...evaluation.eligibleEmployeeIds], violations: evaluation.violations.map(item => ({ ...item })) };
}

function planning2CarryoverViolationFacts(evaluation) {
  return (evaluation?.violations || []).map(item => ({
    rule: "CARRYOVER_OPENER_RULE",
    morningIso: evaluation.morningIso,
    closingIso: evaluation.closingIso,
    expectedEmployeeId: evaluation.expectedOpenerEmployeeId,
    actualEmployeeIds: [...evaluation.actualOpenerEmployeeIds],
    reason: item.code
  }));
}

function planning2CarryoverViolationKey(violation) {
  return JSON.stringify([violation.morningIso, violation.closingIso, violation.reason, violation.expectedEmployeeId, violation.actualEmployeeIds]);
}

function evaluatePlanning2CandidateFollowUpRules(candidate, context) {
  const plan = context?.sourcePlan;
  const employees = context?.sourceEmployees || [];
  if (!plan) return { rules: [], carryoverBefore: [], carryoverAfter: [], introducedViolations: [], preExistingViolations: [], requiredFollowUpMutations: [], touchesCarryoverRule: false, valid: true, violations: [] };
  const simulated = JSON.parse(JSON.stringify(plan));
  (candidate?.mutations || []).forEach(mutation => {
    const entry = simulated.schedule?.[mutation.isoDate]?.[mutation.employeeId];
    if (entry?.type === "shift" && mutation.after === null) {
      delete simulated.schedule[mutation.isoDate][mutation.employeeId];
    } else if (entry?.type === "shift") {
      simulated.schedule[mutation.isoDate][mutation.employeeId] = { ...entry, ...mutation.after };
    } else if (!entry && mutation.after?.type === "shift") {
      simulated.schedule = simulated.schedule || {};
      simulated.schedule[mutation.isoDate] = simulated.schedule[mutation.isoDate] || {};
      simulated.schedule[mutation.isoDate][mutation.employeeId] = { ...mutation.after };
    }
  });
  const dates = [...new Set((candidate?.mutations || []).flatMap(mutation => [mutation.isoDate, nextPlanning2RelevantWorkday(mutation.isoDate, simulated)]))];
  const resolveShift = (workingPlan, employee, isoDate) => {
    if (typeof context?.resolveWorkShift === "function") return context.resolveWorkShift(workingPlan, employee, isoDate);
    if (typeof getResolvedDayEntry === "function") {
      const resolved = getResolvedDayEntry({ employee, isoDate, schedule: workingPlan.schedule, absences: workingPlan.absences, stateKey: workingPlan.stateKey || "schleswig-holstein" });
      return resolved?.type === "shift" && resolved.sourceEntry?.type === "shift" ? resolved.sourceEntry : null;
    }
    return null;
  };
  const evaluate = (workingPlan, morningIso) => evaluatePlanning2CarryoverRule({
    plan: workingPlan,
    employees,
    morningIso,
    getShift: (employee, isoDate) => resolveShift(workingPlan, employee, isoDate)
  });
  const carryoverBefore = dates.map(morningIso => evaluate(plan, morningIso));
  const carryoverAfter = dates.map(morningIso => evaluate(simulated, morningIso));
  const preExistingViolations = carryoverBefore.flatMap(planning2CarryoverViolationFacts);
  const beforeKeys = new Set(preExistingViolations.map(planning2CarryoverViolationKey));
  const introducedViolations = carryoverAfter.flatMap(planning2CarryoverViolationFacts)
    .filter(violation => !beforeKeys.has(planning2CarryoverViolationKey(violation)));
  const introducedMornings = new Set(introducedViolations.map(violation => violation.morningIso));
  const requiredFollowUpMutations = [];
  carryoverAfter.filter(rule => introducedMornings.has(rule.morningIso)).forEach(rule => {
    const expected = rule.expectedOpenerEmployeeId;
    const employee = employees.find(item => String(item.id) === String(expected));
    const entry = employee && resolveShift(simulated, employee, rule.morningIso);
    if (entry && entry.start !== "08:55") requiredFollowUpMutations.push({ isoDate: rule.morningIso, employeeId: expected, before: { start: entry.start, end: entry.end }, after: { start: "08:55", end: entry.end }, reason: "CARRYOVER_OPENER" });
    rule.actualOpenerEmployeeIds.filter(id => String(id) !== String(expected)).forEach(id => {
      const staleEmployee = employees.find(item => String(item.id) === String(id));
      const stale = staleEmployee && resolveShift(simulated, staleEmployee, rule.morningIso);
      if (stale) requiredFollowUpMutations.push({ isoDate: rule.morningIso, employeeId: id, before: { start: stale.start, end: stale.end }, after: { start: "09:00", end: stale.end }, reason: "CARRYOVER_OPENER_RESET" });
    });
  });
  const touchesCarryoverRule = carryoverAfter.some((after, index) => JSON.stringify(after) !== JSON.stringify(carryoverBefore[index]));
  return { rules: carryoverAfter, carryoverBefore, carryoverAfter, introducedViolations, preExistingViolations, requiredFollowUpMutations, touchesCarryoverRule, valid: introducedViolations.length === 0, violations: introducedViolations };
}

if (typeof module !== "undefined") module.exports = { isPlanning2RelevantWorkday, previousPlanning2RelevantWorkday, nextPlanning2RelevantWorkday, planning2CarryoverRolePriority, isPlanning2ExplicitCarryoverOpener, rankPlanning2CarryoverCandidates, evaluatePlanning2CarryoverRule, planning2CarryoverProblem, evaluatePlanning2CandidateFollowUpRules };
