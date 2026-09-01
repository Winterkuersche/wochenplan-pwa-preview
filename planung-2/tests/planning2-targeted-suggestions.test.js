const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPlanning2TargetedSuggestionService } = require('../planning2-targeted-suggestions.js');

const problem = { isoDate: '2026-09-11', gap: { kind: 'understaffing', start: 960, end: 1140, missingPeople: 1 } };
const otherDay = { isoDate: '2026-09-12', coverage: { gaps: [] } };
const targetDay = { isoDate: problem.isoDate, coverage: { gaps: [problem.gap] } };
const candidate = (id, extra = {}) => ({
  candidateId: id, problemId: `${problem.isoDate}|understaffing|960|1140`, isoDate: problem.isoDate,
  employeeId: id, employeeName: id, understaffingWindow: problem.gap, resolvesTargetGap: true,
  mutations: [{ isoDate: problem.isoDate, employeeId: id, before: null, after: { start: '16:00', end: '19:00' } }],
  constraintResults: { allowed: true }, ...extra
});

function harness(values, packages = [], compareCentralFacts) {
  const calls = [];
  const service = createPlanning2TargetedSuggestionService({
    generateCandidates(context) { calls.push(context); return { candidates: values, rejected: [] }; },
    generatePackages(context, input) { return { packages, generationFacts: { inputCandidateCount: input.length } }; },
    rankCandidates(input) { return [...input].sort((a, b) => (b.priority || 0) - (a.priority || 0)); },
    rankPackages(input) { return input; },
    compareCentralFacts
  });
  return { service, calls };
}

test('service is lazy and only runs after an explicit request', () => {
  const { service, calls } = harness([]);
  assert.equal(service.getRunCount(), 0);
  assert.equal(calls.length, 0);
  service.request({ days: [targetDay] }, problem);
  assert.equal(service.getRunCount(), 1);
});

test('candidate pipeline receives only the requested day and bounded settings', () => {
  const { service, calls } = harness([candidate('a')]);
  const result = service.request({ days: [otherDay, targetDay] }, problem);
  assert.deepEqual(calls[0].days.map(day => day.isoDate), [problem.isoDate]);
  assert.equal(calls[0].enableExistingShiftMutations, true);
  assert.equal(result.generationFacts.bounded, true);
  assert.equal(result.generationFacts.candidateCap, 48);
});

test('shows at most three valid problem-specific suggestions without padding', () => {
  const values = [candidate('a'), candidate('b'), candidate('c'), candidate('d'), candidate('invalid', { constraintResults: { allowed: false } }), candidate('other', { problemId: 'other', isoDate: '2026-09-12' })];
  const result = harness(values).service.request({ days: [targetDay] }, problem);
  assert.equal(result.suggestions.length, 3);
  assert.ok(result.suggestions.every(item => item.constraintResults.allowed));
  assert.ok(result.suggestions.every(item => item.isoDate === problem.isoDate));
  assert.equal(harness([candidate('only')]).service.request({ days: [targetDay] }, problem).suggestions.length, 1);
});

test('common central facts comparator is not overwritten by a local mutation-count sort', () => {
  const simple = candidate('simple', { rankingFacts: { domainRank: 2 } });
  const betterPackage = {
    packageId: 'better-package', problemIds: [simple.problemId], valid: true,
    rankingFacts: { domainRank: 1 }, coverageFacts: { improvedMinutes: 60, fullyResolved: false },
    mutations: [simple.mutations[0], { ...simple.mutations[0], employeeId: 'support' }]
  };
  const compare = (left, right) => left.domainRank - right.domainRank;
  const result = harness([simple], [betterPackage], compare).service.request({ days: [targetDay] }, problem);
  assert.equal(result.suggestions[0].packageId, 'better-package');
  assert.equal(result.suggestions[0].mutations.length, 2);
});

test('existing candidate coverage facts are preserved without deriving minutes from window length', () => {
  const value = candidate('facts', { coverageFacts: { improvedMinutes: 75, understaffingMinutesBefore: 180, understaffingMinutesAfter: 105, fullyResolved: false } });
  const result = harness([value]).service.request({ days: [targetDay] }, problem);
  assert.deepEqual(result.suggestions[0].coverageFacts, value.coverageFacts);
});

test('packages remain atomic and structured carryover/GFB/free-day facts become short reasons', () => {
  const value = candidate('package', { isGfb: true, hasRegularFreeDay: true, requiredFollowUpMutations: [{ isoDate: '2026-09-12', employeeId: 'package', before: null, after: { start: '08:55', end: '12:00' } }] });
  const result = harness([value]).service.request({ days: [targetDay] }, problem);
  assert.equal(result.suggestions[0].mutations.length, 2);
  assert.ok(result.suggestions[0].reasons.length <= 2);
  assert.match(result.suggestions[0].reasons.join(' '), /vollständig|GFB|freien Tag|Ausgleich/);
});

test('external help is a non-actionable hint only when no complete internal solution exists', () => {
  const empty = harness([]).service.request({ days: [targetDay] }, problem);
  assert.deepEqual(empty.externalHelp, { windows: [{ isoDate: problem.isoDate, start: 960, end: 1140, missingPeople: 1 }], actionable: false });
  assert.equal(harness([candidate('full')]).service.request({ days: [targetDay] }, problem).externalHelp, null);
});

test('partial coverage reports only structured remaining external-help windows', () => {
  const partial = candidate('partial', { resolvesTargetGap: false, coverageFacts: { improvedMinutes: 120, fullyResolved: false }, coverageAfter: { gaps: [{ kind: 'understaffing', start: 1080, end: 1140, required: 2, actual: 1 }] } });
  const result = harness([partial]).service.request({ days: [targetDay] }, problem);
  assert.deepEqual(result.externalHelp.windows, [{ isoDate: problem.isoDate, start: 1080, end: 1140, missingPeople: 1 }]);
});

test('two same-day gaps have separate controls and selecting gap A cannot return gap B', () => {
  const html = fs.readFileSync('planung2-preview.html', 'utf8');
  assert.match(html, /gaps\.filter\(gap=>gap\.kind==='understaffing'\)\.map/);
  assert.match(html, /data-targeted-start/);
  const gapB = candidate('gap-b', { problemId: '2026-09-11|understaffing|540|660', understaffingWindow: { kind: 'understaffing', start: 540, end: 660 } });
  const result = harness([candidate('gap-a'), gapB]).service.request({ days: [targetDay] }, problem);
  assert.deepEqual(result.suggestions.map(item => item.candidateId), ['gap-a']);
});

test('normal render stays fast and targeted UI is touch capable without Stage E calls', () => {
  const html = fs.readFileSync('planung2-preview.html', 'utf8');
  const renderStart = html.indexOf('function render()');
  const renderEnd = html.indexOf("document.getElementById('weeks').onclick", renderStart);
  const render = html.slice(renderStart, renderEnd);
  assert.doesNotMatch(render, /planning2TargetedService\.request/);
  assert.match(html, /data-targeted-day/);
  assert.match(html, /data-targeted-apply/);
  assert.match(html, /min-height:44px/);
  const openStart = html.indexOf('function openPlanning2TargetedSuggestions');
  const openEnd = html.indexOf('function applyPlanning2TargetedSuggestion', openStart);
  const open = html.slice(openStart, openEnd);
  assert.match(open, /planning2TargetedService\.request/);
  assert.doesNotMatch(open, /Planning2Playground|StageE|buildPlanning2Playground|OptimizationHistory/);
});

test('apply path revalidates fresh state, stores one undo snapshot, and uses atomic package apply', () => {
  const html = fs.readFileSync('planung2-preview.html', 'utf8');
  const start = html.indexOf('function applyPlanning2TargetedSuggestion');
  const end = html.indexOf('let planning2DebugGroups', start);
  const apply = html.slice(start, end);
  assert.match(apply, /preparePlanning2MutationPackageApply/);
  assert.match(apply, /buildFreshContext/);
  assert.match(apply, /planning2OptimizationUndo=clone\(plan\)/);
  assert.match(apply, /save\(TEST_PLAN,prepared\.plan\)/);
  assert.match(apply, /nicht mehr aktuell/);
});
