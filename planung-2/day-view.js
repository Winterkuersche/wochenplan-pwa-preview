function getVacationEntryById(entryId) {
  return getVacationEntryByIdFromAbsences(state.absences || [], entryId);
}

function openVacationDialog(emp) {
  const defaultIso = state.weekFrom || toIsoDate(new Date());

  openShiftDialog("U", {
    emp,
    isoDate: defaultIso,
    type: "U"
  });
}

function openVacationEntryDialog(emp, entry) {
  if (!emp || !entry) return;

  openShiftDialog("U", {
    emp,
    isoDate: entry.from,
    type: "U"
  });

  if (typeof shiftDialogAbsenceFrom !== "undefined" && shiftDialogAbsenceFrom) {
    shiftDialogAbsenceFrom.value = entry.from;
  }

  if (typeof shiftDialogAbsenceTo !== "undefined" && shiftDialogAbsenceTo) {
    shiftDialogAbsenceTo.value = entry.to;
  }
}

function renderVacationRangesForEmployee(emp) {
  const entries = getVacationEntriesForEmployeeFromAbsences(state.absences || [], emp.id)
    .slice()
    .sort((a, b) => a.from.localeCompare(b.from));

  if (!entries.length) {
    return `<span class="small">—</span>`;
  }

  return entries
    .map((entry) => {
      const text = formatVacationRange(entry);

      return `
        <div class="vacationRangeItem">
          <span class="vacationRangeText">${text}</span>
          <button
            type="button"
            class="vacationRangeEditBtn"
            data-emp-id="${emp.id}"
            data-entry-id="${entry.id}"
            title="Urlaub bearbeiten"
          >✎</button>
          <button
            type="button"
            class="vacationRangeDeleteBtn"
            data-entry-id="${entry.id}"
            title="Urlaub löschen"
          >🗑</button>
        </div>
      `;
    })
    .join("");
}

function bindVacationRangeActions() {
  document.querySelectorAll(".vacationRangeEditBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const empId = btn.dataset.empId;
      const entryId = btn.dataset.entryId;

      const emp = state.employees.find((e) => e.id === empId);
      const entry = getVacationEntryById(entryId);

      if (!emp || !entry) return;

      openVacationEntryDialog(emp, entry);
    });
  });

  document.querySelectorAll(".vacationRangeDeleteBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entryId = btn.dataset.entryId;
      const entry = getVacationEntryById(entryId);

      if (!entry) return;

      if (!confirm("Diesen Urlaubszeitraum löschen?")) return;

      removeAbsence(entryId);
    });
  });
}

function renderDayView() {
  const body = document.getElementById("vacationTableBody");
  if (!body) return;

  body.innerHTML = "";

  const year = getVacationViewYear();

  state.employees.forEach((emp) => {
    const usedVacationDays = getUsedVacationDaysFromScheduleForEmployee(emp.id, year);
    const summary = getVacationSummaryForEmployee(emp, year, {
      usedVacationDays,
      absences: state.absences || []
    });
    const months = getVacationMonthsForEmployeeFromAbsences(state.absences || [], emp.id, year);
    const rangesHtml = renderVacationRangesForEmployee(emp);

    const tr = document.createElement("tr");


   

let monthsHtml = "";

months.forEach((hasVacation, i) => {
  monthsHtml += `
    <td class="vacMonthCell">
      ${hasVacation ? "U" : "-"}
    </td>
  `;
});
    
   tr.innerHTML = `
<td>${emp.name || "—"}</td>
<td>${summary.total}</td>
<td>${summary.used}</td>
<td>${summary.remaining}</td>
<td class="vacationRangesCell">${rangesHtml}</td>
`;

const actionCell = document.createElement("td");

const addBtn = document.createElement("button");
addBtn.type = "button";
addBtn.textContent = "+ Urlaub";
addBtn.addEventListener("click", () => {
  openVacationDialog(emp);
});

actionCell.appendChild(addBtn);
tr.appendChild(actionCell);

tr.insertAdjacentHTML("beforeend", monthsHtml);

body.appendChild(tr);
  });

  bindVacationRangeActions();
}

function getVacationViewYear() {
  const activeMonth = typeof state.activeMonth === "string" ? state.activeMonth.trim() : "";
  const weekFrom = typeof state.weekFrom === "string" ? state.weekFrom.trim() : "";

  const activeMonthMatch = activeMonth.match(/^(\d{4})-\d{2}$/);
  if (activeMonthMatch) return Number(activeMonthMatch[1]);

  const weekFromMatch = weekFrom.match(/^(\d{4})-\d{2}-\d{2}$/);
  if (weekFromMatch) return Number(weekFromMatch[1]);

  return new Date().getFullYear();
}
