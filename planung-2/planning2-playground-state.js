"use strict";
(function (root) {
  const STORAGE_KEY = "wochenplan_planning2_playground_v1";
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const stableValue = value => Array.isArray(value) ? value.map(stableValue) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value;
  const planSignature = plan => JSON.stringify(stableValue(plan || {}));
  const todayIso = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function mondayIso(iso) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() - (d.getDay() || 7) + 1); return todayIso(d); }
  function createSession({ month, plan, selectedWeeks = [], now = new Date() }) {
    const createdAt = now.toISOString(), seed = createdAt.replace(/\D/g, "").slice(0, 17);
    return { version: 1, id: `p2pg_${month}_${seed}`, month, createdAt, updatedAt: createdAt, source: "current-plan", sourcePlanSignature: planSignature(plan), selectedWeeks: [...new Set(selectedWeeks)].sort(), workingPlan: clone(plan || {}), basePlan: clone(plan || {}), variants: [], selectedVariantId: "", optimization: { status: "idle", error: "" }, locks: [], nextLockSequence: 1 };
  }
  const lockKey = lock => [lock.scope, lock.employeeId || "", lock.isoDate || "", lock.weekId || ""].join("|");
  function addLock(session, lock, options = {}) {
    const value = { scope: lock.scope, employeeId: lock.employeeId || "", isoDate: lock.isoDate || "", weekId: lock.weekId || (lock.isoDate ? mondayIso(lock.isoDate) : ""), origin: options.origin || lock.origin || "manual", outsideSelectedWeek: Boolean(lock.isoDate && !session.selectedWeeks.includes(mondayIso(lock.isoDate))) };
    const existing = session.locks.find(item => lockKey(item) === lockKey(value)); if (existing) return existing;
    const result = { id: `lock_${String(session.nextLockSequence++).padStart(6, "0")}`, ...value }; session.locks.push(result); return result;
  }
  function removeLock(session, id) { const count = session.locks.length; session.locks = session.locks.filter(lock => lock.id !== id); return count !== session.locks.length; }
  function matches(lock, employeeId, isoDate) { const week = mondayIso(isoDate); return lock.scope === "shift" ? lock.employeeId === employeeId && lock.isoDate === isoDate : lock.scope === "day" ? lock.isoDate === isoDate : lock.scope === "employee-week" ? lock.employeeId === employeeId && lock.weekId === week : lock.scope === "week" ? lock.weekId === week : lock.scope === "employee-period" && lock.employeeId === employeeId; }
  function getConstraint(session, employeeId, isoDate, now = new Date()) { if (isoDate <= todayIso(now)) return { locked: true, reason: "past-or-today", lock: null }; const lock = session.locks.find(item => matches(item, employeeId, isoDate)); return lock ? { locked: true, reason: lock.scope, lock } : { locked: false, reason: "", lock: null }; }
  function setWorkingEntry(session, employeeId, isoDate, entry, options = {}) {
    const constraint = getConstraint(session, employeeId, isoDate, options.now); if (constraint.locked && !(constraint.reason === "shift" && constraint.lock.origin === "automatic-manual")) return { changed: false, reason: constraint.reason };
    session.workingPlan.schedule ||= {}; session.workingPlan.schedule[isoDate] ||= {}; if (entry) session.workingPlan.schedule[isoDate][employeeId] = clone(entry); else delete session.workingPlan.schedule[isoDate][employeeId]; if (!Object.keys(session.workingPlan.schedule[isoDate]).length) delete session.workingPlan.schedule[isoDate];
    const automaticLock = addLock(session, { scope: "shift", employeeId, isoDate }, { origin: "automatic-manual" }); session.updatedAt = (options.now || new Date()).toISOString(); return { changed: true, automaticLock, outsideSelectedWeek: automaticLock.outsideSelectedWeek };
  }
  function commitWorkingPlan(session, employeeId, isoDate, nextPlan, options = {}) {
    const constraint = getConstraint(session, employeeId, isoDate, options.now);
    if (constraint.locked && !(constraint.reason === "shift" && constraint.lock.origin === "automatic-manual")) return { changed: false, reason: constraint.reason };
    if (JSON.stringify(session.workingPlan) === JSON.stringify(nextPlan)) return { changed: false, reason: "unchanged" };
    session.workingPlan = clone(nextPlan);
    const variant = (session.variants || []).find(item => item.variantId === session.selectedVariantId);
    if (variant) { variant.workingPlan = clone(nextPlan); variant.manuallyEdited = true; }
    const automaticLock = addLock(session, { scope: "shift", employeeId, isoDate }, { origin: "automatic-manual" });
    session.updatedAt = (options.now || new Date()).toISOString();
    return { changed: true, automaticLock, outsideSelectedWeek: automaticLock.outsideSelectedWeek };
  }
  function setSelectedWeeks(session, ids) { session.selectedWeeks = [...new Set(ids)].sort(); session.locks.forEach(lock => { lock.outsideSelectedWeek = Boolean(lock.isoDate && !session.selectedWeeks.includes(mondayIso(lock.isoDate))); }); }
  function hydrate(value) { if (!value || value.version !== 1) return null; value.basePlan ||= clone(value.workingPlan || {}); value.sourcePlanSignature ||= planSignature(value.basePlan); value.variants ||= []; value.selectedVariantId ||= ""; value.optimization ||= { status: "idle", error: "" }; value.variants.forEach(variant => { variant.optimizationBasePlan ||= clone(value.basePlan); }); const selected = value.variants.find(variant => variant.variantId === value.selectedVariantId); if (selected) value.workingPlan = clone(selected.workingPlan); return value; }
  function createRepository(storage) { return { load() { try { return hydrate(JSON.parse(storage.getItem(STORAGE_KEY))); } catch { return null; } }, save(session) { storage.setItem(STORAGE_KEY, JSON.stringify(session)); return session; }, discard() { storage.removeItem(STORAGE_KEY); } }; }
  const api = { STORAGE_KEY, addLock, clone, commitWorkingPlan, createRepository, createSession, getConstraint, hydrate, mondayIso, planSignature, removeLock, setSelectedWeeks, setWorkingEntry, todayIso }; if (typeof module !== "undefined" && module.exports) module.exports = api; root.Planning2PlaygroundState = api;
})(typeof window !== "undefined" ? window : globalThis);
