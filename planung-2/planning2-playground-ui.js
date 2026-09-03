"use strict";

(function installPlanning2PlaygroundUi() {
  const api = window.Planning2PlaygroundState;
  const workflow = window.Planning2PlaygroundWorkflow;
  const LIVE_PLAN_KEY = "wochenplan_plan_v10_planning2_preview";
  const MASTER_KEY = "wochenplan_master_v10_planning2_preview";
  if (!api || !workflow) return;

  const repository = api.createRepository(localStorage);
  const historyRepository = window.Planning2OptimizationHistory.createStorageRepository(localStorage);
  const acceptanceAdapter = window.Planning2PlaygroundAcceptance.createLocalStorageAdapter({ storage: localStorage, planKey: LIVE_PLAN_KEY, historyRepository });
  let session = null;
  let acceptanceOpen = false, acceptanceError = "", openedHistoryId = "", acceptanceRunning = false, acceptanceCommitted = false;

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

  const minutesLabel = value => `${Math.floor(Math.abs(Number(value) || 0) / 60)}:${String(Math.abs(Number(value) || 0) % 60).padStart(2, "0")} Std.`;
  function employeesForMonth() {
    return (readJson(MASTER_KEY, { employees: [] }).employees || []).filter(employee => (!employee.activeFromMonth || session.month >= employee.activeFromMonth) && (!employee.activeToMonth || session.month <= employee.activeToMonth));
  }
  function optimizerContext(plan) {
    const employees = employeesForMonth();
    const dates = getMonthWeeks(session.month).flatMap(week => week.days).filter((day, index, all) => day.startsWith(session.month) && all.indexOf(day) === index).map(day => new Date(`${day}T00:00:00Z`));
    const resolved = employees.map(employee => dates.map(day => getResolvedDayEntry({ employee, isoDate: api.todayIso(day), schedule: plan.schedule || {}, absences: plan.absences || [], stateKey: plan.stateKey || "schleswig-holstein" })));
    const context = buildPlanning2OptimizationContext(employees, dates, resolved, {}, {}, plan, new Date());
    context.yearMonth = session.month;
    context.today = api.todayIso();
    context.evaluateCoverage = entries => evaluateResolvedDayCoverage(entries);
    return context;
  }
  function evaluateVariant(plan, optimizationBasePlan) {
    const context = optimizerContext(plan), mutations = workflow.planMutations(optimizationBasePlan, plan);
    const validation = simulatePlanning2MutationPackage({ ...context, sourcePlan: optimizationBasePlan }, { packageType: "PLAYGROUND_MANUAL", mutations });
    const comparisonMutations = workflow.planMutations(session.basePlan, plan);
    const facts = window.Planning2PlaygroundOptimizer.evaluateVariantFacts(plan, comparisonMutations, context, validation);
    return { variantFacts: facts, explanationFacts: facts, externalHelpHints: facts.externalHelpHints, hardConstraintResult: validation.constraintResults };
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
    return `<button type="button" class="pgLockAction ${className} ${lock ? "isActive" : ""}" data-toggle-lock="${scope}" data-eid="${escapeHtml(employeeId)}" data-iso="${isoDate}" data-week-id="${weekId}" aria-label="${escapeHtml(label)} ${action}" aria-pressed="${lock ? "true" : "false"}" ${disabled ? "disabled" : ""}>🔒 ${escapeHtml(label)}${lock ? " ✓" : ""}</button>`;
  }

  function render() {
    const overlay = document.getElementById("playgroundOverlay");
    const monthWeeks = getMonthWeeks(session.month);
    const selected = new Set(session.selectedWeeks);
    const today = api.todayIso();
    const days = monthWeeks.flatMap(week => week.days).filter((day, index, all) => day.startsWith(session.month) && all.indexOf(day) === index);
    const employees = employeesForMonth();
    const currentVariant = workflow.selectedVariant(session);
    const tabs = (session.variants || []).slice(0, 3).map((variant, index) => `<button type="button" role="tab" data-variant="${escapeHtml(variant.variantId)}" aria-selected="${variant.variantId === session.selectedVariantId}">${index === 0 ? "⭐ Empfohlen" : `Variante ${index + 1}`}</button>`).join("");
    const comparison = (session.variants || []).slice(0, 3).map((variant, index) => { const facts = variant.variantFacts || variant.explanationFacts || {}; const warnings = variant.hardConstraintResult?.violations || []; return `<article class="${index === 0 ? "isRecommended" : ""} ${variant.variantId === session.selectedVariantId ? "isSelected" : ""}"><b>${index === 0 ? "⭐ Empfohlen" : `Variante ${index + 1}`}</b><span><strong>Unterbesetzung</strong>${minutesLabel(facts.understaffingMinutes)}</span><span><strong>Plus / Minus</strong>${facts.employeesInPlus || 0} / ${facts.employeesInMinus || 0} Mitarbeiter</span><span><strong>GFB-Restbudget</strong>${minutesLabel(facts.gfbRemainingMinutes)}</span><span><strong>Änderungen</strong>${facts.changeCount ?? variant.totalChangeCount ?? 0} · ${facts.outsideSelectedWeekChangeCount || 0} außerhalb</span><span><strong>Warnungen</strong>${warnings.length}</span><span><strong>Externe Hilfe</strong>${(variant.externalHelpHints || []).length ? "Hinweis vorhanden" : "nicht nötig"}</span><details><summary>Details pro Mitarbeiter</summary>${(facts.employeeBalances || []).map(item => `<div>${escapeHtml(item.employeeId)}: ${item.projectedBalanceMinutes < 0 ? "−" : "+"}${minutesLabel(item.projectedBalanceMinutes)}</div>`).join("") || "Keine Details"}</details></article>`; }).join("");
    const invalid = currentVariant?.hardConstraintResult?.allowed === false ? `<div class="pgInvalid"><b>⚠ Diese Variante ist aktuell nicht gültig</b>${(currentVariant.hardConstraintResult.violations || []).map(item => `<div>${escapeHtml(item.message || item.rule)}</div>`).join("")}</div>` : "";

    const history = historyRepository.readOptimizationHistory(session.month);
    const openedHistory = history.find(item => item.id === openedHistoryId);
    const historyHtml = `<section class="pgHistory"><h3>Optimierungen</h3>${history.map(item => `<button type="button" data-history="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${new Date(item.acceptedAt).toLocaleDateString("de-DE")}</button>`).join("") || "<p>Noch keine übernommene Optimierung.</p>"}${openedHistory ? `<article class="pgHistoryDetail"><h4>${escapeHtml(openedHistory.label)}</h4><p>Übernommene Variante: ${escapeHtml(openedHistory.variantId)}${openedHistory.recommended ? " · ⭐ Empfohlen" : ""}</p><p>Wochen: ${(openedHistory.selectedWeeks || []).map(escapeHtml).join(", ") || "—"} · Änderungen: ${(openedHistory.changes || []).length}</p><p>Unterbesetzung: ${minutesLabel(openedHistory.remainingUnderstaffingMinutes)} · Minus: ${openedHistory.employeesInMinus || 0} · Plus: ${openedHistory.employeesInPlus || 0}</p><p>GFB-Restbudget: ${minutesLabel(openedHistory.gfb?.remainingMinutes)} · Warnungen: ${(openedHistory.warnings || []).length} · Externe Hilfe: ${(openedHistory.externalHelpHints || []).length}</p><p>Außerhalb gewählter Wochen: ${(openedHistory.outsideSelectedWeekChanges || []).length} · Fixierungen: ${(openedHistory.locks || []).length}</p><details><summary>Änderungen anzeigen</summary>${(openedHistory.changes || []).map(item => `<div><b>${escapeHtml(item.employeeId)}</b> · ${escapeHtml(item.isoDate)} · ${escapeHtml(entryLabel(item.before))} → ${escapeHtml(entryLabel(item.after))}</div>`).join("") || "Keine Änderungen"}</details><details><summary>Mitarbeiter-Salden</summary>${(openedHistory.employeeBalances || []).map(item => `<div>${escapeHtml(item.employeeId)}: Soll ${minutesLabel(item.targetMinutes)} · geplant ${minutesLabel(item.plannedMinutes)} · Gutschriften ${minutesLabel(item.creditedAbsenceMinutes ?? item.creditMinutes)} · Ergebnis ${minutesLabel(item.projectedBalanceMinutes)}</div>`).join("") || "Keine Salden"}</details></article>` : ""}</section>`;
    const acceptanceFacts = currentVariant?.variantFacts || {};
    const acceptanceDialog = acceptanceOpen && currentVariant ? `<div class="pgAcceptance" role="alertdialog" aria-modal="true"><div><h3>Variante ${(session.variants || []).indexOf(currentVariant) + 1} übernehmen?</h3><p>${acceptanceFacts.changeCount ?? currentVariant.totalChangeCount ?? 0} Änderungen · Unterbesetzung ${minutesLabel(acceptanceFacts.understaffingMinutes)}</p><p>${acceptanceFacts.employeesInMinus || 0} Mitarbeiter im Minus · ${acceptanceFacts.employeesInPlus || 0} im Plus · GFB-Restbudget ${minutesLabel(acceptanceFacts.gfbRemainingMinutes)}</p><p>${acceptanceFacts.outsideSelectedWeekChangeCount || 0} Änderungen außerhalb ausgewählter Wochen · ${(acceptanceFacts.warnings || []).length} Warnungen · ${(currentVariant.externalHelpHints || []).length} externe Hilfe Hinweise</p>${currentVariant.hardConstraintResult?.allowed === false ? '<p class="pgInvalid">Diese Variante kann nicht übernommen werden, solange Hard-Constraint-Verletzungen bestehen.</p>' : ""}${acceptanceError ? `<p class="pgInvalid">${escapeHtml(acceptanceError)}</p>` : ""}<button type="button" data-cancel-accept>Abbrechen</button><button type="button" data-confirm-accept ${currentVariant.hardConstraintResult?.allowed === false || acceptanceRunning || acceptanceCommitted ? "disabled" : ""}>${acceptanceRunning ? "Wird übernommen …" : acceptanceCommitted ? "Bereits übernommen" : "Variante übernehmen"}</button></div></div>` : "";

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
        return `<div class="pgCell ${constraint.locked ? "isLocked" : ""} ${day <= today ? "isPast" : ""}"><button type="button" class="pgEditCell" data-cell data-eid="${escapeHtml(employee.id)}" data-name="${escapeHtml(employee.name || employee.id)}" data-iso="${day}" ${day <= today ? "disabled" : ""} aria-label="${day} für ${escapeHtml(employee.name || employee.id)} bearbeiten"><small class="pgCellDate">${day.slice(8)}</small><b class="pgCellValue">${escapeHtml(entryLabel(displayEntry))}</b><span class="pgCellState">${constraint.locked ? "🔒" : "✎"}</span></button>${lockButton({ scope: "shift", label: "Schicht", employeeId: employee.id, isoDate: day, disabled: day <= today || storedEntry?.type !== "shift", className: "pgCellLock" })}</div>`;
      }).join("");
      return `<div class="pgRow"><div class="pgPerson"><b class="pgPersonName">${escapeHtml(employee.name || employee.id)}</b>${lockButton({ scope: "employee-period", label: "Zeitraum", employeeId: employee.id })}<div class="pgEmployeeWeeks" aria-label="${escapeHtml(employee.name || employee.id)} pro Woche fixieren">${employeeWeekLocks}</div></div>${cells}</div>`;
    }).join("");

    overlay.innerHTML = `<section class="pgPanel" role="dialog" aria-modal="true" aria-labelledby="pgTitle"><header><div><small>STAGE E5 · SPIELPLATZ</small><h2 id="pgTitle">${new Date(`${session.month}-01T00:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</h2></div><button type="button" data-close>Schließen</button></header><div class="pgOverview"><span><b>Optimieren</b>${session.month}</span><span><b>Ausgewählte Wochen</b>${session.selectedWeeks.length}</span><span><b>Vergangenheit/heute</b>🔒 gesperrt</span><span><b>Fixierungen</b>${session.locks.length}</span><span><b>Ausgangspunkt</b>${session.source.startsWith("variant:") ? "bearbeitete Variante" : "aktueller Plan"}</span></div><div class="pgWeeks">${weekControls}</div>${session.optimization.status === "running" ? '<p class="pgLoading" role="status">Varianten werden berechnet … Bestehender Spielplatz bleibt erhalten.</p>' : session.optimization.status === "error" ? `<p class="pgInvalid">Optimierung fehlgeschlagen: ${escapeHtml(session.optimization.error)}</p>` : ""}<div class="pgVariantTabs" role="tablist">${tabs}</div>${session.variants.length ? `<details class="pgCompare"><summary>Varianten vergleichen</summary><div>${comparison}</div></details>` : ""}${invalid}<details class="pgHint"><summary>ⓘ Ausgewählte Wochen sind bevorzugt. Andere Wochen können bei Bedarf mit geändert werden.</summary><p>Zelle antippen = bearbeiten. Der separate 🔒-Knopf fixiert eine bestehende Schicht ohne Änderung.</p></details><div class="pgGrid"><div class="pgRow pgHead"><div>Mitarbeiter</div>${days.map(day => lockButton({ scope: "day", label: `${day.slice(8)}. Tag`, isoDate: day, disabled: day <= today }))}</div>${rows}</div><div class="pgLocks"><b>Fixierungen:</b>${session.locks.map(lock => `<button type="button" data-unlock="${lock.id}" aria-label="Fixierung lösen">🔒 fixiert · ${escapeHtml(lock.scope)} ${escapeHtml(lock.employeeId || lock.isoDate || lock.weekId)}${lock.outsideSelectedWeek ? " · außerhalb ausgewählter Woche" : ""} · Fixierung lösen</button>`).join("") || " keine"}</div><footer><button type="button" class="danger" data-discard>Spielplatz verwerfen</button><button type="button" data-optimize ${session.optimization.status === "running" ? "disabled" : ""}>Optimierung starten</button>${currentVariant ? `<button type="button" data-optimize-from-here ${currentVariant.hardConstraintResult?.allowed === false || session.optimization.status === "running" ? "disabled" : ""}>Von hier weiter optimieren</button><button type="button" data-open-accept ${currentVariant.hardConstraintResult?.allowed === false ? "disabled" : ""}>Diese Variante übernehmen</button>` : ""}</footer>${historyHtml}</section>${acceptanceDialog}`;
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
      if (target.dataset.history) { openedHistoryId = target.dataset.history; return render(); }
      if (target.hasAttribute("data-open-accept")) { acceptanceOpen = true; acceptanceError = ""; acceptanceCommitted = false; return render(); }
      if (target.hasAttribute("data-cancel-accept")) { acceptanceOpen = false; acceptanceError = ""; return render(); }
      if (target.hasAttribute("data-confirm-accept")) {
        if (acceptanceRunning || acceptanceCommitted) return;
        acceptanceRunning = true; acceptanceError = ""; render();
        window.Planning2PlaygroundAcceptance.accept({ session, adapter: acceptanceAdapter, revalidate: evaluateVariant, discardPlayground() { repository.discard(); } }).then(result => {
          acceptanceRunning = false;
          if (!result.ok) { acceptanceError = result.message; return render(); }
          acceptanceCommitted = true;
          const cleanupWarning = result.warnings?.find(item => item.code === "PLAYGROUND_CLEANUP_FAILED");
          if (cleanupWarning) { acceptanceError = `Variante wurde übernommen. Der alte Spielplatz konnte nicht entfernt werden: ${cleanupWarning.message}`; return render(); }
          session = null; acceptanceOpen = false; overlay.classList.add("hidden");
        });
        return;
      }
      if (target.hasAttribute("data-discard")) { repository.discard(); session = null; return overlay.classList.add("hidden"); }
      if (target.dataset.variant) { workflow.selectVariant(session, target.dataset.variant); repository.save(session); return render(); }
      if (target.hasAttribute("data-optimize") || target.hasAttribute("data-optimize-from-here")) {
        const fromHere = target.hasAttribute("data-optimize-from-here");
        workflow.optimize(session, (input, context, config) => window.Planning2PlaygroundOptimizer.run(input, context, config), optimizerContext(session.workingPlan), { fromHere, onState() { repository.save(session); render(); } });
        return;
      }
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
            const result = api.commitWorkingPlan(session, employeeId, isoDate, nextPlan);
            if (result.changed) workflow.reevaluateSelected(session, evaluateVariant);
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
