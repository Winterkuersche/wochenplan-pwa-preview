const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');

test('employee rendering uses a separately constrained and escaped name row', () => {
  assert.match(preview, /class="personNameRow"/);
  assert.match(preview, /class="personName" title="'\+escapedName\+'">'\+escapedName/);
  assert.match(preview, /escapedName=escapePlanning2Html\(e\.name\|\|'—'\)/);
});

test('the GT badge remains conditional and outside the shrinking name', () => {
  assert.match(preview, /<span class="personName"[^>]*>[^<]*<\/span>'\+\(e\.planning2FullDayCandidate===true\?'<span class="fullDayBadge"/);
});

test('name CSS ellipsizes a shrinkable flex item without widening the 104px column', () => {
  assert.match(preview, /grid-template-columns:104px 516px/);
  assert.match(preview, /\.personNameRow\{display:flex;align-items:center;min-width:0\}/);
  assert.match(preview, /\.personName\{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
  assert.match(preview, /\.fullDayBadge\{flex:0 0 auto/);
});
