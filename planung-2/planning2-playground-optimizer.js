"use strict";

/* Stage E2: bounded, deterministic search over complete playground plan copies.
 * Candidate creation remains in A-C and package creation in D.  This module is
 * intentionally not called by render code; run() is the only entry point. */
(function installPlanning2PlaygroundOptimizer(root) {
  const DEFAULT_CONFIG = Object.freeze({
    maxCandidatesPerGroup: 8,
    maxDependencyCandidates: 24,
    maxPackageCandidates: 40,
    beamWidth: 24,
    maxDepth: 4,
    maxSimulations: 160,
    maxResults: 3
  });
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const monday = iso => { const date = new Date(`${iso}T00:00:00Z`), day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 1 - day); return date.toISOString().slice(0, 10); };
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const signature = value => JSON.stringify(canonical(value));
  function stableId(prefix, value) {
    const text = signature(value); let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return `${prefix}_${(hash >>> 0).toString(36).padStart(7, "0")}`;
  }
  const mutationKey = mutation => `${mutation.isoDate}|${String(mutation.employeeId)}`;
  function mergeMutations(left, right) {
    const cells = new Map(); let conflict = false;
    [...left, ...right].forEach(mutation => {
      const normalized = clone(mutation), key = mutationKey(normalized), previous = cells.get(key);
      if (previous && signature(previous.after ?? null) !== signature(normalized.after ?? null)) conflict = true;
      else cells.set(key, normalized);
    });
    return conflict ? null : [...cells.values()].sort((a, b) => mutationKey(a).localeCompare(mutationKey(b)));
  }
  function lockViolation(session, mutation, today) {
    if (mutation.isoDate <= today) return "PAST_OR_TODAY";
    const week = monday(mutation.isoDate);
    const hit = (session.locks || []).find(lock => lock.scope === "shift" && String(lock.employeeId) === String(mutation.employeeId) && lock.isoDate === mutation.isoDate
      || lock.scope === "day" && lock.isoDate === mutation.isoDate
      || lock.scope === "week" && lock.weekId === week
      || lock.scope === "employee-week" && String(lock.employeeId) === String(mutation.employeeId) && lock.weekId === week
      || lock.scope === "employee-period" && String(lock.employeeId) === String(mutation.employeeId));
    return hit ? `LOCKED_${hit.scope.toUpperCase()}` : "";
  }
  function representativeSelection(candidates, limit) {
    const groups = new Map();
    candidates.forEach(candidate => {
      const first = candidate.mutations?.[0] || {};
      const key = [candidate.problemId || candidate.problemIds?.join(",") || "general", candidate.employeeId ?? first.employeeId ?? "", candidate.isoDate || first.isoDate || ""].join("|");
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(candidate);
    });
    const result = [];
    [...groups].sort(([a], [b]) => a.localeCompare(b)).forEach(([, values]) => {
      const unique = [...new Map(values.map(value => [signature(value.mutations || []), value])).values()];
      const metrics = [
        value => -Number(value.coverageFacts?.improvedMinutes || value.coverageEffect || 0),
        value => -Math.abs(Number(value.hoursEffectMinutes ?? value.actualChangeMinutes ?? 0)),
        value => Number(value.disruptionFacts?.mutationCount || value.mutations?.length || 0),
        value => Number(value.timingDistanceMinutes || 0),
        value => (value.requiredFollowUpMutations?.length || value.packageType ? 0 : 1)
      ];
      const picked = new Map();
      metrics.forEach(metric => { const best = [...unique].sort((a, b) => metric(a) - metric(b) || unitId(a).localeCompare(unitId(b)))[0]; if (best) picked.set(unitId(best), best); });
      [...unique].sort((a, b) => unitId(a).localeCompare(unitId(b))).forEach(value => { if (picked.size < limit) picked.set(unitId(value), value); });
      result.push(...[...picked.values()].slice(0, limit));
    });
    return result;
  }
  const unitId = unit => String(unit.packageId || unit.candidateId || stableId("unit", unit.mutations || unit));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const known = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const clock = (value, context) => typeof context.hhmmToMinutes === "function" ? context.hhmmToMinutes(value) : typeof root.hhmmToMinutes === "function" ? root.hhmmToMinutes(value) : null;
  function eachIsoDate(yearMonth) {
    if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) return [];
    const [year, month] = yearMonth.split("-").map(Number), count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => `${yearMonth}-${String(index + 1).padStart(2, "0")}`);
  }
  function centralResolvedEntry(plan, employee, isoDate, context) {
    const resolver = context.resolveDayEntry || root.getResolvedDayEntry;
    if (typeof resolver !== "function") throw new Error("Planning2 E3 requires the central getResolvedDayEntry helper");
    return resolver({ employee, isoDate, schedule: plan.schedule || {}, absences: plan.absences || [], stateKey: plan.stateKey || context.stateKey || "schleswig-holstein" });
  }
  function centralMonthTarget(employee, context) {
    const helper = context.getContractTargetMinutesPerMonth || root.getPlanning2DomainContractTargetMinutesPerMonth || root.getEmployeeContractTargetMinutesPerMonth;
    if (typeof helper !== "function") throw new Error("Planning2 E3 requires the central monthly contract target helper");
    return finite(helper(employee));
  }
  function isGfb(employee, context) {
    const helper = context.isGfbEmployee || root.isPlanning2DomainGfbEmployee || root.isGfbEmployee;
    if (typeof helper !== "function") throw new Error("Planning2 E3 requires the central GFB helper");
    return Boolean(helper(employee));
  }
  /* Domain profile for E3. Integrations can provide the central month calculator
   * through evaluateDomainFacts; this fallback deliberately uses persisted entry
   * minutes and the same break callbacks, rather than inventing a second policy. */
  function evaluateVariantFacts(plan, mutations, context = {}, simulation = {}) {
    const supplied = typeof context.evaluateDomainFacts === "function" ? context.evaluateDomainFacts(clone(plan), clone(mutations), clone(simulation)) : simulation.domainFacts;
    if (supplied) return normalizeVariantFacts(supplied, mutations, context, simulation);
    const employees = context.sourceEmployees || (context.employees || []).map(value => value.sourceEmployee || value);
    const month = context.yearMonth || mutations[0]?.isoDate?.slice(0, 7) || context.today?.slice(0, 7), dates = eachIsoDate(month);
    const resolvedByEmployee = new Map();
    const employeeBalances = employees.map(employee => {
      const id = String(employee.id ?? employee.employeeId), targetMinutes = centralMonthTarget(employee, context), gfb = isGfb(employee, context);
      let plannedMinutes = 0, creditedAbsenceMinutes = 0;
      const resolved = [];
      dates.forEach(isoDate => {
        const entry = centralResolvedEntry(plan, employee, isoDate, context); resolved.push({ isoDate, entry });
        if (entry.type === "shift") plannedMinutes += finite(entry.minutesForMonth);
        if (["vacation", "sick", "holiday"].includes(entry.type)) creditedAbsenceMinutes += finite(entry.minutesForMonth);
      });
      resolvedByEmployee.set(id, resolved);
      const carryInMinusMinutes = gfb ? 0 : Math.max(0, finite(context.carryInMinusMinutesByEmployee?.[id]));
      const projectedBalanceMinutes = gfb ? plannedMinutes + creditedAbsenceMinutes : plannedMinutes + creditedAbsenceMinutes - targetMinutes - carryInMinusMinutes;
      return { employeeId: id, targetMinutes, plannedMinutes, creditedAbsenceMinutes, carryInMinusMinutes, projectedBalanceMinutes, balanceClassification: projectedBalanceMinutes < 0 ? "minus" : projectedBalanceMinutes > 0 ? "plus" : "balanced", isGfb: gfb };
    });
    const normal = employeeBalances.filter(value => !value.isGfb), gfb = employeeBalances.filter(value => value.isGfb);
    const weeklyDistributionPenalty = employees.reduce((total, employee) => {
      if (isGfb(employee, context) || employee.flexibleWeekDistribution === true) return total;
      const id = String(employee.id ?? employee.employeeId), weeklyTarget = targetMinutesForWeek(employee, context);
      const weeks = new Map(); (resolvedByEmployee.get(id) || []).forEach(({ isoDate, entry }) => { const week = monday(isoDate); weeks.set(week, finite(weeks.get(week)) + finite(entry.minutesForMonth)); });
      return total + [...weeks.values()].reduce((sum, minutes) => sum + Math.abs(minutes - weeklyTarget), 0);
    }, 0);
    const sequence = sequenceAndSaturdayFacts(employees, resolvedByEmployee, context);
    const preference = preferenceFacts(employees, resolvedByEmployee, context);
    const pause = pauseFacts(employees, resolvedByEmployee, context);
    return normalizeVariantFacts({ employeeBalances, totalMinusMinutes: normal.reduce((sum, value) => sum + Math.max(0, -value.projectedBalanceMinutes), 0),
      totalUnnecessaryPlusMinutes: normal.reduce((sum, value) => sum + Math.max(0, value.projectedBalanceMinutes), 0),
      gfbBudgetMinutes: gfb.reduce((sum, value) => sum + value.targetMinutes, 0), gfbUsedMinutes: gfb.reduce((sum, value) => sum + value.plannedMinutes + value.creditedAbsenceMinutes, 0),
      weeklyDistributionPenalty, ...sequence, ...preference, ...pause }, mutations, context, simulation);
  }
  function targetMinutesForWeek(employee, context) {
    const helper = context.getTargetMinutesForWeek || root.getPlanning2DomainTargetMinutesPerWeek;
    if (typeof helper === "function") return finite(helper(employee));
    const absenceHelper = context.getAbsenceMinutesForEmployee || root.getAbsenceMinutesForEmployee;
    if (typeof absenceHelper !== "function") throw new Error("Planning2 E3 requires the central daily target helper");
    return finite(absenceHelper(employee)) * 6;
  }
  function sequenceAndSaturdayFacts(employees, resolvedByEmployee, context) {
    let consecutiveWorkdayPenalty = 0, saturdayPenalty = 0; const saturdayFacts = [];
    employees.forEach(employee => {
      const id = String(employee.id ?? employee.employeeId), entries = resolvedByEmployee.get(id) || []; let run = 0, saturdayRun = 0, maxSaturdayRun = 0, count = 0, maxRun = 0;
      entries.forEach(({ isoDate, entry }) => { const works = entry.type === "shift"; run = works ? run + 1 : 0; maxRun = Math.max(maxRun, run); if (new Date(`${isoDate}T00:00:00Z`).getUTCDay() === 6) { saturdayRun = works ? saturdayRun + 1 : 0; maxSaturdayRun = Math.max(maxSaturdayRun, saturdayRun); if (works) count += 1; } });
      consecutiveWorkdayPenalty += Math.max(0, maxRun - 4); saturdayPenalty += Math.max(0, maxSaturdayRun - 3); saturdayFacts.push({ employeeId: id, workedSaturdays: count, currentConsecutiveWorkedSaturdays: saturdayRun, maxConsecutiveWorkedSaturdays: maxSaturdayRun });
    });
    return { consecutiveWorkdayPenalty, saturdayPenalty, saturdayFacts };
  }
  function preferenceFacts(employees, resolvedByEmployee, context) {
    if (!employees.length) return { preferenceViolationMinutes: 0, preferenceViolations: [] };
    const helper = context.getPreferenceFacts || root.getEmployeePlanning2PreferenceFacts;
    if (typeof helper !== "function") throw new Error("Planning2 E3 requires Stage-A preference facts");
    let preferenceViolationMinutes = 0; const preferenceViolations = [];
    employees.forEach(employee => { const preference = helper(employee).timePreference, id = String(employee.id ?? employee.employeeId); if (preference === "any") return;
      (resolvedByEmployee.get(id) || []).forEach(({ isoDate, entry }) => { if (entry.type !== "shift") return; const start = clock(entry.sourceEntry?.start, context); if (!known(start)) return; const violation = preference === "early" ? Math.max(0, start - 14 * 60) : Math.max(0, 14 * 60 - start); if (violation) { preferenceViolationMinutes += violation; preferenceViolations.push({ employeeId: id, isoDate, preference, violationMinutes: violation }); } });
    }); return { preferenceViolationMinutes, preferenceViolations };
  }
  function pauseFacts(employees, resolvedByEmployee, context) {
    if (!employees.length) return { unpaidPauseMinutes: 0 };
    const helper = context.getRequiredBreakMinutes || root.getBusinessRequiredBreakMinutes;
    if (typeof helper !== "function") throw new Error("Planning2 E3 requires the central break helper");
    let unpaidPauseMinutes = 0;
    employees.forEach(employee => (resolvedByEmployee.get(String(employee.id ?? employee.employeeId)) || []).forEach(({ entry }) => { if (entry.type === "shift") unpaidPauseMinutes += finite(helper(entry.sourceEntry?.start, entry.sourceEntry?.end)); }));
    return { unpaidPauseMinutes };
  }
  function normalizeVariantFacts(raw = {}, mutations = [], context = {}, simulation = {}) {
    const coverage = raw.coverage || raw.coverageFacts || simulation.coverageFacts || {}, balances = clone(raw.employeeBalances || raw.month?.employees || []);
    const minus = balances.filter(value => !value.isGfb && finite(value.projectedBalanceMinutes) < 0), plus = balances.filter(value => !value.isGfb && finite(value.projectedBalanceMinutes) > 0);
    const remainingCoverageWindows = clone(raw.remainingCoverageWindows || coverage.remainingCoverageWindows || coverage.newGaps || []);
    const understaffingMinutes = finite(raw.understaffingMinutes ?? coverage.understaffingMinutesAfter ?? simulation.rankingFacts?.understaffing);
    const baselineUnderstaffing = finite(context.baselineFacts?.understaffingMinutes ?? coverage.understaffingMinutesBefore);
    const dates = [...new Set(mutations.map(value => value.isoDate))].sort(), outsideDates = dates.filter(date => !(context.selectedWeeks || []).includes(monday(date)));
    const gfbBudgetMinutes = finite(raw.gfbBudgetMinutes ?? simulation.gfbFacts?.employees?.reduce((sum, value) => sum + finite(value.limitMinutes), 0));
    const gfbUsedMinutes = finite(raw.gfbUsedMinutes ?? simulation.gfbFacts?.employees?.reduce((sum, value) => sum + finite(value.projectedMonthMinutes), 0));
    const facts = {
      employeeBalances: balances, employeesInMinus: minus.length, employeesInPlus: plus.length,
      totalMinusMinutes: finite(raw.totalMinusMinutes, minus.reduce((sum, value) => sum + Math.abs(finite(value.projectedBalanceMinutes)), 0)),
      totalUnnecessaryPlusMinutes: finite(raw.totalUnnecessaryPlusMinutes, plus.reduce((sum, value) => sum + finite(value.projectedBalanceMinutes), 0)),
      understaffingMinutes, understaffingEmployeeMinutes: finite(raw.understaffingEmployeeMinutes, understaffingMinutes), remainingCoverageWindows,
      fullyCovered: raw.fullyCovered ?? understaffingMinutes === 0, coverageImprovementVsStart: finite(raw.coverageImprovementVsStart, Math.max(0, baselineUnderstaffing - understaffingMinutes)),
      gfbBudgetMinutes, gfbUsedMinutes, gfbRemainingMinutes: finite(raw.gfbRemainingMinutes, Math.max(0, gfbBudgetMinutes - gfbUsedMinutes)),
      gfbOverBudgetMinutes: finite(raw.gfbOverBudgetMinutes, Math.max(0, gfbUsedMinutes - gfbBudgetMinutes)), gfbUsefulUtilization: known(raw.gfbUsefulUtilization) ? Number(raw.gfbUsefulUtilization) : null,
      demandBufferEmployeeMinutes: known(raw.demandBufferEmployeeMinutes) ? Number(raw.demandBufferEmployeeMinutes) : null, usefulAdditionalHeads: known(raw.usefulAdditionalHeads) ? Number(raw.usefulAdditionalHeads) : null,
      weeklyDistributionPenalty: known(raw.weeklyDistributionPenalty) ? Number(raw.weeklyDistributionPenalty) : null,
      consecutiveWorkdayPenalty: known(raw.consecutiveWorkdayPenalty) ? Number(raw.consecutiveWorkdayPenalty) : null, saturdayPenalty: known(raw.saturdayPenalty) ? Number(raw.saturdayPenalty) : null,
      preferenceViolationMinutes: known(raw.preferenceViolationMinutes) ? Number(raw.preferenceViolationMinutes) : null,
      unpaidPauseMinutes: known(raw.unpaidPauseMinutes) ? Number(raw.unpaidPauseMinutes) : null, outsideSelectedWeekChangeCount: finite(raw.outsideSelectedWeekChangeCount, outsideDates.length),
      outsideSelectedWeekDates: clone(raw.outsideSelectedWeekDates || outsideDates), changeCount: finite(raw.changeCount, mutations.length), changeMagnitudeMinutes: finite(raw.changeMagnitudeMinutes),
      deliberatePlus: clone(raw.deliberatePlus || []), saturdayFacts: clone(raw.saturdayFacts || []), preferenceViolations: clone(raw.preferenceViolations || []),
      carryoverChanges: clone(raw.carryoverChanges || []), externalHelpHints: clone(raw.externalHelpHints || remainingCoverageWindows.map(value => ({ isoDate: value.isoDate, start: value.start, end: value.end, people: finite(value.required, 1) })))
    };
    facts.availability = Object.fromEntries(["gfbUsefulUtilization", "demandBufferEmployeeMinutes", "usefulAdditionalHeads", "weeklyDistributionPenalty", "consecutiveWorkdayPenalty", "saturdayPenalty", "preferenceViolationMinutes", "unpaidPauseMinutes"].map(key => [key, known(facts[key])]));
    return { ...clone(raw), ...facts };
  }
  function rankingVector(facts) {
    const dimension = (key, direction = 1) => ({ key, available: known(facts[key]), value: known(facts[key]) ? Number(facts[key]) * direction : null });
    return [dimension("understaffingEmployeeMinutes"), dimension("understaffingMinutes"), dimension("totalMinusMinutes"), dimension("totalUnnecessaryPlusMinutes"),
      dimension("gfbUsefulUtilization", -1), dimension("demandBufferEmployeeMinutes", -1), dimension("usefulAdditionalHeads", -1), dimension("weeklyDistributionPenalty"),
      dimension("consecutiveWorkdayPenalty"), dimension("saturdayPenalty"), dimension("preferenceViolationMinutes"), dimension("unpaidPauseMinutes"),
      dimension("outsideSelectedWeekChangeCount"), dimension("changeCount"), dimension("changeMagnitudeMinutes")];
  }
  function compareDomainFacts(a, b) { const left = rankingVector(a), right = rankingVector(b); for (let i = 0; i < left.length; i += 1) if (left[i].available && right[i].available && left[i].value !== right[i].value) return left[i].value - right[i].value; return 0; }
  function factsOf(simulation, mutations) {
    const coverage = simulation.coverageFacts || {};
    const explicitMonthEffect = simulation.rankingFacts?.monthEffect;
    return {
      understaffing: Number(coverage.understaffingMinutesAfter ?? simulation.rankingFacts?.understaffing ?? 0),
      coverageWorsened: Number(coverage.worsenedMinutes ?? simulation.rankingFacts?.coverageWorsened ?? 0),
      // E2 cannot infer month quality from the size of an hours transfer. Only a
      // simulator-provided, domain-aware value may participate in this dimension.
      monthEffect: Number.isFinite(explicitMonthEffect) ? Number(explicitMonthEffect) : 0,
      hasMonthEffect: Number.isFinite(explicitMonthEffect),
      constraintRisk: Number(simulation.rankingFacts?.constraintRisk || 0),
      changes: mutations.length
    };
  }
  const compareStates = (a, b) => (a.domainFacts && b.domainFacts ? compareDomainFacts(a.domainFacts, b.domainFacts) : 0) || a.facts.understaffing - b.facts.understaffing || a.facts.coverageWorsened - b.facts.coverageWorsened || a.facts.constraintRisk - b.facts.constraintRisk || a.facts.monthEffect - b.facts.monthEffect || a.facts.changes - b.facts.changes || a.id.localeCompare(b.id);
  function dominates(a, b) {
    const keys = ["understaffing", "coverageWorsened", "constraintRisk", "changes"];
    if (a.facts.hasMonthEffect && b.facts.hasMonthEffect) keys.push("monthEffect");
    return keys.every(key => a.facts[key] <= b.facts[key]) && keys.some(key => a.facts[key] < b.facts[key]);
  }
  function prune(states, width) {
    const deduped = [...new Map(states.sort(compareStates).map(state => [state.planSignature, state])).values()];
    return deduped.filter((state, index) => !deduped.some((other, otherIndex) => otherIndex !== index && dominates(other, state))).sort(compareStates).slice(0, width);
  }
  function defaultSimulation(context, sourcePlan, mutations) {
    const simulate = context.simulatePackage || root.simulatePlanning2MutationPackage;
    if (typeof simulate !== "function") throw new Error("Planning2 optimizer requires context.simulatePackage or the Stage-D simulator");
    return simulate({ ...context, sourcePlan }, { packageType: "OPTIMIZER_STATE", mutations });
  }
  function normalizeUnit(unit) {
    const followUps = unit.requiredFollowUpMutations || [];
    return { ...clone(unit), mutations: mergeMutations(unit.mutations || [], followUps), unitId: unitId(unit) };
  }
  function run(session, context = {}, suppliedConfig = {}) {
    const config = { ...DEFAULT_CONFIG, ...suppliedConfig };
    const input = clone(session), baselinePlan = clone(input.workingPlan || {}), today = String(context.today || new Date().toISOString().slice(0, 10));
    const domainContext = { ...context, selectedWeeks: clone(input.selectedWeeks || []) };
    const problems = typeof context.determineProblems === "function" ? context.determineProblems(clone(baselinePlan), clone(input)) : clone(context.problems || []);
    const candidateGenerator = context.generateCandidates || root.generatePlanning2Candidates;
    const generatorContext = { ...context, sourcePlan: clone(baselinePlan), plan: clone(baselinePlan), session: clone(input), problems: clone(problems), enableExistingShiftMutations: true };
    const rawCandidates = typeof candidateGenerator === "function" ? candidateGenerator(generatorContext) : clone(context.candidates || []);
    const selected = representativeSelection(rawCandidates || [], Math.max(1, config.maxCandidatesPerGroup));
    // Package dependencies have their own bounded pool. They must reach Stage D
    // even when the normal representative cap for their problem group is full.
    const dependencyRelevant = candidate => candidate.requiresPackage || candidate.requiresCompensatingPackage
      || (candidate.requiredFollowUpMutations || []).length > 0 || candidate.mutationType === "SHIFT_REMOVE";
    const dependencyPool = (rawCandidates || []).filter(dependencyRelevant).sort((a, b) => unitId(a).localeCompare(unitId(b))).slice(0, Math.max(0, config.maxDependencyCandidates));
    const packageInput = [...new Map([...selected, ...dependencyPool].map(value => [unitId(value), value])).values()].sort((a, b) => unitId(a).localeCompare(unitId(b)));
    const packageGenerator = context.generatePackages || root.generatePlanning2MutationPackages;
    const packageResult = typeof packageGenerator === "function" ? packageGenerator({ ...context, sourcePlan: clone(baselinePlan), packageTopK: config.maxCandidatesPerGroup }, clone(packageInput)) : { packages: clone(context.packages || []) };
    const packages = (packageResult?.packages || []).slice().sort((a, b) => unitId(a).localeCompare(unitId(b))).slice(0, config.maxPackageCandidates);
    const packagedCandidateIds = new Set(packages.flatMap(value => value.sourceCandidateIds || []));
    const atomic = selected.filter(value => !(value.requiresPackage || value.requiresCompensatingPackage) && (!(value.requiredFollowUpMutations || []).length || value.allowFollowUpBundle !== false));
    const units = [...packages, ...atomic.filter(value => !packagedCandidateIds.has(value.candidateId))].map(normalizeUnit).filter(value => value.mutations && !value.mutations.some(mutation => lockViolation(input, mutation, today))).sort((a, b) => a.unitId.localeCompare(b.unitId));
    const counters = { rawCandidateCount: (rawCandidates || []).length, representativeCandidateCount: selected.length, protectedDependencyCount: dependencyPool.length, prunedCandidateCount: units.length, simulatedStateCount: 0, maxFrontierSize: 0, packageCandidateCount: packages.length };
    let frontier = [{ id: "baseline", mutations: [], used: [], plan: baselinePlan, planSignature: signature(baselinePlan), facts: { understaffing: Infinity, coverageWorsened: 0, monthEffect: Infinity, constraintRisk: 0, changes: 0 } }], accepted = [];
    for (let depth = 0; depth < config.maxDepth && counters.simulatedStateCount < config.maxSimulations; depth += 1) {
      const next = [];
      for (const state of frontier) for (const unit of units) {
        if (counters.simulatedStateCount >= config.maxSimulations) break;
        if (state.used.includes(unit.unitId)) continue;
        const mutations = mergeMutations(state.mutations, unit.mutations); if (!mutations) continue;
        counters.simulatedStateCount += 1;
        const simulation = typeof context.simulateState === "function" ? context.simulateState(clone(baselinePlan), clone(mutations), clone(context)) : defaultSimulation(context, clone(baselinePlan), clone(mutations));
        if (!(simulation?.valid ?? simulation?.constraintResults?.allowed)) continue;
        const plan = clone(simulation.simulatedPlan || simulation.workingPlan); if (!plan) continue;
        const domainFacts = evaluateVariantFacts(plan, mutations, domainContext, simulation);
        if (domainFacts.gfbOverBudgetMinutes > 0) continue;
        const value = { id: stableId("state", { mutations }), mutations, used: [...state.used, unit.unitId].sort(), plan, planSignature: signature(plan), facts: factsOf(simulation, mutations), domainFacts, simulation };
        next.push(value); accepted.push(value);
      }
      frontier = prune(next, config.beamWidth); counters.maxFrontierSize = Math.max(counters.maxFrontierSize, frontier.length); if (!frontier.length) break;
    }
    const finalStates = prune(accepted, Math.max(config.beamWidth, config.maxResults)).sort(compareStates).slice(0, Math.min(3, config.maxResults));
    const beforeUnderstaffing = Number(context.baselineFacts?.understaffingMinutes ?? context.understaffingMinutesBefore ?? 0);
    const variants = finalStates.map((state, index) => {
      const dates = [...new Set(state.mutations.map(value => value.isoDate))].sort(), employees = [...new Set(state.mutations.map(value => String(value.employeeId)))].sort();
      const explanationFacts = clone(state.domainFacts);
      return { variantId: stableId("p2variant", { baseline: signature(baselinePlan), mutations: state.mutations }), recommended: index === 0, workingPlan: clone(state.plan), appliedMutations: clone(state.mutations), appliedPackageIds: state.used, affectedIsoDates: dates, affectedEmployeeIds: employees, outsideSelectedWeeks: dates.filter(date => !(input.selectedWeeks || []).includes(monday(date))), hardConstraintResult: { allowed: true, violations: [] }, understaffingFacts: { before: beforeUnderstaffing, after: state.facts.understaffing }, totalChangeCount: state.mutations.length, rankingFacts: { ...clone(state.facts), rankingVector: rankingVector(state.domainFacts) }, variantFacts: clone(state.domainFacts), explanationFacts, externalHelpHints: clone(explanationFacts.externalHelpHints), debugCounters: clone(counters) };
    });
    return { status: "success", variants, debugCounters: counters, config: clone(config) };
  }
  const api = { DEFAULT_CONFIG, run, evaluateVariantFacts, compareDomainFacts, _test: { dominates, prune, representativeSelection, signature, stableId, normalizeVariantFacts, rankingVector } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Planning2PlaygroundOptimizer = api;
})(typeof window !== "undefined" ? window : globalThis);
