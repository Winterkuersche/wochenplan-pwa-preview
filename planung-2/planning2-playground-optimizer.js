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
  const compareStates = (a, b) => a.facts.understaffing - b.facts.understaffing || a.facts.coverageWorsened - b.facts.coverageWorsened || a.facts.constraintRisk - b.facts.constraintRisk || a.facts.monthEffect - b.facts.monthEffect || a.facts.changes - b.facts.changes || a.id.localeCompare(b.id);
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
        const value = { id: stableId("state", { mutations }), mutations, used: [...state.used, unit.unitId].sort(), plan, planSignature: signature(plan), facts: factsOf(simulation, mutations), simulation };
        next.push(value); accepted.push(value);
      }
      frontier = prune(next, config.beamWidth); counters.maxFrontierSize = Math.max(counters.maxFrontierSize, frontier.length); if (!frontier.length) break;
    }
    const finalStates = prune(accepted, Math.max(config.beamWidth, config.maxResults)).slice(0, Math.min(3, config.maxResults));
    const beforeUnderstaffing = Number(context.baselineFacts?.understaffingMinutes ?? context.understaffingMinutesBefore ?? 0);
    const variants = finalStates.map((state, index) => {
      const dates = [...new Set(state.mutations.map(value => value.isoDate))].sort(), employees = [...new Set(state.mutations.map(value => String(value.employeeId)))].sort();
      return { variantId: stableId("p2variant", { baseline: signature(baselinePlan), mutations: state.mutations }), recommended: index === 0, workingPlan: clone(state.plan), appliedMutations: clone(state.mutations), appliedPackageIds: state.used, affectedIsoDates: dates, affectedEmployeeIds: employees, outsideSelectedWeeks: dates.filter(date => !(input.selectedWeeks || []).includes(monday(date))), hardConstraintResult: { allowed: true, violations: [] }, understaffingFacts: { before: beforeUnderstaffing, after: state.facts.understaffing }, totalChangeCount: state.mutations.length, rankingFacts: clone(state.facts), debugCounters: clone(counters) };
    });
    return { status: "success", variants, debugCounters: counters, config: clone(config) };
  }
  const api = { DEFAULT_CONFIG, run, _test: { dominates, prune, representativeSelection, signature, stableId } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Planning2PlaygroundOptimizer = api;
})(typeof window !== "undefined" ? window : globalThis);
