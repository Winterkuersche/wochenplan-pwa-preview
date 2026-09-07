const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = fs.readFileSync('.github/workflows/planung-2-preview.yml', 'utf8');

test('Planning 2 workflow tests before publishing to the existing preview repository', () => {
  const tests = workflow.indexOf('node --test tests/planning2-preview-startup.test.js');
  const checkout = workflow.indexOf('repository: Winterkuersche/wochenplan-pwa-preview');
  const publish = workflow.indexOf('source/ "$preview_directory/"');

  assert.match(workflow, /branches:\s*\n\s*- planung-2-interaktiv/);
  assert.ok(tests >= 0, 'Planning 2 tests must remain in the workflow');
  assert.ok(checkout > tests, 'preview checkout must happen after the tests');
  assert.ok(publish > checkout, 'publishing must happen after preview checkout');
});

test('Planning 2 deployment is isolated from main and production Pages', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /token: \$\{\{ secrets\.PREVIEW_REPOSITORY_TOKEN \}\}/);
  assert.match(workflow, /preview-repository\/planung-2/);
  assert.doesNotMatch(workflow, /actions\/(?:deploy-pages|upload-pages-artifact)/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- main/);
});
