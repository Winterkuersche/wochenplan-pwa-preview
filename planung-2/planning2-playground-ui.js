"use strict";

(function installPlanning2PlaygroundUi() {
  const api = window.Planning2PlaygroundState;
  const LIVE_PLAN_KEY = "wochenplan_plan_v10_planning2_preview";
  const MASTER_KEY = "wochenplan_master_v10_planning2_preview";
  if (!api) return;

  const repository = api.createRepository(localStorage);
  let session = null;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  }

  function getMonthWeeks(month) {
    const last = new Date(`${month}-01T00:00:00`);
    last.setMonth(last.getMonth() + 1, 0);
    const cursor = new Date(`${api.mondayIso(`${month}-01`)}T00:00:00`);
    const result = [];
    while (cursor <= last) {
      const days = [];
      for (let index = 0; index < 6; index += 1) {
        const day = new Date(cursor);
        day.setDate(cursor.getDate() + index);
        days.push(api.todayIso(day));
      }
      result.push({ id: days[0], days });
      cursor.setDate(cursor.getDate() + 7);
    }
    return result;
  }

  function ensureSession() {
    session = repository.load();
    if (session) return;
    const plan = readJson(LIVE_PLAN_KEY, { schedule: {}, absences: [] });
    const month = String(plan.weekFrom || new Date().toISOString()).slice(0, 7);
    session = api.createSession({ month, plan, selectedWeeks: getMonthWeeks(month).map(week => week.id) });
    repository.save(session);
  }

  function entryLabel(entry) {
    if (entry?.type === "shift") return `${entry.start || "?"}–${entry.end || "?"}`;
    if (entry?.type === "off") return "Frei";
    if (entry?.type === "vacation") return "Urlaub";
    if (entry?.type === "sick") return "Krank";
    if (entry?.type === "external-help") return `AH${entry.branch ? ` · ${entry.branch}` : ""}`;
    return entry ? entry.code || entry.type : "—";
  }

  function resolvedEntry(employee, isoDate) {
    if (typeof getResolvedDayEntry !== "function") return session.workingPlan.schedule?.[isoDate]?.[employee.id] || null;
    const resolved = getResolvedDayEntry({ employee, isoDate, schedule: session.workingPlan.schedule, absences: session.workingPlan.absences, stateKey: session.workingPlan.stateKey || "schleswig-holstein" });
    return resolved?.sourceEntry || (resolved?.type && resolved.type !== "empty" ? { type: resolved.type } : null);
  }

  function exactLock(scope, employeeId = "", isoDate = "", weekId = "") {
    return session.locks.find(lock => lock.scope === scope
      && (lock.employeeId || "") === employeeId
      && (lock.isoDate || "") === isoDate
      && (lock.weekId || "") === (weekId || (isoDate ? api.mondayIso(isoDate) : "")));
  }

  function lockButton({ scope, label, employeeId = "", isoDate = "", weekId = "", disabled = false, className = "" }) {
    const lock = exactLock(scope, employeeId, isoDate, weekId);
    const action = lock ? "lösen" : "fixieren";
    return `<button type="button" class="pgLockAction ${className} ${lock ? "isActive" : ""}" data-toggle-lock="${scope}" data-eid="${escapeHtml(employeeId)}" data-iso="${isoDate}" data-week-id="${weekId}" aria-label="${escapeHtml(label)} ${action}" ${disabled ? "disabled" : ""}>🔒 ${escapeHtml(label)}${lock ? " ✓" : ""}</button>`;
  }

  function render() {
    const overlay = document.getElementById("playgroundOverlay");
    const monthWeeks = getMonthWeeks(session.month);
    const selected = new Set(session.selectedWeeks);
    const today = api.todayIso();
    const days = monthWeeks.flatMap(week => week.days).filter((day, index, all) => day.startsWith(session.month) && all.indexOf(day) === index);
    const employees = (readJson(MASTER_KEY, { employees: [] }).employees || []).filter(employee => (
      (!employee.activeFromMonth || session.month >= employee.activeFromMonth)
      && (!employee.activeToMonth || session.month <= employee.activeToMonth)
    ));

    const weekControls = monthWeeks.map((week, index) => `<div class="pgWeekControl"><label><input data-week="${week.id}" type="checkbox" ${selected.has(week.id) ? "checked" : ""}>W${index + 1} · ${week.days[0].slice(8)}.–${week.days[5].slice(8)}.</label>${lockButton({ scope: "week", label: `W${index + 1}`, weekId: week.id })}</div>`).join("");

    const rows = employees.map(employee => {
      const employeeWeekLocks = monthWeeks.map((week, index) => lockButton({
        scope: "employee-week",
        label: `W${index + 1}`,
        employeeId: employee.id,
        weekId: week.id,
        className: "pgMiniLock"
      })).join("");
      const cells = days.map(day => {
        const constraint = api.getConstraint(session, employee.id, day);
        const storedEntry = session.workingPlan.schedule?.[day]?.[employee.id];
        const displayEntry = resolvedEntry(employee, day);
        return `<div class="pgCell ${constraint.locked ? "isLocked" : ""} ${day <= today ? "isPast" : ""}"><button type="button" class="pgEditCell" data-cell data-eid="${escapeHtml(employee.id)}" data-name="${escapeHtml(employee.name || employee.id)}" data-iso="${day}" ${day <= today ? "disabled" : ""} aria-label="${day} für ${escapeHtml(employee.name || employee.id)} bearbeiten"><small>${day.slice(8)}</small><b>${escapeHtml(entryLabel(displayEntry))}</b><span>${constraint.locked ? "🔒" : "✎"}</span></button>${lockButton({ scope: "shift", label: "Schicht", employeeId: employee.id, isoDate: day, disabled: day <= today || storedEntry?.type !== "shift", className: "pgCellLock" })}</div>`;
      }).join("");
      return `<div class="pgRow"><div class="pgPerson"><b>${escapeHtml(employee.name || employee.id)}</b>${lockButton({ scope: "employee-period", label: "Zeitraum", employeeId: employee.id })}<div class="pgEmployeeWeeks" aria-label="${escapeHtml(employee.name || employee.id)} pro Woche fixieren">${employeeWeekLocks}</div></div>${cells}</div>`;
    }).join("");

    overlay.innerHTML = `<section class="pgPanel" role="dialog" aria-modal="true" aria-labelledby="pgTitle"><header><div><small>STAGE E · SPIELPLATZ</small><h2 id="pgTitle">${new Date(`${session.month}-01T00:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</h2></div><button type="button" data-close>Schließen</button></header><div class="pgOverview"><span><b>Monat</b>${session.month}</span><span><b>Ausgewählte Wochen</b>${session.selectedWeeks.length}</span><span><b>Vergangenheit/heute</b>🔒 gesperrt</span><span><b>Fixierungen</b>${session.locks.length}</span><span><b>Ausgangspunkt</b>aktueller Plan</span></div><div class="pgWeeks">${weekControls}</div><p class="pgHint">Ausgewählte Wochen sind primär, keine fachliche Sperre. Zelle antippen = bearbeiten; der separate 🔒-Knopf fixiert eine bestehende Schicht ohne Änderung.</p><div class="pgGrid"><div class="pgRow pgHead"><div>Mitarbeiter</div>${days.map(day => lockButton({ scope: "day", label: `${day.slice(8)}. Tag`, isoDate: day, disabled: day <= today }))}</div>${rows}</div><div class="pgLocks"><b>Fixierungen:</b>${session.locks.map(lock => `<button type="button" data-unlock="${lock.id}">🔒 ${escapeHtml(lock.scope)} ${escapeHtml(lock.employeeId || lock.isoDate || lock.weekId)}${lock.outsideSelectedWeek ? " · außerhalb ausgewählter Woche" : ""} ×</button>`).join("") || " keine"}</div><footer><button type="button" class="danger" data-discard>Spielplatz verwerfen</button><button type="button" disabled>Optimierung starten (folgt)</button></footer></section>`;
  }

  function toggleLock(button) {
    const scope = button.dataset.toggleLock;
    const employeeId = button.dataset.eid || "";
    const isoDate = button.dataset.iso || "";
    const weekId = button.dataset.weekId || "";
    const existing = exactLock(scope, employeeId, isoDate, weekId);
    if (existing) api.removeLock(session, existing.id);
    else api.addLock(session, { scope, employeeId, isoDate, weekId });
  }

  function install() {
    const tools = document.querySelector(".tools");
    if (!tools) return;
    const openButton = document.createElement("button");
    openButton.id = "openPlayground";
    openButton.className = "toolBtn primaryTool";
    openButton.textContent = "Spielplatz / Optimieren";
    tools.append(openButton);
    const overlay = document.createElement("div");
    overlay.id = "playgroundOverlay";
    overlay.className = "pgOverlay hidden";
    document.body.append(overlay);
    openButton.onclick = () => { ensureSession(); overlay.classList.remove("hidden"); render(); };
    overlay.onclick = event => {
      const target = event.target.closest("button,input");
      if (!target) return;
      if (target.hasAttribute("data-close")) return overlay.classList.add("hidden");
      if (target.hasAttribute("data-discard")) { repository.discard(); session = null; return overlay.classList.add("hidden"); }
      if (target.dataset.unlock) api.removeLock(session, target.dataset.unlock);
      else if (target.dataset.week) api.setSelectedWeeks(session, [...overlay.querySelectorAll("[data-week]:checked")].map(input => input.dataset.week));
      else if (target.dataset.toggleLock) toggleLock(target);
      else if (target.hasAttribute("data-cell")) {
        const editor = window.Planning2Editor;
        if (!editor) return;
        const employeeId = target.dataset.eid;
        const isoDate = target.dataset.iso;
        const editorPlan = api.clone(session.workingPlan);
        editor.open({
          employeeId,
          isoDate,
          name: target.dataset.name,
          existing: editorPlan.schedule?.[isoDate]?.[employeeId] || null,
          plan: editorPlan,
          onCommit(nextPlan) {
            api.commitWorkingPlan(session, employeeId, isoDate, nextPlan);
            repository.save(session);
            render();
          }
        });
        return;
      }
      repository.save(session);
      render();
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
