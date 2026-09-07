"use strict";

/* A small, deliberately demand-driven bridge into the existing Planning-2 A-D
 * pipeline. It owns neither candidate rules nor ranking policy. */
(function initPlanning2TargetedSuggestions(globalScope) {
  const DEFAULT_LIMIT = 3;
  const DEFAULT_CANDIDATE_CAP = 48;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function problemIdFor(problem) {
    return problem.problemId || (typeof globalScope.planning2ProblemId === "function"
      ? globalScope.planning2ProblemId(problem.isoDate, problem.gap)
      : `${problem.isoDate}|understaffing|${problem.gap.start}|${problem.gap.end}`);
  }
  function targetsProblem(value, problemId, problem) {
    if (value.problemId === problemId || (value.problemIds || []).includes(problemId)) return true;
    const gap = value.understaffingWindow;
    return value.isoDate === problem.isoDate && gap?.start === problem.gap.start && gap?.end === problem.gap.end;
  }
  function candidateAsPackage(candidate, simulation) {
    const existingCoverageFacts = candidate.coverageFacts || simulation?.coverageFacts || {};
    return {
      ...candidate,
      suggestionId: candidate.candidateId,
      packageType: "TARGETED_CANDIDATE",
      mutations: [...(candidate.mutations || []), ...(candidate.requiredFollowUpMutations || [])],
      sourceCandidateIds: [candidate.candidateId].filter(Boolean),
      coverageFacts: {
        ...clone(existingCoverageFacts),
        improvedMinutes: existingCoverageFacts.improvedMinutes ?? candidate.improvedMinutes ?? candidate.coverageEffect ?? null,
        fullyResolved: existingCoverageFacts.fullyResolved ?? candidate.resolvesTargetGap === true
      }
    };
  }
  function centralRankingFacts(suggestion) {
    const coverage = suggestion.coverageFacts || {};
    const difference = Number(suggestion.projectedDifferenceMinutes);
    const facts = {
      understaffingMinutes: coverage.understaffingMinutesAfter,
      understaffingEmployeeMinutes: coverage.understaffingMinutesAfter,
      totalMinusMinutes: Number.isFinite(difference) ? Math.max(0, -difference) : null,
      totalUnnecessaryPlusMinutes: Number.isFinite(difference) ? Math.max(0, difference) : null,
      gfbUsefulUtilization: suggestion.isGfb ? suggestion.gfbMonthAdditionalMinutes : null,
      consecutiveWorkdayPenalty: suggestion.hasRegularFreeDay === false ? 1 : suggestion.hasRegularFreeDay === true ? 0 : null,
      preferenceViolationMinutes: suggestion.features?.preferenceViolationMinutes ?? null,
      outsideSelectedWeekChangeCount: suggestion.baselineFacts?.outsideSelectedWeekChangeCount ?? null,
      changeCount: suggestion.disruptionFacts?.mutationCount ?? suggestion.mutations?.length ?? null,
      changeMagnitudeMinutes: suggestion.features?.changeMagnitudeMinutes ?? suggestion.changeMinutes ?? null
    };
    return { ...(suggestion.rankingFacts || {}), ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))) };
  }
  function remainingExternalHelp(problem, suggestion) {
    const sources = suggestion?.coverageFacts?.days?.filter(day => day.isoDate === problem.isoDate).flatMap(day => day.after?.gaps || [])
      || suggestion?.coverageAfter?.gaps || suggestion?.coverageFacts?.remainingCoverageWindows || [];
    const windows = sources.filter(gap => gap.kind === "understaffing" && gap.end > problem.gap.start && gap.start < problem.gap.end).map(gap => ({
      isoDate: problem.isoDate,
      start: Math.max(problem.gap.start, gap.start), end: Math.min(problem.gap.end, gap.end),
      missingPeople: gap.missingPeople || Math.max(1, (gap.required || problem.gap.required || 1) - (gap.actual || gap.count || 0))
    })).filter(window => window.end > window.start);
    return windows;
  }
  function structuredReasons(suggestion) {
    const facts = suggestion.coverageFacts || {};
    const reasons = [];
    if (facts.fullyResolved || suggestion.resolvesTargetGap) reasons.push("schließt die Lücke vollständig");
    else if (facts.improvedMinutes > 0) reasons.push(`reduziert Unterbesetzung um ${Math.round(facts.improvedMinutes / 60 * 10) / 10} Std.`);
    if (suggestion.isGfb) reasons.push("nutzt GFB-Restbudget");
    if (suggestion.hasRegularFreeDay || suggestion.disruptionFacts?.touchesFreeDay === false) reasons.push("erhält freien Tag");
    if ((suggestion.requiredFollowUpMutations || []).length || suggestion.disruptionFacts?.followUpCount) reasons.push("benötigt Ausgleich am Folgetag");
    return reasons.slice(0, 2);
  }

  function createPlanning2TargetedSuggestionService(dependencies = {}) {
    const generate = dependencies.generateCandidates || globalScope.generatePlanning2CandidateEvaluation;
    const generatePackages = dependencies.generatePackages || globalScope.generatePlanning2MutationPackages;
    const rankCandidates = dependencies.rankCandidates || globalScope.rankPlanning2Candidates;
    const rankPackages = dependencies.rankPackages || globalScope.rankPlanning2MutationPackages;
    const simulatePackage = dependencies.simulatePackage || globalScope.simulatePlanning2MutationPackage;
    const compareCentralFacts = dependencies.compareCentralFacts || globalScope.Planning2PlaygroundOptimizer?.compareDomainFacts;
    let runCount = 0;

    function request(context, problem, options = {}) {
      runCount += 1;
      const problemId = problemIdFor(problem);
      const targetDay = (context.days || []).find(day => day.isoDate === problem.isoDate);
      if (!targetDay) return { problem: clone(problem), suggestions: [], externalHelp: null, generationFacts: { bounded: true, candidateCount: 0 } };
      const targetContext = { ...context, days: [targetDay], enableExistingShiftMutations: true, packageTopK: Math.min(6, Number(options.packageTopK) || 6) };
      const evaluation = generate(targetContext);
      const cap = Math.max(1, Number(options.candidateCap) || DEFAULT_CANDIDATE_CAP);
      const valid = (evaluation.candidates || []).filter(candidate => candidate.constraintResults?.allowed !== false && targetsProblem(candidate, problemId, problem)).slice(0, cap);
      const compensationRoots = (evaluation.rejected || []).filter(candidate => candidate.requiresCompensatingPackage && targetsProblem(candidate, problemId, problem)).slice(0, 6);
      let support = [];
      if (compensationRoots.length) {
        const employeeIds = new Set(compensationRoots.map(candidate => String(candidate.employeeId)));
        const supportContext = {
          ...context,
          days: (context.days || []).slice(0, 6),
          employees: (context.employees || []).filter(person => employeeIds.has(String(person.employeeId))),
          enableExistingShiftMutations: true
        };
        const supportEvaluation = generate(supportContext);
        support = (supportEvaluation.candidates || []).filter(candidate => candidate.mutationType === "SHIFT_REMOVE" && employeeIds.has(String(candidate.employeeId))).slice(0, 12);
      }
      const packageInput = [...valid, ...compensationRoots, ...support].slice(0, cap);
      const packages = generatePackages ? generatePackages(context, packageInput) : { packages: [], generationFacts: {} };
      const validPackages = (packages.packages || []).filter(item => item.valid !== false && targetsProblem(item, problemId, problem));
      const toSuggestion = candidate => {
        const mutations = [...(candidate.mutations || []), ...(candidate.requiredFollowUpMutations || [])];
        const simulation = typeof simulatePackage === "function" ? simulatePackage(targetContext, { ...candidate, packageType: "TARGETED_CANDIDATE", mutations }) : null;
        return candidateAsPackage(candidate, simulation);
      };
      const rankedCandidates = rankCandidates ? rankCandidates(valid).map(toSuggestion) : valid.map(toSuggestion);
      const rankedPackages = rankPackages ? rankPackages(validPackages) : validPackages;
      const combined = [...rankedPackages, ...rankedCandidates].map((item, stableIndex) => ({ ...item, targetedRankingFacts: centralRankingFacts(item), targetedStableIndex: stableIndex }));
      if (typeof compareCentralFacts === "function") combined.sort((left, right) => compareCentralFacts(left.targetedRankingFacts, right.targetedRankingFacts) || left.targetedStableIndex - right.targetedStableIndex);
      const seen = new Set();
      const suggestions = combined.filter(item => {
        const key = JSON.stringify(item.mutations || []);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, Math.min(DEFAULT_LIMIT, Number(options.limit) || DEFAULT_LIMIT)).map(item => ({ ...item, reasons: structuredReasons(item) }));
      const complete = suggestions.some(item => item.coverageFacts?.fullyResolved || item.resolvesTargetGap);
      const remainingWindows = complete ? [] : remainingExternalHelp(problem, suggestions[0]);
      const fallbackWindow = { isoDate: problem.isoDate, start: problem.gap.start, end: problem.gap.end, missingPeople: problem.gap.missingPeople || 1 };
      return {
        problem: { ...clone(problem), problemId }, suggestions,
        externalHelp: complete ? null : { windows: remainingWindows.length ? remainingWindows : [fallbackWindow], actionable: false },
        generationFacts: { bounded: true, candidateCap: cap, candidateCount: valid.length, ...(packages.generationFacts || {}) }
      };
    }
    return { request, getRunCount: () => runCount };
  }

  const api = { createPlanning2TargetedSuggestionService, structuredReasons, problemIdFor, centralRankingFacts, remainingExternalHelp };
  globalScope.Planning2TargetedSuggestions = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
