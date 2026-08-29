const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const preview = fs.readFileSync('planung2-preview.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const expectedDependencies = [
  'holidays.js',
  'time-utils.js',
  'shift-rules.js',
  'date-utils.js',
  'shift-utils.js',
  'status-utils.js',
  'absences.js',
  'day-resolution.js',
  'monthly-plan-baselines.js'
];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
      opened = true;
    } else if (source[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.hidden = false;
    this.dataset = {};
    this.className = '';
    this.classList = { add() {}, remove() {} };
  }

  setAttribute() {}
  click() {}
}

function startPreview(initialValues = {}) {
  const storage = new Map(Object.entries(initialValues));
  const elements = {};
  for (const match of preview.matchAll(/id="([^"]+)"/g)) {
    elements[match[1]] = new FakeElement(match[1]);
  }

  const listeners = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = new FakeElement(id)),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: new FakeElement('body')
  };
  const window = {
    addEventListener: (type, listener) => { listeners[type] = listener; }
  };
  const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    decodeURIComponent,
    document,
    window,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    confirm: () => true,
    alert() {}
  });

  const scripts = [...preview.matchAll(/<script(?: src="\.\/([^"]+)")?>([\s\S]*?)<\/script>/g)];
  const dependencies = scripts.map((match) => match[1]).filter(Boolean);
  for (const [index, match] of scripts.entries()) {
    const filename = match[1] || `planung2-preview-inline-${index}.js`;
    const source = match[1] ? fs.readFileSync(match[1], 'utf8') : match[2];
    vm.runInContext(source, context, { filename });
  }

  return { context, dependencies, elements, listeners, storage };
}

test('preview starts without localStorage data and shows a clear empty state', () => {
  const result = startPreview();

  assert.deepEqual(result.dependencies, expectedDependencies);
  assert.match(result.elements.title.textContent, /\d{4}/);
  assert.match(result.elements.weeks.innerHTML, /data-w="0"/);
  assert.match(result.elements.grid.innerHTML, /Keine Stammdaten gefunden/);
  assert.equal(result.elements.planung2RuntimeStatus.hidden, true);
  assert.ok(result.storage.has('wochenplan_plan_v10_planning2_preview'));
});

test('preview renders weeks and employees from normal master and plan data', () => {
  const master = { employees: [{ id: 'employee-1', name: 'Ada Beispiel', roleKey: 'TZ', target: '30:00' }] };
  const plan = {
    weekFrom: '2026-08-24',
    weekTo: '2026-08-29',
    schedule: {
      '2026-08-24': {
        'employee-1': { type: 'shift', code: 'F3', start: '09:00', end: '12:00', minutes: 180 }
      }
    },
    absences: []
  };
  const result = startPreview({
    wochenplan_master_v10_planning2_preview: JSON.stringify(master),
    wochenplan_plan_v10_planning2_preview: JSON.stringify(plan)
  });

  assert.match(result.elements.weeks.innerHTML, /data-w="4"/);
  vm.runInContext('activeWeek=4;render()', result.context);
  assert.match(result.elements.grid.innerHTML, /Ada Beispiel/);
  assert.match(result.elements.grid.innerHTML, /09:00–12:00/);
  assert.doesNotMatch(result.elements.grid.innerHTML, /Keine Stammdaten/);
});

test('preview imports a transfer without reading or overwriting live storage', () => {
  const liveMaster = JSON.stringify({ employees: [{ id: 'live', name: 'Live bleibt getrennt' }] });
  const livePlan = JSON.stringify({ schedule: { live: true }, absences: [] });
  const result = startPreview({
    wochenplan_master_v10: liveMaster,
    wochenplan_plan_v10: livePlan
  });
  assert.match(result.elements.grid.innerHTML, /Keine Stammdaten gefunden/);

  const transfer = {
    format: 'wochenplan-planning2-transfer',
    version: 1,
    master: { employees: [{ id: 'preview', name: 'Nur Preview', roleKey: 'TZ', target: '20:00' }] },
    plan: { weekFrom: '2026-08-24', schedule: {}, absences: [] }
  };
  result.context.transfer = transfer;
  vm.runInContext('importPlanning2Data(transfer)', result.context);

  assert.match(result.elements.grid.innerHTML, /Nur Preview/);
  assert.equal(result.storage.get('wochenplan_master_v10'), liveMaster);
  assert.equal(result.storage.get('wochenplan_plan_v10'), livePlan);
  assert.deepEqual(
    JSON.parse(result.storage.get('wochenplan_master_v10_planning2_preview')),
    transfer.master
  );
  assert.deepEqual(
    JSON.parse(result.storage.get('wochenplan_plan_v10_planning2_preview')),
    transfer.plan
  );
});

test('normal app transfer contains only cloned master and current plan data', () => {
  const values = {
    wochenplan_master_v10: { employees: [{ id: 'employee-1' }] },
    wochenplan_plan_v10: { schedule: {}, absences: [], salesByDate: { secret: 1 }, monthlyPlanBaselines: {'2026-09':{month:'2026-09',createdAt:'published',entries:{}}} }
  };
  const context = vm.createContext({
    MASTER_KEY: 'wochenplan_master_v10',
    PLAN_KEY: 'wochenplan_plan_v10',
    Date,
    defaultMasterState: () => ({ employees: [] }),
    defaultPlanState: () => ({ schedule: {}, absences: [] }),
    cloneMonthlyPlanValue: (value) => structuredClone(value),
    loadJson: (key, fallback) => structuredClone(values[key] ?? fallback)
  });
  vm.runInContext(`${extractFunction(app, 'collectPlanning2TransferSnapshot')};this.snapshot=collectPlanning2TransferSnapshot()`, context);
  const snapshot = JSON.parse(JSON.stringify(context.snapshot));

  assert.equal(snapshot.format, 'wochenplan-planning2-transfer');
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.master, values.wochenplan_master_v10);
  assert.deepEqual(snapshot.plan, { schedule: {}, absences: [], monthlyPlanBaselines: values.wochenplan_plan_v10.monthlyPlanBaselines });
  assert.deepEqual(Object.keys(snapshot).sort(), ['createdAt', 'format', 'master', 'plan', 'version']);
});

test('normal app transfer and preview normalization preserve monthly baselines exactly', () => {
  const baselines = {'2026-09':{month:'2026-09',createdAt:'published',entries:{'2026-09-30':{a:{kind:'shift',start:'09:00',end:'14:00'}}}}};
  const transfer = {format:'wochenplan-planning2-transfer',version:1,master:{employees:[{id:'a',name:'A'}]},plan:{schedule:{},absences:[],monthlyPlanBaselines:baselines}};
  const result = startPreview();
  result.context.transfer = structuredClone(transfer);
  vm.runInContext('importPlanning2Data(transfer);getTestPlan()', result.context);
  const imported = JSON.parse(result.storage.get('wochenplan_plan_v10_planning2_preview'));
  assert.deepEqual(imported.monthlyPlanBaselines, baselines);
});
