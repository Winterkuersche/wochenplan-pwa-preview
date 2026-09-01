"use strict";

/* Planning 2 stage D.  This module deliberately contains no ranking policy for a
 * complete month: it only turns the existing candidates into atomic, explainable
 * units and validates their combined result. */
function planning2PackageClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function planning2PackageMutationKey(mutation) { return `${mutation.isoDate}|${mutation.employeeId}`; }
function planning2PackageCanonicalMutation(mutation) {
  return { isoDate: String(mutation.isoDate), employeeId: String(mutation.employeeId), before: mutation.before == null ? null : planning2PackageClone(mutation.before), after: mutation.after == null ? null : planning2PackageClone(mutation.after), ...(mutation.reason ? { reason: mutation.reason } : {}) };
}
function normalizePlanning2PackageMutations(mutations) {
  const cells = new Map(), normalized = [], violations = [];
  (mutations || []).forEach(raw => {
    if (!raw?.isoDate || raw.employeeId == null) { violations.push({ rule: "INVALID_MUTATION" }); return; }
    const mutation = planning2PackageCanonicalMutation(raw), key = planning2PackageMutationKey(mutation), existing = cells.get(key);
    if (!existing) { cells.set(key, mutation); normalized.push(mutation); return; }
    if (JSON.stringify(existing) !== JSON.stringify(mutation)) violations.push({ rule: "CONFLICTING_PACKAGE_MUTATIONS", isoDate: mutation.isoDate, employeeId: mutation.employeeId });
  });
  normalized.sort((a, b) => planning2PackageMutationKey(a).localeCompare(planning2PackageMutationKey(b)) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { mutations: normalized, violations };
}
function planning2PackageId(packageType, mutations, sourceCandidateIds = []) {
  const canonical = mutations.map(m => [m.isoDate, String(m.employeeId), m.before ?? null, m.after ?? null]);
  return ["planning2-package", packageType || "MULTI_MUTATION", JSON.stringify(canonical), [...new Set(sourceCandidateIds.map(String))].sort().join(",")].join("|");
}
function planning2PackageMinutes(entry) {
  if (!entry?.start || !entry?.end) return 0;
  if (Number.isFinite(entry.minutes)) return entry.minutes;
  const toMinutes = value => { const [hours, minutes] = String(value).split(":").map(Number); return hours * 60 + minutes; };
  const pause = typeof getBusinessRequiredBreakMinutes === "function" ? getBusinessRequiredBreakMinutes(entry.start, entry.end) : 0;
  return typeof getWorkedMinutesFromRange === "function" ? getWorkedMinutesFromRange(entry.start, entry.end, pause) : Math.max(0, toMinutes(entry.end) - toMinutes(entry.start) - pause);
}
function planning2PackageValidBoundary(value) {
  if (typeof isPlanning2AllowedPlanTime === "function") return isPlanning2AllowedPlanTime(value);
  if (!/^\d\d:\d\d$/.test(String(value || ""))) return false;
  const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return minutes === 535 || minutes === 1150 || minutes >= 540 && minutes <= 1140 && minutes % 15 === 0;
}
function applyPlanning2MutationsToPlan(sourcePlan, mutations) {
  const plan = planning2PackageClone(sourcePlan || { schedule: {} });
  plan.schedule = plan.schedule || {};
  mutations.forEach(mutation => {
    plan.schedule[mutation.isoDate] = plan.schedule[mutation.isoDate] || {};
    if (mutation.after === null) delete plan.schedule[mutation.isoDate][mutation.employeeId];
    else if (mutation.after.type && mutation.after.type !== "shift") plan.schedule[mutation.isoDate][mutation.employeeId] = planning2PackageClone(mutation.after);
    else {
      const current = plan.schedule[mutation.isoDate][mutation.employeeId];
      const template = current?.type === "shift" ? current : { type: "shift", status: "work", code: "FLEX", shiftKey: "FLEX", mode: "flex", shiftType: "flex" };
      const after = { ...template, ...mutation.after, type: "shift" };
      if (typeof getBusinessRequiredBreakMinutes === "function" && typeof getWorkedMinutesFromRange === "function") {
        after.pause = getBusinessRequiredBreakMinutes(after.start, after.end); after.breakMinutes = after.pause;
        after.minutes = getWorkedMinutesFromRange(after.start, after.end, after.pause); after.withCheckout = after.end === "19:10";
      }
      plan.schedule[mutation.isoDate][mutation.employeeId] = after;
    }
  });
  return plan;
}
function planning2PackageCoverage(context, mutations) {
  const byDate = new Map((context?.days || []).map(day => [day.isoDate, day]));
  const facts = { understaffingMinutesBefore: 0, understaffingMinutesAfter: 0, improvedMinutes: 0, worsenedMinutes: 0, newGaps: [], fullyResolved: false, partiallyImproved: false, days: [] };
  const gapMinutes = coverage => (coverage?.gaps || []).filter(g => g.kind === "understaffing").reduce((sum, gap) => sum + Math.max(0, gap.end - gap.start), 0);
  [...new Set(mutations.map(m => m.isoDate))].forEach(isoDate => {
    const day = byDate.get(isoDate); if (!day) return;
    const entries = planning2PackageClone(day.resolvedEntries || []);
    mutations.filter(m => m.isoDate === isoDate).forEach(m => {
      const index = (context.employees || []).findIndex(person => String(person.employeeId) === String(m.employeeId)); if (index < 0) return;
      entries[index] = m.after === null ? { type: "empty" } : m.after.type && m.after.type !== "shift" ? { type: m.after.type, status: m.after.status, sourceEntry: planning2PackageClone(m.after), minutesForMonth: 0, minutesForBranch: 0 } : { type: "shift", sourceEntry: { type: "shift", ...m.after }, minutesForMonth: planning2PackageMinutes(m.after), minutesForBranch: planning2PackageMinutes(m.after) };
    });
    const before = planning2PackageClone(day.coverage || { gaps: [] });
    const after = typeof context.evaluateCoverage === "function" ? context.evaluateCoverage(entries, isoDate) : typeof evaluateResolvedDayCoverage === "function" ? evaluateResolvedDayCoverage(entries) : before;
    const oldGaps = (before.gaps || []).filter(g => g.kind === "understaffing"), newGaps = (after.gaps || []).filter(g => g.kind === "understaffing");
    const introduced = newGaps.filter(g => !oldGaps.some(old => old.start <= g.start && old.end >= g.end));
    const beforeMinutes = gapMinutes(before), afterMinutes = gapMinutes(after);
    facts.understaffingMinutesBefore += beforeMinutes; facts.understaffingMinutesAfter += afterMinutes;
    facts.newGaps.push(...introduced.map(g => ({ isoDate, ...g }))); facts.days.push({ isoDate, before, after, beforeMinutes, afterMinutes });
  });
  facts.improvedMinutes = Math.max(0, facts.understaffingMinutesBefore - facts.understaffingMinutesAfter);
  facts.worsenedMinutes = Math.max(0, facts.understaffingMinutesAfter - facts.understaffingMinutesBefore);
  facts.fullyResolved = facts.understaffingMinutesBefore > 0 && facts.understaffingMinutesAfter === 0;
  facts.partiallyImproved = facts.improvedMinutes > 0 && !facts.fullyResolved;
  return facts;
}
function simulatePlanning2MutationPackage(context, input) {
  const normalized = normalizePlanning2PackageMutations(input?.mutations || []), mutations = normalized.mutations;
  const violations = normalized.violations.slice(), sourcePlan = context?.sourcePlan || { schedule: {} };
  const employees = context?.employees || [], sourceEmployees = context?.sourceEmployees || employees.map(p => p.sourceEmployee || { id: p.employeeId });
  const manualPlanDiff = input?.packageType === "PLAYGROUND_MANUAL";
  mutations.forEach(mutation => {
    const employee = employees.find(p => String(p.employeeId) === String(mutation.employeeId));
    const current = sourcePlan.schedule?.[mutation.isoDate]?.[mutation.employeeId] || null;
    const contextDay = (context.days || []).find(day => day.isoDate === mutation.isoDate), employeeIndex = employees.indexOf(employee), resolved = contextDay?.resolvedEntries?.[employeeIndex];
    if (mutation.before !== null && (manualPlanDiff ? JSON.stringify(current) !== JSON.stringify(mutation.before) : (!current || current.type !== "shift"))) violations.push({ rule: "STALE_MUTATION_BEFORE", isoDate: mutation.isoDate, employeeId: mutation.employeeId });
    if (mutation.before === null && current && current.type !== "shift") violations.push({ rule: "PROTECTED_STATUS", isoDate: mutation.isoDate, employeeId: mutation.employeeId, status: current.type });
    if (!manualPlanDiff && mutation.after && resolved && !["empty", "shift"].includes(resolved.type) && resolved.status !== "work") violations.push({ rule: "PROTECTED_STATUS", isoDate: mutation.isoDate, employeeId: mutation.employeeId, status: resolved.type || resolved.status });
    if (mutation.after?.type === "shift" || mutation.after && !mutation.after.type) {
      if (!planning2PackageValidBoundary(mutation.after.start) || !planning2PackageValidBoundary(mutation.after.end)) violations.push({ rule: "INVALID_TIME_GRID", isoDate: mutation.isoDate, employeeId: mutation.employeeId });
      const minutes = planning2PackageMinutes(mutation.after);
      if (minutes < 180) violations.push({ rule: "MINIMUM_SHIFT_DURATION", isoDate: mutation.isoDate, employeeId: mutation.employeeId, minutes });
      const availability = typeof validateShiftAgainstEmployeeAvailability === "function" ? validateShiftAgainstEmployeeAvailability(employee?.sourceEmployee || employee || {}, mutation.isoDate, mutation.after.start, mutation.after.end) : { valid: true, violations: [] };
      if (!availability.valid) violations.push(...(availability.violations || []).map(item => ({ rule: "EMPLOYEE_AVAILABILITY", ...item, isoDate: mutation.isoDate, employeeId: mutation.employeeId })));
    }
    if (typeof context?.isReadOnlyDate === "function" && context.isReadOnlyDate(mutation.isoDate)) violations.push({ rule: "READ_ONLY_DATE", isoDate: mutation.isoDate });
  });
  const simulatedPlan = applyPlanning2MutationsToPlan(sourcePlan, mutations), coverage = planning2PackageCoverage(context, mutations);
  if (coverage.newGaps.length || coverage.worsenedMinutes > 0) violations.push({ rule: "NEW_UNDERSTAFFING", newGaps: coverage.newGaps, worsenedMinutes: coverage.worsenedMinutes });
  const hoursByEmployee = {}, freeDayFacts = [];
  [...new Set(mutations.map(m => String(m.employeeId)))].forEach(employeeId => {
    const person = employees.find(p => String(p.employeeId) === employeeId), employeeMutations = mutations.filter(m => String(m.employeeId) === employeeId);
    const delta = employeeMutations.reduce((sum, m) => sum + planning2PackageMinutes(m.after) - planning2PackageMinutes(m.before), 0);
    const before = Number(person?.evaluation?.weeklyActualMinutes || 0), monthBefore = Number(person?.gfbMonthActualMinutes || 0);
    hoursByEmployee[employeeId] = { minutesBefore: before, minutesAfter: before + delta, deltaMinutes: delta, monthMinutesBefore: monthBefore, monthMinutesAfter: monthBefore + delta };
    const mondayOf = isoDate => { const date = new Date(`${isoDate}T00:00:00Z`), weekday = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 1 - weekday); return date.toISOString().slice(0, 10); };
    const relevantDays = (context.days || []).filter(day => { const weekday = new Date(`${day.isoDate}T00:00:00Z`).getUTCDay(); return weekday >= 1 && weekday <= 6; }), weeks = new Map();
    relevantDays.forEach(day => { const monday = mondayOf(day.isoDate); if (!weeks.has(monday)) weeks.set(monday, []); weeks.get(monday).push(day); });
    const weekFacts = [...weeks].map(([weekMonday, days]) => { const freeDates = days.filter(day => { const mutation = employeeMutations.find(m => m.isoDate === day.isoDate); if (mutation) return mutation.after === null || mutation.after?.type === "off" || mutation.after?.status === "off"; const index = employees.indexOf(person), entry = day.resolvedEntries?.[index]; return !entry || entry.type === "empty" || entry.type === "off" || entry.status === "off"; }).map(day => day.isoDate); return { weekMonday, freeDatesAfter: freeDates, hasRealFreeDay: freeDates.length > 0 }; });
    const freeFact = { employeeId, weeks: weekFacts, freeDatesAfter: weekFacts.flatMap(week => week.freeDatesAfter), hasRealFreeDay: weekFacts.every(week => week.hasRealFreeDay) }; freeDayFacts.push(freeFact);
    weekFacts.filter(week => !week.hasRealFreeDay).forEach(week => violations.push({ rule: "REAL_FREE_DAY_REQUIRED", employeeId, weekMonday: week.weekMonday }));
    if (person?.evaluation?.isGfb) {
      const limit = Number(person.gfbMonthLimitMinutes), projected = monthBefore + delta;
      if (Number.isFinite(limit) && projected > limit) violations.push({ rule: "GFB_MONTH_LIMIT", employeeId, projectedMinutes: projected, limitMinutes: limit });
    }
  });
  let followUp = { rules: [], requiredFollowUpMutations: [], touchesCarryoverRule: false, valid: true, violations: [] };
  if (typeof evaluatePlanning2CandidateFollowUpRules === "function") followUp = evaluatePlanning2CandidateFollowUpRules({ mutations }, { ...context, sourcePlan, sourceEmployees });
  if (!followUp.valid) violations.push(...(followUp.violations || []));
  const affectedEmployeeIds = [...new Set(mutations.map(m => String(m.employeeId)))].sort(), affectedIsoDates = [...new Set(mutations.map(m => m.isoDate))].sort();
  const sourceCandidateIds = [...new Set(input?.sourceCandidateIds || [])].sort(), packageType = input?.packageType || "MULTI_MUTATION";
  const gfbEmployees = affectedEmployeeIds.filter(id => employees.find(p => String(p.employeeId) === id)?.evaluation?.isGfb);
  const gfbFacts = { employees: gfbEmployees.map(employeeId => ({ employeeId, currentMonthMinutes: hoursByEmployee[employeeId].monthMinutesBefore, packageDeltaMinutes: hoursByEmployee[employeeId].deltaMinutes, projectedMonthMinutes: hoursByEmployee[employeeId].monthMinutesAfter, limitMinutes: employees.find(p => String(p.employeeId) === employeeId)?.gfbMonthLimitMinutes, remainingMinutes: Number(employees.find(p => String(p.employeeId) === employeeId)?.gfbMonthLimitMinutes) - hoursByEmployee[employeeId].monthMinutesAfter })) };
  return { packageId: planning2PackageId(packageType, mutations, sourceCandidateIds), packageType, problemIds: [...new Set(input?.problemIds || [])].sort(), mutations, sourceCandidateIds, affectedEmployeeIds, affectedIsoDates, constraintResults: { allowed: violations.length === 0, violations }, followUpRules: followUp.rules || [], requiredFollowUpMutations: followUp.requiredFollowUpMutations || [], carryoverFacts: followUp, coverageBefore: coverage.days.map(d => ({ isoDate: d.isoDate, ...d.before })), coverageAfter: coverage.days.map(d => ({ isoDate: d.isoDate, ...d.after })), coverageFacts: coverage, hoursBefore: Object.fromEntries(Object.entries(hoursByEmployee).map(([id, f]) => [id, f.minutesBefore])), hoursAfter: Object.fromEntries(Object.entries(hoursByEmployee).map(([id, f]) => [id, f.minutesAfter])), hoursFacts: hoursByEmployee, gfbFacts, freeDayFacts, baselineFacts: { mutationCount: mutations.length }, disruptionFacts: { mutationCount: mutations.length, affectedEmployeeCount: affectedEmployeeIds.length, affectedDateCount: affectedIsoDates.length, followUpCount: mutations.filter(m => m.reason?.startsWith("CARRYOVER")).length }, valid: violations.length === 0, simulatedPlan };
}
function planning2PackageWithFollowUps(context, candidate, packageType) {
  let mutations = [...(candidate.mutations || []), ...(candidate.requiredFollowUpMutations || [])], result;
  for (let depth = 0; depth < 3; depth++) {
    result = simulatePlanning2MutationPackage(context, { packageType, problemIds: [candidate.problemId].filter(Boolean), sourceCandidateIds: [candidate.candidateId].filter(Boolean), mutations });
    const additions = result.requiredFollowUpMutations.filter(f => !mutations.some(m => JSON.stringify(planning2PackageCanonicalMutation(m)) === JSON.stringify(planning2PackageCanonicalMutation(f))));
    if (!additions.length) return result; mutations.push(...additions);
  }
  result.constraintResults.violations.push({ rule: "INCOMPLETE_FOLLOW_UP_CHAIN" }); result.constraintResults.allowed = result.valid = false; return result;
}
function generatePlanning2MutationPackages(context, candidates) {
  const packages = [], rejected = [], raw = candidates || [], topK = Math.max(1, Number(context?.packageTopK) || 8), signature = candidate => JSON.stringify((candidate.mutations || []).map(planning2PackageCanonicalMutation));
  const partitions = new Map();
  raw.forEach(candidate => { const key = [candidate.problemId || "no-problem", candidate.mutationType || "mutation", candidate.employeeId].join("|"); if (!partitions.has(key)) partitions.set(key, new Map()); const unique = partitions.get(key); if (!unique.has(signature(candidate)) && unique.size < topK) unique.set(signature(candidate), candidate); });
  const source = [...partitions.values()].flatMap(unique => [...unique.values()]), pairKeys = new Set(); let consideredPairCount = 0, simulatedPairCount = 0;
  source.filter(candidate => (candidate.requiredFollowUpMutations || []).length).forEach(candidate => { const value = planning2PackageWithFollowUps(context, candidate, "CARRYOVER_FOLLOW_UP"); (value.valid ? packages : rejected).push(value); });
  const mondayOf = isoDate => { const date = new Date(`${isoDate}T00:00:00Z`), weekday = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 1 - weekday); return date.toISOString().slice(0, 10); };
  const affectedDates = candidate => [...new Set((candidate.mutations || []).map(mutation => mutation.isoDate))];
  const eligiblePairs = [], addPair = (a, b, packageType) => { if (a === b || (a.requiredFollowUpMutations || []).length || (b.requiredFollowUpMutations || []).length) return; consideredPairCount++; const key = [a.candidateId || signature(a), b.candidateId || signature(b)].sort().join("||"); if (pairKeys.has(key)) return; pairKeys.add(key); eligiblePairs.push({ a, b, packageType }); };
  const removalsByEmployeeWeek = new Map();
  source.filter(candidate => candidate.mutationType === "SHIFT_REMOVE").forEach(candidate => affectedDates(candidate).forEach(date => { const key = `${candidate.employeeId}|${mondayOf(date)}`; if (!removalsByEmployeeWeek.has(key)) removalsByEmployeeWeek.set(key, []); removalsByEmployeeWeek.get(key).push(candidate); }));
  source.filter(candidate => candidate.requiresCompensatingPackage).forEach(candidate => affectedDates(candidate).forEach(date => (removalsByEmployeeWeek.get(`${candidate.employeeId}|${mondayOf(date)}`) || []).slice(0, topK).forEach(remove => addPair(candidate, remove, "FREE_DAY_COMPENSATION"))));
  const redistributionBuckets = new Map(), addToBucket = (key, candidate) => { if (!redistributionBuckets.has(key)) redistributionBuckets.set(key, []); const bucket = redistributionBuckets.get(key); if (bucket.length < topK * 4) bucket.push(candidate); };
  source.filter(candidate => !(candidate.requiredFollowUpMutations || []).length).forEach(candidate => { affectedDates(candidate).forEach(date => addToBucket(`date:${date}`, candidate)); if (candidate.problemId) addToBucket(`problem:${candidate.problemId}`, candidate); });
  redistributionBuckets.forEach(bucket => { for (let left = 0; left < bucket.length; left++) for (let right = left + 1; right < bucket.length; right++) {
    const a = bucket[left], b = bucket[right];
    const deltaA = Number(a.actualChangeMinutes ?? a.workMinutesDifference ?? 0), deltaB = Number(b.actualChangeMinutes ?? b.workMinutesDifference ?? 0);
    if (String(a.employeeId) !== String(b.employeeId) && deltaA * deltaB < 0) addPair(a, b, "HOURS_REDISTRIBUTION");
  }});
  eligiblePairs.slice(0, Math.max(32, topK * topK * 4)).forEach(({ a, b, packageType }) => {
    const mutations = [...(a.mutations || []), ...(b.mutations || []), ...(a.requiredFollowUpMutations || []), ...(b.requiredFollowUpMutations || [])]; simulatedPairCount++;
    const value = simulatePlanning2MutationPackage(context, { packageType, problemIds: [a.problemId, b.problemId].filter(Boolean), sourceCandidateIds: [a.candidateId, b.candidateId].filter(Boolean), mutations });
    (value.valid ? packages : rejected).push(value);
  });
  const unique = values => [...new Map(values.map(value => [value.packageId, value])).values()];
  return { packages: unique(packages), rejected: unique(rejected), generationFacts: { inputCandidateCount: raw.length, preselectedCandidateCount: source.length, consideredPairCount, simulatedPairCount, topK } };
}
function rankPlanning2MutationPackages(packages) { return [...(packages || [])].sort((a, b) => b.coverageFacts.improvedMinutes - a.coverageFacts.improvedMinutes || a.disruptionFacts.mutationCount - b.disruptionFacts.mutationCount || a.packageId.localeCompare(b.packageId)); }
function preparePlanning2MutationPackageApply(sourcePlan, packageSuggestion, context = {}) {
  const normalized = normalizePlanning2PackageMutations(packageSuggestion?.mutations || []), violations = normalized.violations.slice();
  normalized.mutations.forEach(mutation => {
    const current = sourcePlan?.schedule?.[mutation.isoDate]?.[mutation.employeeId] || null;
    const currentShape = current?.type === "shift" ? { start: current.start, end: current.end, ...(mutation.before?.type ? { type: "shift" } : {}) } : null;
    if (JSON.stringify(currentShape) !== JSON.stringify(mutation.before)) violations.push({ rule: "STALE_MUTATION_BEFORE", isoDate: mutation.isoDate, employeeId: mutation.employeeId });
  });
  if (violations.length) return { valid: false, violations, plan: null };
  const validationContext = typeof context.buildFreshContext === "function" ? context.buildFreshContext(sourcePlan, normalized.mutations) : context.validationContext;
  if (!validationContext) return { valid: false, violations: [{ rule: "PACKAGE_VALIDATION_CONTEXT_REQUIRED" }], plan: null };
  const simulation = simulatePlanning2MutationPackage({ ...validationContext, sourcePlan }, { ...packageSuggestion, mutations: normalized.mutations });
  return { valid: simulation.valid, violations: simulation.constraintResults.violations, plan: simulation.valid ? simulation.simulatedPlan : null, simulation };
}

if (typeof module !== "undefined") module.exports = { normalizePlanning2PackageMutations, planning2PackageId, applyPlanning2MutationsToPlan, preparePlanning2MutationPackageApply, simulatePlanning2MutationPackage, generatePlanning2MutationPackages, rankPlanning2MutationPackages };
