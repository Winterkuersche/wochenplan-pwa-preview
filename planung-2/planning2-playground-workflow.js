"use strict";

/* Stage E4 state transitions.  Keeping these outside the DOM makes the
 * playground atomic, persistent and independently testable. */
(function installPlanning2PlaygroundWorkflow(root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const selectedVariant = session => (session.variants || []).find(item => item.variantId === session.selectedVariantId) || null;

  function selectVariant(session, variantId) {
    const variant = (session.variants || []).find(item => item.variantId === variantId);
    if (!variant) return false;
    session.selectedVariantId = variantId;
    session.workingPlan = clone(variant.workingPlan);
    return true;
  }

  function replaceVariants(session, variants, optimizationBasePlan = session.workingPlan) {
    session.variants = clone((variants || []).slice(0, 3)).map((variant, index) => ({ ...variant, recommended: index === 0, optimizationBasePlan: clone(optimizationBasePlan) }));
    session.selectedVariantId = session.variants[0]?.variantId || "";
    if (session.variants[0]) session.workingPlan = clone(session.variants[0].workingPlan);
  }

  async function optimize(session, runOptimizer, context, options = {}) {
    if (session.optimization?.status === "running") return { status: "busy" };
    const variant = selectedVariant(session);
    if (options.fromHere && variant?.hardConstraintResult?.allowed === false) return { status: "invalid", violations: clone(variant.hardConstraintResult.violations || []) };
    session.optimization = { status: "running", error: "" };
    options.onState?.(session);
    const input = clone(session);
    if (options.fromHere && variant) { input.workingPlan = clone(variant.workingPlan); input.source = `variant:${variant.variantId}`; }
    try {
      const result = await Promise.resolve().then(() => runOptimizer(input, context, { maxResults: 3 }));
      if (!result || result.status !== "success") throw new Error(result?.error || "Optimierung abgebrochen");
      replaceVariants(session, result.variants, input.workingPlan);
      session.source = input.source || session.source;
      session.optimization = { status: "success", error: "" };
      session.updatedAt = new Date().toISOString();
      options.onState?.(session);
      return result;
    } catch (error) {
      // Only the transient status changes. Plans, variants, edits and locks are untouched.
      session.optimization = { status: "error", error: String(error?.message || error) };
      options.onState?.(session);
      return { status: "error", error };
    }
  }

  function reevaluateSelected(session, evaluator) {
    const variant = selectedVariant(session);
    if (!variant) return null;
    const result = evaluator(clone(variant.workingPlan), clone(variant.optimizationBasePlan || session.basePlan), clone(session.basePlan));
    variant.variantFacts = clone(result.variantFacts || result.facts || result);
    variant.explanationFacts = clone(result.explanationFacts || variant.variantFacts);
    variant.externalHelpHints = clone(result.externalHelpHints || variant.variantFacts?.externalHelpHints || []);
    variant.hardConstraintResult = clone(result.hardConstraintResult || { allowed: true, violations: [] });
    return variant;
  }

  // Exact entry diff for manual revalidation. Status entries must never be
  // collapsed to null; the central package simulator decides their semantics.
  function planMutations(before, after) {
    const mutations = [], dates = new Set([...Object.keys(before?.schedule || {}), ...Object.keys(after?.schedule || {})]);
    dates.forEach(isoDate => new Set([...Object.keys(before?.schedule?.[isoDate] || {}), ...Object.keys(after?.schedule?.[isoDate] || {})]).forEach(employeeId => {
      const oldEntry = before?.schedule?.[isoDate]?.[employeeId] || null, nextEntry = after?.schedule?.[isoDate]?.[employeeId] || null;
      if (JSON.stringify(oldEntry) !== JSON.stringify(nextEntry)) mutations.push({ isoDate, employeeId, before: clone(oldEntry), after: clone(nextEntry) });
    }));
    return mutations;
  }

  const api = { optimize, planMutations, reevaluateSelected, replaceVariants, selectVariant, selectedVariant };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Planning2PlaygroundWorkflow = api;
})(typeof window !== "undefined" ? window : globalThis);
