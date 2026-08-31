const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('planning2-playground-ui.js', 'utf8');
const preview = fs.readFileSync('planung2-preview.html', 'utf8');

test('all five fixation scopes have visible touch controls', () => {
  for (const scope of ['shift', 'day', 'employee-week', 'week', 'employee-period']) {
    assert.match(ui, new RegExp(`scope: ["']${scope}["']`), `${scope} needs a rendered control`);
  }
  assert.match(ui, /data-toggle-lock/);
  assert.match(ui, /aria-label=/);
  assert.match(preview, /touch-action:manipulation/);
  assert.match(preview, /min-height:44px/);
});

test('editing and shift fixation are separate and require no desktop modifier', () => {
  assert.match(ui, /class=\"pgEditCell\" data-cell/);
  assert.match(ui, /scope: "shift"/);
  assert.doesNotMatch(ui, /shiftKey|ctrlKey|metaKey|altKey/);
  assert.doesNotMatch(ui, /contextmenu|dblclick|mouseenter|hover/);
});

test('playground delegates edits to the existing Planning 2 editor on an isolated copy', () => {
  assert.match(preview, /window\.Planning2Editor=\{open/);
  assert.match(ui, /window\.Planning2Editor/);
  assert.match(ui, /api\.clone\(session\.workingPlan\)/);
  assert.match(ui, /api\.commitWorkingPlan\(session/);
  assert.doesNotMatch(ui, /start: "09:00", end: "17:00"/);
});

test('editor cancel has no playground commit callback and fast mode remains explicit', () => {
  assert.match(preview, /function closeEditor\(\)\{editing=null/);
  assert.match(preview, /if\(editing\?\.onCommit\)/);
  assert.doesNotMatch(ui, /generatePlanning2CandidateEvaluation|generatePlanning2MutationPackages|buildPlanning2ProblemCandidateGroups/);
});
