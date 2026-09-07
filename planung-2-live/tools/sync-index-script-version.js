#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const versionFile = path.join(repoRoot, 'version.js');
const indexFile = path.join(repoRoot, 'index.html');

function readAppMeta() {
  const versionSource = fs.readFileSync(versionFile, 'utf8');
  const appMeta = vm.runInNewContext(`${versionSource}\nAPP_META;`, {});

  if (!appMeta || typeof appMeta !== 'object') {
    throw new Error('APP_META konnte aus version.js nicht gelesen werden.');
  }

  if (!appMeta.assetVersion || typeof appMeta.assetVersion !== 'string') {
    throw new Error('APP_META.assetVersion fehlt oder ist kein String.');
  }

  return appMeta;
}

function syncIndexScriptVersions(assetVersion) {
  const html = fs.readFileSync(indexFile, 'utf8');
  const updatedHtml = html.replace(
    /(<script\s+src=")\.\/([a-z0-9-]+\.js)(\?v=[^"]*)?("\s*><\/script>)/gi,
    `$1./$2?v=${assetVersion}$4`
  );

  if (updatedHtml !== html) {
    fs.writeFileSync(indexFile, updatedHtml);
  }
}

const appMeta = readAppMeta();
syncIndexScriptVersions(appMeta.assetVersion);
console.log(`index.html Script-Version auf ?v=${appMeta.assetVersion} synchronisiert.`);
