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
