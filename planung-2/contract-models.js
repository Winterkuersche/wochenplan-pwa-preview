const CONTRACT_MODELS = Object.freeze({
  VZ30: Object.freeze({ hoursPerWeek: 30, targetMinutesPerMonth: 7830 }),
  TZ30: Object.freeze({ hoursPerWeek: 30, targetMinutesPerMonth: 7830 }),
  TZ20: Object.freeze({ hoursPerWeek: 20, targetMinutesPerMonth: 5220 }),
  TZ15: Object.freeze({ hoursPerWeek: 15, targetMinutesPerMonth: 3915 })
});

function getContractModelByKey(contractModelKey) {
  if (!contractModelKey) return null;

  const normalizedKey = String(contractModelKey).trim().toUpperCase();
  return CONTRACT_MODELS[normalizedKey] || null;
}

function getContractModelTargetMinutesPerMonth(contractModelKey) {
  const model = getContractModelByKey(contractModelKey);
  return model?.targetMinutesPerMonth ?? null;
}
