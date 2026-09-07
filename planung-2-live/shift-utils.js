const MIN_WORK_MINUTES = 180;

function getLateShiftCodeFromStart(startHHMM) {
  const startMinutes = hhmmToMinutes(startHHMM);
  const endMinutes = hhmmToMinutes("19:00");
  const workedMinutes = endMinutes - startMinutes;
  const workedHours = Math.round(workedMinutes / 60);

  return `L${workedHours}`;
}

function resolveShiftTimeFromPolicy(policy = {}, userInput = {}, fallbackValue = "") {
  if (policy.type === "fixed") return policy.value || fallbackValue;
  if (policy.type === "select" || policy.type === "user-input") {
    return normalizePlanTime(userInput.value || userInput.time || fallbackValue || "");
  }

  return normalizePlanTime(fallbackValue || "");
}

function buildShiftEntryFromRule(rule, userInput = {}, context = {}) {
  if (!rule || rule.entryType !== "shift") return null;

  const withCheckout = Boolean(userInput.withCheckout);
  let startHHMM = "";
  let endHHMM = "";

  if (rule.code === "L") {
    const requestedStart = normalizePlanTime(userInput.start || "");
    if (!rule.startPolicy?.options?.includes(requestedStart)) return null;

    startHHMM = requestedStart;
    endHHMM = withCheckout ? rule.endPolicy.withCheckout : rule.endPolicy.withoutCheckout;
  } else if (rule.code === "G") {
    startHHMM = rule.startPolicy.value;
    endHHMM = withCheckout ? rule.endPolicy.withCheckout : rule.endPolicy.withoutCheckout;
  } else if (rule.code === "FLEX") {
    startHHMM = resolveShiftTimeFromPolicy(rule.startPolicy, { value: userInput.start });
    endHHMM = resolveShiftTimeFromPolicy(rule.endPolicy, { value: userInput.end });
  } else {
    startHHMM = resolveShiftTimeFromPolicy(rule.startPolicy);
    endHHMM = resolveShiftTimeFromPolicy(rule.endPolicy, { value: userInput.end }, rule.endPolicy?.value || "");
  }

  if (!startHHMM || !endHHMM) return null;
  if (!isAllowedPlanTime(startHHMM) || !isAllowedPlanTime(endHHMM)) return null;

  const spanMinutes = diffMinutesBetweenHHMM(startHHMM, endHHMM);
  if (spanMinutes <= 0) return null;

  // breakPolicy liefert nur den konfigurierten Rohwert (Legacy/Fallback).
  // Die finale, additive Fachpause wird ausschließlich in
  // getBusinessRequiredBreakMinutes berechnet (Single Source of Truth).
  let configuredBreakMinutes = Number(rule.breakPolicy?.baseMinutes || 0);
  if (rule.breakPolicy?.type === "checkout-dependent") {
    configuredBreakMinutes = withCheckout
      ? Number(rule.breakPolicy.withCheckout || 0)
      : Number(rule.breakPolicy.withoutCheckout || 0);
  }

  const includeBillingBonus = endHHMM === "19:10";
  const breakMinutes = rule.breakPolicy?.type === "required-for-span"
    ? getBreakMinutesForFlexibleShift(startHHMM, endHHMM)
    : getEffectiveBreakMinutes(startHHMM, endHHMM, configuredBreakMinutes, { includeBillingBonus });

  if (breakMinutes >= spanMinutes) return null;

  const workedMinutes = getWorkedMinutesFromRange(startHHMM, endHHMM, breakMinutes);
  if (rule.code === "FLEX" && workedMinutes < MIN_WORK_MINUTES) return null;

  const code = rule.code === "L" ? getLateShiftCodeFromStart(startHHMM) : rule.code;
  const shiftLabel = rule.code === "FLEX" ? `${startHHMM}-${endHHMM}` : rule.label;

  return {
    type: "shift",
    status: "shift",
    mode: rule.mode,
    shiftType: rule.shiftType,
    code,
    shiftKey: rule.code,
    label: shiftLabel,
    start: startHHMM,
    end: endHHMM,
    pause: breakMinutes,
    breakMinutes,
    note: "",
    withCheckout,
    minutes: workedMinutes,
    meta: {
      source: context.source || "rule-builder",
      ruleCode: rule.code
    }
  };
}

function buildEarlyShiftEntry(code) {
  const rule = getShiftRuleByCode(code);
  return buildShiftEntryFromRule(rule, {});
}

function buildLateShiftEntry(startHHMM, withCheckout) {
  const rule = getShiftRuleByCode("L");
  return buildShiftEntryFromRule(rule, { start: startHHMM, withCheckout });
}

function buildFullShiftEntry(withCheckout) {
  const rule = getShiftRuleByCode("G");
  return buildShiftEntryFromRule(rule, { withCheckout });
}

function buildFlexibleShiftEntry(startHHMM, endHHMM) {
  const rule = getShiftRuleByCode("FLEX");
  return buildShiftEntryFromRule(rule, { start: startHHMM, end: endHHMM });
}

function buildIndividualShiftEntry(startHHMM, workedMinutes, breakMinutes = 0) {
  const start = normalizePlanTime(startHHMM);
  const normalizedWorkedMinutes = normalizeMinutesToQuarterHour(workedMinutes);
  const normalizedBreakMinutes = normalizePlanBreakMinutes(breakMinutes);
  if (!start || normalizedWorkedMinutes < MIN_WORK_MINUTES) return null;

  const end = addMinutesToHHMM(start, normalizedWorkedMinutes + normalizedBreakMinutes);
  if (!isAllowedPlanTime(end) || diffMinutesBetweenHHMM(start, end) <= 0) return null;

  const requiredBreakMinutes = getBusinessRequiredBreakMinutes(start, end, 0, {
    includeBillingBonus: end === "19:10"
  });
  if (normalizedBreakMinutes < requiredBreakMinutes) return null;

  const entry = buildShiftEntryFromRule(getShiftRuleByCode("FLEX"), { start, end }, {
    source: "individual-shift"
  });
  if (!entry) return null;

  return {
    ...entry,
    pause: normalizedBreakMinutes,
    breakMinutes: normalizedBreakMinutes,
    minutes: normalizedWorkedMinutes
  };
}

function buildIndividualCheckoutShiftEntry(startHHMM) {
  const start = normalizePlanTime(startHHMM);
  const end = "19:10";
  if (!start || !isQuarterHourTime(start) || diffMinutesBetweenHHMM(start, end) <= 0) return null;

  const breakMinutes = getBusinessRequiredBreakMinutes(start, end, 0, {
    includeBillingBonus: true
  });
  const workedMinutes = getWorkedMinutesFromRange(start, end, breakMinutes);
  if (workedMinutes < MIN_WORK_MINUTES || workedMinutes % QUARTER_HOUR_STEP_MINUTES !== 0) return null;

  const entry = buildShiftEntryFromRule(getShiftRuleByCode("FLEX"), { start, end }, {
    source: "individual-checkout-shift"
  });
  if (!entry) return null;

  return {
    ...entry,
    pause: breakMinutes,
    breakMinutes,
    minutes: workedMinutes
  };
}

function buildFoShiftEntry(endHHMM) {
  const rule = getShiftRuleByCode("FO");
  return buildShiftEntryFromRule(rule, { end: endHHMM, withCheckout: endHHMM === "19:10" });
}

function isShiftEntry(value) {
  return !!value && value.type === "shift";
}

function getShiftDisplayLabel(entry) {
  if (!isShiftEntry(entry)) return "";

  if (entry.mode === "flex") {
    return entry.label || `${entry.start}-${entry.end}`;
  }

  return entry.label || entry.code || "";
}

function getShiftWorkedHHMM(entry) {
  if (!isShiftEntry(entry)) return "00:00";
  return minutesToHHMM(entry.minutes || 0);
}
