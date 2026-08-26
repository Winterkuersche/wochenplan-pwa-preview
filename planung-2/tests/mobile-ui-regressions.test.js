const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('mobile menu markup keeps primary overflow actions in Mehr menu', () => {
  const html = readRepoFile('index.html');

  assert.match(html, /id="btnMoreActions"/);
  assert.match(html, /id="mobileMoreMenuPanel" class="mobileMoreMenu hidden"/);
  assert.match(html, /data-forward-target="btnToggleTeam"/);
  assert.match(html, /data-forward-target="btnResetWeek"/);
  assert.match(html, /data-forward-target="btnExportBackup"/);
  assert.match(html, /data-forward-target="btnImportBackup"/);
  assert.match(html, /data-forward-target="btnDarkMode"/);
  assert.match(html, /data-forward-target="btnPrint"/);
});

test('manual month mobile row labels remain present for responsive card layout', () => {
  const appScript = readRepoFile('app.js');

  assert.match(appScript, /monthTd\.dataset\.label = "Monat \(YYYY-MM\)"/);
  assert.match(appScript, /hoursTd\.dataset\.label = "Iststunden \(HH:MM\)"/);
  assert.match(appScript, /removeTd\.dataset\.label = "Aktion"/);
});
