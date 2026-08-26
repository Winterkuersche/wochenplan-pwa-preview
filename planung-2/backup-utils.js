function getNormalizedStoragePayload(storageLike = {}) {
  if (!storageLike || typeof storageLike !== "object") return null;

  const normalizedStorage = {
    [MASTER_KEY]: storageLike[MASTER_KEY] ?? storageLike.master ?? null,
    [PLAN_KEY]: storageLike[PLAN_KEY] ?? storageLike.plan ?? null,
    [UI_KEY]: storageLike[UI_KEY] ?? storageLike.ui ?? storageLike.uiState ?? null,
    wochenplan_dark: storageLike.wochenplan_dark
  };

  if (!normalizedStorage[MASTER_KEY] && !normalizedStorage[PLAN_KEY] && !normalizedStorage[UI_KEY]) {
    return null;
  }

  return normalizedStorage;
}

function normalizeBackupPayload(backup) {
  if (!backup || typeof backup !== "object") return null;

  const hasStorageEnvelope = backup.storage && typeof backup.storage === "object";
  const normalizedStorage = hasStorageEnvelope
    ? getNormalizedStoragePayload(backup.storage)
    : getNormalizedStoragePayload(backup);

  if (!normalizedStorage) return null;

  return {
    backupVersion: backup.backupVersion || 0,
    createdAt: backup.createdAt || "",
    storage: normalizedStorage
  };
}

function validateBackupData(backup, options = {}) {
  const normalizedBackup = options.skipNormalization ? backup : normalizeBackupPayload(backup);
  if (!normalizedBackup) {
    return "Die Sicherungsdatei ist ungültig.";
  }

  if (!normalizedBackup.storage || typeof normalizedBackup.storage !== "object") {
    return "Die Sicherungsdatei enthält keine wiederherstellbaren Daten.";
  }

  const requiredKeys = [MASTER_KEY, PLAN_KEY, UI_KEY];
  const missing = requiredKeys.filter((key) => !(key in normalizedBackup.storage));

  if (missing.length > 0) {
    return `Die Sicherungsdatei ist unvollständig (fehlend: ${missing.join(", ")}).`;
  }

  const master = normalizedBackup.storage[MASTER_KEY];
  if (!master || typeof master !== "object" || !Array.isArray(master.employees)) {
    return "Die Stammdaten in der Sicherungsdatei sind ungültig.";
  }

  const plan = normalizedBackup.storage[PLAN_KEY];
  if (!plan || typeof plan !== "object") {
    return "Die Planungsdaten in der Sicherungsdatei sind ungültig.";
  }

  const ui = normalizedBackup.storage[UI_KEY];
  if (!ui || typeof ui !== "object") {
    return "Die Einstellungen in der Sicherungsdatei sind ungültig.";
  }

  return "";
}

function validateAndNormalizeBackupData(backup) {
  const normalizedBackup = normalizeBackupPayload(backup);
  const validationError = validateBackupData(normalizedBackup, { skipNormalization: true });

  return {
    backup: validationError ? null : normalizedBackup,
    error: validationError
  };
}
