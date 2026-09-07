const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test('normal Planning 2 render does not generate candidates or mutation packages', () => {
  const render = extractFunction(preview, 'render');
  assert.doesNotMatch(render, /generatePlanning2CandidateEvaluation\s*\(/);
  assert.doesNotMatch(render, /generatePlanning2MutationPackages\s*\(/);
  assert.doesNotMatch(render, /buildPlanning2ProblemCandidateGroups\s*\(/);
  assert.match(render, /planning2OptimizationDebugResult\?\.key/);
});

test('optimization engines remain available behind the explicit debug entry point', () => {
  const build = extractFunction(preview, 'buildPlanning2OptimizationDebugResult');
  const start = extractFunction(preview, 'startPlanning2OptimizationDebug');
  assert.match(build, /generatePlanning2CandidateEvaluation\s*\(/);
  assert.match(build, /generatePlanning2MutationPackages\s*\(/);
  assert.match(start, /buildPlanning2OptimizationDebugResult\s*\(/);
  assert.match(preview, /window\.Planning2OptimizationDebug=\{start:/);
});
