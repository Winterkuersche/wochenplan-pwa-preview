#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const jsFiles = fs
  .readdirSync(repoRoot)
  .filter((file) => file.endsWith('.js'))
  .sort();

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = line[i - 1];
    if (!inDouble && !inTemplate && ch === "'" && prev !== '\\') inSingle = !inSingle;
    else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;

    if (!inSingle && !inDouble && !inTemplate && ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

function collectTopLevelHelpers(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const helpers = [];
  let depth = 0;
  let inBlockComment = false;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNumber = idx + 1;
    let line = lines[idx];

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        inBlockComment = false;
        line = line.slice(end + 2);
      } else {
        continue;
      }
    }

    while (true) {
      const start = line.indexOf('/*');
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end < 0) {
        line = line.slice(0, start);
        inBlockComment = true;
        break;
      }
      line = `${line.slice(0, start)} ${line.slice(end + 2)}`;
    }

    line = stripInlineComment(line);
    const trimmed = line.trim();

    if (depth === 0 && trimmed) {
      const fnMatch = trimmed.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (fnMatch) {
        helpers.push({ name: fnMatch[1], line: lineNumber, kind: 'function' });
      } else {
        const assignMatch = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/);
        if (assignMatch) {
          helpers.push({ name: assignMatch[1], line: lineNumber, kind: 'assigned-function' });
        }
      }
    }

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }

  return helpers;
}

const allHelpers = [];
for (const file of jsFiles) {
  const helpers = collectTopLevelHelpers(path.join(repoRoot, file));
  for (const helper of helpers) {
    allHelpers.push({ file, ...helper });
  }
}

const byName = new Map();
for (const helper of allHelpers) {
  const list = byName.get(helper.name) || [];
  list.push(helper);
  byName.set(helper.name, list);
}

const duplicates = [...byName.entries()]
  .map(([name, entries]) => ({
    name,
    entries,
    uniqueFiles: [...new Set(entries.map((entry) => entry.file))],
  }))
  .filter((entry) => entry.uniqueFiles.length > 1)
  .sort((a, b) => a.name.localeCompare(b.name));

const wantsJson = process.argv.includes('--json');
if (wantsJson) {
  process.stdout.write(
    `${JSON.stringify({ files: jsFiles, helperCount: allHelpers.length, duplicates }, null, 2)}\n`
  );
}

if (duplicates.length > 0) {
  console.error('❌ Doppelte globale Helper-Namen gefunden:');
  for (const duplicate of duplicates) {
    const locations = duplicate.entries
      .map((entry) => `${entry.file}:${entry.line}`)
      .join(', ');
    console.error(`- ${duplicate.name}: ${locations}`);
  }
  process.exit(1);
}

if (!wantsJson) {
  console.log(`✅ Keine doppelten globalen Helper-Namen gefunden (${allHelpers.length} Top-Level-Helper in ${jsFiles.length} Dateien).`);
}
