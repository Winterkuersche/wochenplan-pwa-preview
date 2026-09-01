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

test('E4 controls are explicit, bounded, touchable and keep running variants visible', () => {
  assert.match(ui, /data-optimize/); assert.match(ui, /data-optimize-from-here/); assert.match(ui, /slice\(0, 3\)/);
  assert.match(ui, /role="tab"/); assert.match(ui, /data-variant/); assert.match(ui, /Varianten vergleichen/);
  assert.match(ui, /session\.optimization\.status === "running"/); assert.match(ui, /Bestehender Spielplatz bleibt erhalten/);
  assert.match(ui, /data-unlock=/); assert.match(ui, /aria-label="Fixierung lösen"/); assert.match(ui, /hardConstraintResult\?\.allowed === false/);
  assert.doesNotMatch(ui, /shiftKey|ctrlKey|metaKey|altKey|dblclick|contextmenu/);
});

test('opening, rendering, tab selection, comparison and manual editing never run optimization', () => {
  assert.match(ui, /workflow\.optimize\(session/);
  assert.match(ui, /target\.hasAttribute\("data-optimize"\)/);
  assert.doesNotMatch(ui, /openButton\.onclick[^\n]*workflow\.optimize/);
  assert.equal([...ui.matchAll(/workflow\.optimize\(session/g)].length, 1);
  assert.match(ui, /workflow\.reevaluateSelected\(session, evaluateVariant\)/);
});

test('comparison renders persisted E3 facts rather than calculating a UI score', () => {
  for (const fact of ['variantFacts', 'explanationFacts', 'externalHelpHints', 'understaffingMinutes', 'employeesInMinus', 'gfbRemainingMinutes', 'outsideSelectedWeekChangeCount']) assert.match(ui, new RegExp(fact));
  assert.doesNotMatch(ui, /compareDomainFacts|rankingVector|score\s*[=:(]/i);
});
