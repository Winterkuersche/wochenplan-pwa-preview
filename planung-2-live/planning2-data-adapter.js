(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Planning2DataAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MASTER_KEY = "wochenplan_master_v10";
  const PLAN_KEY = "wochenplan_plan_v10";

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readJson(storage, key, fallback) {
    try {
      const value = JSON.parse(storage.getItem(key));
      return value == null ? clone(fallback) : value;
    } catch (_error) {
      return clone(fallback);
    }
  }

  function createPlanning2DataAdapter(storage) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new TypeError("Planning 2 benötigt einen Storage mit getItem/setItem.");
    }

    function readMaster() {
      const master = readJson(storage, MASTER_KEY, { employees: [] });
      return {
        ...master,
        employees: Array.isArray(master.employees) ? clone(master.employees) : []
      };
    }

    function readPlan() {
      const plan = readJson(storage, PLAN_KEY, {});
      return {
        ...plan,
        schedule: plan.schedule && typeof plan.schedule === "object" && !Array.isArray(plan.schedule)
          ? clone(plan.schedule)
          : {},
        absences: Array.isArray(plan.absences) ? clone(plan.absences) : [],
        monthlyPlanBaselines: plan.monthlyPlanBaselines && typeof plan.monthlyPlanBaselines === "object"
          ? clone(plan.monthlyPlanBaselines)
          : {}
      };
    }

    function savePlan(plan) {
      storage.setItem(PLAN_KEY, JSON.stringify(plan));
      return true;
    }

    return { readMaster, readPlan, savePlan, masterKey: MASTER_KEY, planKey: PLAN_KEY };
  }

  return { createPlanning2DataAdapter, MASTER_KEY, PLAN_KEY };
});
