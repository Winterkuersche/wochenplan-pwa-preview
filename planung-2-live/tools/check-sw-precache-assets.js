#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const indexPath = path.join(repoRoot, 'index.html');
const swPath = path.join(repoRoot, 'sw.js');

// Bewusst lokal referenzierte Dateien, die NICHT in APP_FILES liegen müssen.
// Beispiel: './debug-only.js'
const LOCAL_ASSET_WHITELIST = [
];

function normalizeLocalAsset(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('./')) return null;
  const noHash = raw.split('#')[0];
  const noQuery = noHash.split('?')[0];
  return noQuery || null;
}

function collectIndexLocalAssets(indexSource) {
  const localAssets = new Set();
  const localLinkRelAllowlist = new Set([
    'manifest',
    'stylesheet',
    'modulepreload',
    'preload',
    'icon',
    'apple-touch-icon',
    'mask-icon'
  ]);
  const tagRegex = /<(script|link)\b[^>]*\b(src|href)\s*=\s*(["'])([^"']+)\3[^>]*>/gi;

  let match;
  while ((match = tagRegex.exec(indexSource)) !== null) {
    const [fullTag, tagName, attrName, , attrValue] = match;
    const tag = tagName.toLowerCase();
    const attr = attrName.toLowerCase();
    const isRelevant = (tag === 'script' && attr === 'src') || (tag === 'link' && attr === 'href');

    if (!isRelevant) continue;
    if (tag === 'link') {
      const relMatch = fullTag.match(/\brel\s*=\s*(["'])([^"']+)\1/i);
      const relValue = relMatch ? relMatch[2].toLowerCase() : '';
      const relTokens = relValue.split(/\s+/).filter(Boolean);
      const allowedByRel = relTokens.some((token) => localLinkRelAllowlist.has(token));

      if (!allowedByRel) continue;
    }

    const normalized = normalizeLocalAsset(attrValue);
    if (normalized) localAssets.add(normalized);
  }

  return [...localAssets].sort();
}

function extractArrayBlock(source, arrayName) {
  const marker = `const ${arrayName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  const bracketStart = source.indexOf('[', markerIndex);
  if (bracketStart < 0) return null;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  let depth = 0;

  for (let i = bracketStart; i < source.length; i += 1) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bracketStart, i + 1);
      }
    }
  }

  return null;
}

function extractStringLiterals(arrayBlock) {
  const literals = [];
  const stringRegex = /(["'])(.*?)\1/g;
  let match;
  while ((match = stringRegex.exec(arrayBlock)) !== null) {
    literals.push(match[2]);
  }
  return literals;
}

function collectSwAppFiles(swSource) {
  const appFilesBlock = extractArrayBlock(swSource, 'APP_FILES');
  if (!appFilesBlock) {
    throw new Error('APP_FILES konnte in sw.js nicht gefunden oder geparst werden.');
  }

  const localFiles = extractStringLiterals(appFilesBlock)
    .map((entry) => normalizeLocalAsset(entry))
    .filter(Boolean);

  return [...new Set(localFiles)].sort();
}

function main() {
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  const swSource = fs.readFileSync(swPath, 'utf8');

  const indexAssets = collectIndexLocalAssets(indexSource);
  const appFiles = collectSwAppFiles(swSource);
  const appFilesSet = new Set(appFiles);
  const whitelistSet = new Set(LOCAL_ASSET_WHITELIST.map(normalizeLocalAsset).filter(Boolean));

  const missing = indexAssets.filter((asset) => !appFilesSet.has(asset) && !whitelistSet.has(asset));

  if (missing.length > 0) {
    console.error('❌ Lokale Assets aus index.html fehlen in sw.js APP_FILES:');
    missing.forEach((asset) => {
      console.error(`- ${asset}`);
    });
    process.exit(1);
  }

  console.log(`✅ APP_FILES vollständig: ${indexAssets.length} lokale index.html-Assets sind berücksichtigt.`);
}

try {
  main();
} catch (error) {
  console.error('❌ Check fehlgeschlagen:', error.message);
  process.exit(1);
}
