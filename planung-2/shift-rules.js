const SHIFT_RULES = Object.freeze([
  {
    code: "FO",
    label: "FÖ",
    entryType: "shift",
    mode: "early",
    shiftType: "early",
    startPolicy: { type: "fixed", value: "08:55" },
    endPolicy: {
      type: "select",
      options: (() => {
        const options = [];
        let minutes = hhmmToMinutes("12:00");
        const maxMinutes = hhmmToMinutes("19:00");
        while (minutes <= maxMinutes) {
          options.push(minutesToHHMM(minutes));
          minutes += 15;
        }
        options.push("19:10");
        return options;
      })()
    },
    // Legacy-Konfiguration: baseMinutes bleibt für Rückwärtskompatibilität erhalten,
    // die finale Fachpause wird aber ausschließlich zentral über
    // getBusinessRequiredBreakMinutes(start, end, configuredBreakMinutes) bestimmt.
    breakPolicy: { type: "configured-minimum", baseMinutes: 5 },
    uiPolicy: { isDialogShift: true, group: "Schichten" }
  },
  {
    code: "F3",
    label: "F3",
    entryType: "shift",
    mode: "early",
    shiftType: "early",
    startPolicy: { type: "fixed", value: "09:00" },
    endPolicy: { type: "fixed", value: "12:00" },
    breakPolicy: { type: "configured", baseMinutes: 0 },
    uiPolicy: { isDialogShift: false, group: "Schichten" }
  },
  {
    code: "F4",
    label: "F4",
    entryType: "shift",
    mode: "early",
    shiftType: "early",
    startPolicy: { type: "fixed", value: "09:00" },
    endPolicy: { type: "fixed", value: "13:00" },
    breakPolicy: { type: "configured", baseMinutes: 0 },
    uiPolicy: { isDialogShift: false, group: "Schichten" }
  },
  {
    code: "F5",
    label: "F5",
    entryType: "shift",
    mode: "early",
    shiftType: "early",
    startPolicy: { type: "fixed", value: "09:00" },
    endPolicy: { type: "fixed", value: "14:00" },
    breakPolicy: { type: "configured", baseMinutes: 0 },
    uiPolicy: { isDialogShift: false, group: "Schichten" }
  },
  {
    code: "F6",
    label: "F6",
    entryType: "shift",
    mode: "early",
    shiftType: "early",
    startPolicy: { type: "fixed", value: "09:00" },
    endPolicy: { type: "fixed", value: "15:00" },
    breakPolicy: { type: "configured", baseMinutes: 0 },
    uiPolicy: { isDialogShift: false, group: "Schichten" }
  },
  {
    code: "L",
    label: "L",
    entryType: "shift",
    mode: "late",
    shiftType: "late",
    startPolicy: { type: "select", options: ["13:00", "14:00", "15:00", "16:00"] },
    endPolicy: {
      type: "checkout-dependent",
      withCheckout: "19:10",
      withoutCheckout: "19:00"
    },
    // Legacy-Konfiguration: Checkout-Werte dienen nur noch als konfigurierter Input;
    // additive Zuschläge (z. B. 19:10) kommen nur aus getBusinessRequiredBreakMinutes.
    breakPolicy: { type: "checkout-dependent", withCheckout: 10, withoutCheckout: 0 },
    uiPolicy: { isDialogShift: true, group: "Schichten" }
  },
  {
    code: "G",
    label: "G",
    entryType: "shift",
    mode: "full",
    shiftType: "full",
    startPolicy: { type: "fixed", value: "09:00" },
    endPolicy: {
      type: "checkout-dependent",
      withCheckout: "19:10",
      withoutCheckout: "19:00"
    },
    // Legacy-Konfiguration: Der historische 60er-Wert bleibt als Input erhalten,
    // keine harte 70-Logik hier – final entscheidet die Kernfunktion.
    breakPolicy: { type: "checkout-dependent", withCheckout: 60, withoutCheckout: 60 },
    uiPolicy: { isDialogShift: true, group: "Schichten" }
  },
  {
    code: "FLEX",
    label: "Flex",
    entryType: "shift",
    mode: "flex",
    shiftType: "flex",
    startPolicy: { type: "user-input" },
    endPolicy: { type: "user-input" },
    breakPolicy: { type: "required-for-span" },
    uiPolicy: { isDialogShift: true, group: "Schichten" }
  },
  {
    code: "U",
    label: "U",
    entryType: "absence",
    startPolicy: { type: "n/a" },
    endPolicy: { type: "n/a" },
    breakPolicy: { type: "n/a" },
    uiPolicy: { isDialogShift: true, group: "Abwesenheit / Sonstiges" }
  },
  {
    code: "K",
    label: "K",
    entryType: "absence",
    startPolicy: { type: "n/a" },
    endPolicy: { type: "n/a" },
    breakPolicy: { type: "n/a" },
    uiPolicy: { isDialogShift: true, group: "Abwesenheit / Sonstiges" }
  },
  {
    code: "AH",
    label: "AH",
    entryType: "external-help",
    startPolicy: { type: "user-input" },
    endPolicy: { type: "user-input" },
    breakPolicy: { type: "required-for-span" },
    uiPolicy: { isDialogShift: true, group: "Abwesenheit / Sonstiges" }
  }
]);

const SHIFT_RULE_BY_CODE = Object.freeze(
  SHIFT_RULES.reduce((acc, rule) => {
    acc[rule.code] = rule;
    return acc;
  }, {})
);

function normalizeShiftCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const upper = raw.toUpperCase();
  if (upper === "FÖ") return "FO";
  return upper;
}

function getShiftRuleByCode(code) {
  const normalizedCode = normalizeShiftCode(code);
  if (!normalizedCode) return null;
  return SHIFT_RULE_BY_CODE[normalizedCode] || null;
}

// Legacy alias (backward compatibility)
function getShiftRule(code) {
  return getShiftRuleByCode(code);
}

function isDialogShift(code) {
  return Boolean(getShiftRuleByCode(code)?.uiPolicy?.isDialogShift);
}

function getShiftSelectOptions() {
  return [
    { value: "-", label: "-", group: "Schichten", entryType: "off", isDialogShift: false },
    { value: "FR", label: "FR", group: "Abwesenheit / Sonstiges", entryType: "off", isDialogShift: false },
    ...SHIFT_RULES.map((rule) => ({
      value: rule.code === "FO" ? "FÖ" : rule.code,
      label: rule.label,
      group: rule.uiPolicy?.group || "Schichten",
      entryType: rule.entryType,
      isDialogShift: Boolean(rule.uiPolicy?.isDialogShift)
    }))
  ];
}

// Legacy alias (backward compatibility)
function listShiftOptions() {
  return getShiftSelectOptions();
}

function getShiftCodeForSelectValue(value) {
  return normalizeShiftCode(value);
}
