const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

const ctx = loadScripts(['backup-utils.js'], {
  MASTER_KEY: 'wochenplan_master_v1',
  PLAN_KEY: 'wochenplan_plan_v1',
  UI_KEY: 'wochenplan_ui_v1'
});

test('validateBackupData accepts current storage envelope format', () => {
  const payload = {
    storage: {
      wochenplan_master_v1: { employees: [] },
      wochenplan_plan_v1: {},
      wochenplan_ui_v1: {}
    }
  };

  assert.equal(ctx.validateBackupData(payload), '');
});

test('validateBackupData accepts legacy top-level format', () => {
  const payload = {
    master: { employees: [] },
    plan: {},
    uiState: {}
  };

  assert.equal(ctx.validateBackupData(payload), '');
});

test('validateBackupData rejects invalid employee payload', () => {
  const payload = {
    storage: {
      wochenplan_master_v1: { employees: null },
      wochenplan_plan_v1: {},
      wochenplan_ui_v1: {}
    }
  };

  assert.match(ctx.validateBackupData(payload), /Stammdaten/);
});

test('validateAndNormalizeBackupData returns normalized backup for legacy payload', () => {
  const payload = {
    master: { employees: [] },
    plan: {},
    ui: {}
  };

  const result = ctx.validateAndNormalizeBackupData(payload);
  assert.equal(result.error, '');
  assert.equal(typeof result.backup, 'object');
  assert.equal(typeof result.backup.storage, 'object');
});

test('validateAndNormalizeBackupData normalizes storage envelope aliases', () => {
  const payload = {
    storage: {
      master: { employees: [] },
      plan: {},
      uiState: {}
    }
  };

  const result = ctx.validateAndNormalizeBackupData(payload);
  assert.equal(result.error, '');
  assert.deepEqual(
    JSON.parse(JSON.stringify(Object.keys(result.backup.storage).sort())),
    ['wochenplan_dark', 'wochenplan_master_v1', 'wochenplan_plan_v1', 'wochenplan_ui_v1']
  );
});

test('validateBackupData returns clear error for missing ui payload', () => {
  const payload = {
    storage: {
      wochenplan_master_v1: { employees: [] },
      wochenplan_plan_v1: {}
    }
  };

  assert.match(ctx.validateBackupData(payload), /(Einstellungen|ungültig)/);
});

test('validateAndNormalizeBackupData does not crash on non-object input', () => {
  assert.doesNotThrow(() => ctx.validateAndNormalizeBackupData(null));
  const result = ctx.validateAndNormalizeBackupData(null);
  assert.equal(result.backup, null);
  assert.match(result.error, /ungültig/);
});

test('backup normalization and restore envelope preserve multiple monthly baselines', () => {
  const baselines = {
    '2026-09': { month: '2026-09', createdAt: 'one', entries: { '2026-09-30': { a: { kind: 'off' } } } },
    '2026-10': { month: '2026-10', createdAt: 'two', entries: { '2026-10-01': { a: { kind: 'shift', start: '09:00', end: '14:00' } } } }
  };
  const exported = { storage: {
    wochenplan_master_v1: { employees: [] },
    wochenplan_plan_v1: { schedule: {}, monthlyPlanBaselines: baselines },
    wochenplan_ui_v1: {}
  } };
  const restored = ctx.validateAndNormalizeBackupData(JSON.parse(JSON.stringify(exported)));
  assert.equal(restored.error, '');
  const restoredStorage = new Map();
  Object.entries(restored.backup.storage).forEach(([key, value]) => restoredStorage.set(key, value === undefined ? undefined : JSON.parse(JSON.stringify(value))));
  const restoredPlan = restoredStorage.get('wochenplan_plan_v1');
  assert.deepEqual(JSON.parse(JSON.stringify(restoredPlan.monthlyPlanBaselines)), baselines);
  assert.deepEqual(Object.keys(restoredPlan.monthlyPlanBaselines), ['2026-09', '2026-10']);
});
