"use strict";
(function installPlanning2PlaygroundAcceptance(root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const failure = (code, message) => ({ ok: false, code, message });
  const conflictError = message => Object.assign(new Error(message), { code: "PLAN_CONFLICT" });
  const acceptanceIdFor = (session, variant) => [session.id, variant.variantId, session.sourcePlanSignature, root.Planning2PlaygroundState.planSignature(variant.workingPlan)].join("|");

  async function cleanup(result, discardPlayground) {
    try { await discardPlayground(); return result; }
    catch (error) { return { ...result, warnings: [{ code: "PLAYGROUND_CLEANUP_FAILED", message: String(error?.message || error) }] }; }
  }

  async function accept({ session, adapter, revalidate, discardPlayground, now = new Date() }) {
    const variant = (session?.variants || []).find(item => item.variantId === session.selectedVariantId);
    if (!variant) return failure("NO_VARIANT", "Keine Variante ausgewählt.");
    const acceptanceId = acceptanceIdFor(session, variant);
    let validation;
    try { validation = await revalidate(clone(variant.workingPlan), clone(variant.optimizationBasePlan || session.basePlan), clone(session)); }
    catch (error) { return failure("VALIDATION_ERROR", `Validierung fehlgeschlagen: ${error?.message || error}`); }
    const hard = validation?.hardConstraintResult || validation?.constraintResults || validation;
    if (!hard || hard.allowed === false) return failure("HARD_INVALID", "Diese Variante kann nicht übernommen werden, solange Hard-Constraint-Verletzungen bestehen.");

    // A retry after a completed commit (most notably after cleanup failure) is
    // successful and returns the exact persisted record without another version.
    try {
      const history = clone(await adapter.readOptimizationHistory(session.month)) || [];
      const existing = history.find(item => item.acceptanceId === acceptanceId);
      if (existing) return cleanup({ ok: true, record: clone(existing), plan: clone(variant.workingPlan), alreadyCommitted: true }, discardPlayground);
      const currentPlan = clone(await adapter.readCurrentPlan());
      const expectedCurrentPlanSignature = root.Planning2PlaygroundState.planSignature(currentPlan);
      if (expectedCurrentPlanSignature !== session.sourcePlanSignature) return failure("PLAN_CONFLICT", "Der aktuelle Plan wurde seit Start des Spielplatzes geändert. Bitte den Spielplatz neu vom aktuellen Plan starten.");
      const record = root.Planning2OptimizationHistory.createRecord({ session, variant, currentPlan, history, validation, acceptanceId, now });
      const commit = await adapter.commitAcceptance({ acceptanceId, month: session.month, expectedCurrentPlanSignature, currentPlan, nextPlan: clone(variant.workingPlan), oldHistory: history, nextHistory: [...history, clone(record)], record: clone(record) });
      const committedRecord = clone(commit?.record || record);
      return cleanup({ ok: true, record: committedRecord, plan: clone(variant.workingPlan), alreadyCommitted: commit?.alreadyCommitted === true }, discardPlayground);
    } catch (error) {
      if (error?.code === "PLAN_CONFLICT") return failure("PLAN_CONFLICT", "Der aktuelle Plan wurde seit Start des Spielplatzes geändert. Bitte den Spielplatz neu vom aktuellen Plan starten.");
      return failure("STORAGE_ERROR", `Übernahme fehlgeschlagen: ${error?.message || error}`);
    }
  }

  function createLocalStorageAdapter({ storage, planKey, historyRepository, journalKey = "wochenplan_planning2_acceptance_transaction_v1" }) {
    const raw = key => storage.getItem(key);
    const putRaw = (key, value) => value === null ? storage.removeItem(key) : storage.setItem(key, value);
    function recover() {
      const text = raw(journalKey); if (!text) return;
      const journal = JSON.parse(text);
      if (!journal?.newPlanRaw || !journal?.newHistoryRaw) throw new Error("Ungültiges Acceptance-Journal");
      // PREPARED is deliberately rolled forward: the immutable envelope already
      // contains the complete pair, so readers can never accept only one half.
      putRaw(planKey, journal.newPlanRaw); putRaw(historyRepository.key, journal.newHistoryRaw);
      storage.setItem(journalKey, JSON.stringify({ ...journal, state: "COMMITTED" }));
      // Journal cleanup is not part of the commit decision.  A retained
      // COMMITTED envelope is safe and will be replayed idempotently.
      try { storage.removeItem(journalKey); } catch {}
    }
    function readHistory(month) { recover(); return historyRepository.readOptimizationHistory(month); }
    return {
      readCurrentPlan() { recover(); return JSON.parse(raw(planKey) || "{}"); },
      readOptimizationHistory: readHistory,
      async commitAcceptance({ acceptanceId, month, expectedCurrentPlanSignature, nextPlan, nextHistory, record }) {
        recover();
        const allHistory = historyRepository.readAll(), existing = allHistory.find(item => item.acceptanceId === acceptanceId);
        if (existing) return { alreadyCommitted: true, record: clone(existing) };
        const current = JSON.parse(raw(planKey) || "{}");
        if (root.Planning2PlaygroundState.planSignature(current) !== expectedCurrentPlanSignature) throw conflictError("Current plan changed before commit");
        const otherMonths = allHistory.filter(item => item.month !== month), completeHistory = [...otherMonths, ...clone(nextHistory)];
        const journal = { version: 1, state: "PREPARED", transactionId: acceptanceId, oldPlanRaw: raw(planKey), oldHistoryRaw: raw(historyRepository.key), newPlanRaw: JSON.stringify(clone(nextPlan)), newHistoryRaw: JSON.stringify(completeHistory) };
        storage.setItem(journalKey, JSON.stringify(journal));
        try { recover(); }
        catch (error) { throw error; }
        return { alreadyCommitted: false, record: clone(record) };
      },
      recover
    };
  }
  const api = { accept, acceptanceIdFor, createLocalStorageAdapter };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Planning2PlaygroundAcceptance = api;
})(typeof window !== "undefined" ? window : globalThis);
