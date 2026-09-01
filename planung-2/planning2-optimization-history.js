"use strict";
(function installPlanning2OptimizationHistory(root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const CHANGE = Object.freeze({ ADDED: "SHIFT_ADDED", CHANGED: "SHIFT_CHANGED", REMOVED: "SHIFT_REMOVED", STATUS: "STATUS_CHANGED" });
  const isShift = entry => entry?.type === "shift";
  const entryMinutes = entry => isShift(entry) ? Number(entry.minutes ?? entry.workMinutes ?? 0) || 0 : 0;
  function planChanges(before, after) {
    const changes = [], dates = new Set([...Object.keys(before?.schedule || {}), ...Object.keys(after?.schedule || {})]);
    [...dates].sort().forEach(isoDate => {
      const ids = new Set([...Object.keys(before?.schedule?.[isoDate] || {}), ...Object.keys(after?.schedule?.[isoDate] || {})]);
      [...ids].sort().forEach(employeeId => {
        const oldEntry = before?.schedule?.[isoDate]?.[employeeId] || null, nextEntry = after?.schedule?.[isoDate]?.[employeeId] || null;
        if (JSON.stringify(oldEntry) === JSON.stringify(nextEntry)) return;
        const changeType = !oldEntry && isShift(nextEntry) ? CHANGE.ADDED : isShift(oldEntry) && !nextEntry ? CHANGE.REMOVED : isShift(oldEntry) && isShift(nextEntry) ? CHANGE.CHANGED : CHANGE.STATUS;
        changes.push({ employeeId, isoDate, before: clone(oldEntry), after: clone(nextEntry), changeType });
      });
    });
    return changes;
  }
  function createRecord({ session, variant, currentPlan, history = [], validation, acceptanceId, now = new Date() }) {
    const version = Math.max(0, ...history.map(item => Number(item.version) || 0)) + 1;
    const facts = clone(validation?.variantFacts || variant.variantFacts || {}), explanationFacts = clone(validation?.explanationFacts || variant.explanationFacts || facts), changes = planChanges(currentPlan, variant.workingPlan);
    const selected = new Set(session.selectedWeeks || []), monday = root.Planning2PlaygroundState?.mondayIso || (iso => iso);
    const outsideSelectedWeekChanges = changes.filter(item => !selected.has(monday(item.isoDate)));
    const acceptedAt = now.toISOString();
    return clone({
      id: `planning2-optimization-${session.month}-${version}-${acceptedAt.replace(/\D/g, "")}`,
      version, label: `Optimierung ${version}`, month: session.month, acceptedAt,
      acceptanceId, transactionId: acceptanceId, playgroundId: session.id, variantId: variant.variantId, recommended: variant.recommended === true,
      selectedWeeks: session.selectedWeeks || [], optimizationRoundSource: session.source,
      changes, addedShifts: changes.filter(item => item.changeType === CHANGE.ADDED), changedShifts: changes.filter(item => item.changeType === CHANGE.CHANGED), removedShifts: changes.filter(item => item.changeType === CHANGE.REMOVED),
      outsideSelectedWeekChanges, locks: session.locks || [],
      hoursBefore: facts.hoursBefore || changes.map(item => ({ employeeId: item.employeeId, isoDate: item.isoDate, minutes: entryMinutes(item.before) })),
      hoursAfter: facts.hoursAfter || changes.map(item => ({ employeeId: item.employeeId, isoDate: item.isoDate, minutes: entryMinutes(item.after) })),
      employeeBalances: facts.employeeBalances || [], employeesInMinus: facts.employeesInMinus || 0, employeesInPlus: facts.employeesInPlus || 0,
      gfb: facts.gfb || { budgetMinutes: facts.gfbBudgetMinutes, usedMinutes: facts.gfbUsedMinutes, remainingMinutes: facts.gfbRemainingMinutes },
      remainingUnderstaffingMinutes: facts.understaffingMinutes || 0, coverageFacts: facts.coverageFacts || facts.coverage || { remainingCoverageWindows: facts.remainingCoverageWindows || [], fullyCovered: facts.fullyCovered }, saturdayFacts: facts.saturdayFacts || [], preferenceViolations: facts.preferenceViolations || [],
      warnings: facts.warnings || validation?.hardConstraintResult?.violations || [], externalHelpHints: validation?.externalHelpHints || variant.externalHelpHints || facts.externalHelpHints || [], carryoverFacts: facts.carryoverFacts || facts.followUpFacts || [],
      variantFacts: facts, explanationFacts, hardConstraintResult: validation?.hardConstraintResult || validation
    });
  }
  function createStorageRepository(storage, key = "wochenplan_planning2_optimization_history_v1") {
    const readAll = () => { try { const value = JSON.parse(storage.getItem(key)); return Array.isArray(value) ? clone(value) : []; } catch { return []; } };
    return { readOptimizationHistory(month) { return readAll().filter(item => item.month === month); }, writeOptimizationHistory(month, history) { const other = readAll().filter(item => item.month !== month); storage.setItem(key, JSON.stringify([...other, ...clone(history)])); }, readAll, key };
  }
  const api = { CHANGE, clone, createRecord, createStorageRepository, planChanges };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Planning2OptimizationHistory = api;
})(typeof window !== "undefined" ? window : globalThis);
