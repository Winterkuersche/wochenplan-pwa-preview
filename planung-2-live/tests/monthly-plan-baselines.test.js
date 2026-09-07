const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

function api() {
  const context = loadScripts([
    'time-utils.js', 'date-utils.js', 'status-utils.js', 'shift-rules.js', 'shift-utils.js', 'holidays.js',
    'absences.js', 'day-resolution.js', 'monthly-plan-baselines.js'
  ]);
  return { context, call(expression) { return JSON.parse(JSON.stringify(require('node:vm').runInContext(expression, context))); } };
}
function shift(start, end, pause = 0) { return { type: 'shift', start, end, pause }; }

 test('creates a compact month-only baseline and supports independent months', () => {
  const { context, call } = api();
  context.s = { employees:[{id:'a'}], schedule:{'2026-09-30':{a:shift('09:00','14:00')},'2026-10-01':{a:shift('09:00','17:00')},'2026-11-01':{a:shift('09:00','14:00')}}, absences:[] };
  call("createMonthlyPlanBaseline('2026-09',s,{createdAt:'a'})");
  call("createMonthlyPlanBaseline('2026-10',s,{createdAt:'b'})");
  const september = call("getMonthlyPlanBaseline('2026-09',s)");
  assert.deepEqual(Object.keys(september.entries), ['2026-09-30']);
  assert.equal(call("hasMonthlyPlanBaseline('2026-10',s)"), true);
  assert.equal(september.entries['2026-10-01'], undefined);
 });

test('snapshot and getter are deeply detached from the current plan', () => {
  const { context, call } = api(); context.s={employees:[{id:'a'}],schedule:{'2026-10-01':{a:shift('09:00','14:00')}},absences:[]};
  call("createMonthlyPlanBaseline('2026-10',s)");
  context.s.schedule['2026-10-01'].a.end='19:00';
  context.copy = require('node:vm').runInContext("getMonthlyPlanBaseline('2026-10',s)", context); context.copy.entries['2026-10-01'].a.end='12:00';
  assert.equal(call("getMonthlyPlanBaseline('2026-10',s).entries['2026-10-01'].a.end"), '14:00');
});

test('create never overwrites, replace is explicit, and delete is month-scoped', () => {
 const {context,call}=api();context.s={employees:[{id:'a'}],schedule:{'2026-09-01':{a:shift('09:00','14:00')},'2026-10-01':{a:shift('09:00','14:00')}},absences:[]};
 call("createMonthlyPlanBaseline('2026-09',s,{createdAt:'first'})");call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-09-01'].a.end='17:00';
 assert.equal(call("createMonthlyPlanBaseline('2026-09',s,{createdAt:'second'})"), null);assert.equal(call("getMonthlyPlanBaseline('2026-09',s).createdAt"),'first');
 call("replaceMonthlyPlanBaseline('2026-09',s,{createdAt:'second'})");assert.equal(call("getMonthlyPlanBaseline('2026-09',s).entries['2026-09-01'].a.end"),'17:00');
 assert.equal(call("deleteMonthlyPlanBaseline('2026-09',s)"),true);assert.equal(call("hasMonthlyPlanBaseline('2026-10',s)"),true);
});

test('comparison identifies unchanged, precise shift, status, added and removed workdays',()=>{
 const {context,call}=api();context.s={employees:[{id:'same'},{id:'time'},{id:'free'},{id:'sick'},{id:'removed'},{id:'added'}],schedule:{'2026-10-01':{same:shift('09:00','14:00'),time:shift('09:00','14:00'),free:{type:'off'},sick:shift('09:00','19:00'),removed:shift('09:00','14:00')}},absences:[]};call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-10-01'].time.end='17:00';context.s.schedule['2026-10-01'].free=shift('09:00','14:00');delete context.s.schedule['2026-10-01'].removed;context.s.schedule['2026-10-01'].added=shift('09:00','14:00');context.s.absences=[{employeeId:'sick',type:'sick',from:'2026-10-01',to:'2026-10-01'}];
 const x=call("compareMonthlyPlanToBaseline('2026-10',s).changes['2026-10-01']");assert.equal(x.same.type,'UNCHANGED');assert.equal(x.time.type,'SHIFT_EXTENDED_END');assert.equal(x.free.type,'WORKDAY_ADDED');assert.equal(x.sick.type,'STATUS_CHANGED');assert.equal(x.sick.changeOrigin,'circumstance');assert.equal(x.removed.type,'WORKDAY_REMOVED');assert.equal(x.added.type,'WORKDAY_ADDED');
});

test('structured facts classify all one- and two-boundary shift changes', () => {
  const { context, call } = api();
  context.cases = {
    same: [{kind:'shift',start:'09:00',end:'15:00'}, {kind:'shift',start:'09:00',end:'15:00'}],
    endPlus: [{kind:'shift',start:'09:00',end:'14:00'}, {kind:'shift',start:'09:00',end:'14:30'}],
    endMinus: [{kind:'shift',start:'09:00',end:'15:00'}, {kind:'shift',start:'09:00',end:'14:30'}],
    startEarlier: [{kind:'shift',start:'09:00',end:'15:00'}, {kind:'shift',start:'08:30',end:'15:00'}],
    startLater: [{kind:'shift',start:'09:00',end:'15:00'}, {kind:'shift',start:'09:30',end:'15:00'}],
    both: [{kind:'shift',start:'09:00',end:'14:00'}, {kind:'shift',start:'12:00',end:'17:00'}]
  };
  const facts = call("Object.fromEntries(Object.entries(cases).map(([key,value])=>[key,getMonthlyPlanChangeFacts(...value)]))");
  assert.equal(facts.same.changeType, 'UNCHANGED');
  assert.equal(facts.same.changeOrigin, 'none');
  assert.deepEqual([facts.endPlus.changeType, facts.endPlus.endDifferenceMinutes], ['SHIFT_EXTENDED_END', 30]);
  assert.deepEqual([facts.endMinus.changeType, facts.endMinus.endDifferenceMinutes], ['SHIFT_SHORTENED_END', -30]);
  assert.deepEqual([facts.startEarlier.changeType, facts.startEarlier.startDifferenceMinutes], ['SHIFT_EXTENDED_START', -30]);
  assert.deepEqual([facts.startLater.changeType, facts.startLater.startDifferenceMinutes], ['SHIFT_SHORTENED_START', 30]);
  assert.deepEqual([facts.both.changeType, facts.both.startDifferenceMinutes, facts.both.endDifferenceMinutes], ['SHIFT_MOVED_OR_RESIZED', 180, 180]);
  assert.equal(facts.endPlus.changeOrigin, 'planning');
});

test('workday and circumstance changes have distinct neutral facts', () => {
  const { context, call } = api();
  context.entries = { empty:null, off:{kind:'off'}, shift:{kind:'shift',start:'09:00',end:'15:00'}, sick:{kind:'sick'}, vacation:{kind:'vacation'}, holiday:{kind:'holiday',label:'Feiertag'} };
  const facts = call("({offToWork:getMonthlyPlanChangeFacts(entries.off,entries.shift),emptyToWork:getMonthlyPlanChangeFacts(entries.empty,entries.shift),workToOff:getMonthlyPlanChangeFacts(entries.shift,entries.off),workToEmpty:getMonthlyPlanChangeFacts(entries.shift,entries.empty),sick:getMonthlyPlanChangeFacts(entries.shift,entries.sick),vacation:getMonthlyPlanChangeFacts(entries.shift,entries.vacation),holiday:getMonthlyPlanChangeFacts(entries.shift,entries.holiday)})");
  for (const key of ['offToWork','emptyToWork']) assert.deepEqual([facts[key].changeType,facts[key].workdayAdded,facts[key].changeOrigin],['WORKDAY_ADDED',true,'planning']);
  for (const key of ['workToOff','workToEmpty']) assert.deepEqual([facts[key].changeType,facts[key].workdayRemoved,facts[key].changeOrigin],['WORKDAY_REMOVED',true,'planning']);
  for (const key of ['sick','vacation','holiday']) assert.deepEqual([facts[key].changeType,facts[key].changeOrigin,facts[key].workdayRemoved],['STATUS_CHANGED','circumstance',true]);
  assert.equal(facts.offToWork.startDifferenceMinutes, null);
});

test('work delta delegates to central exception and pause logic',()=>{
 const {context,call}=api();context.s={employees:[{id:'a'}],schedule:{'2026-10-01':{a:shift('08:55','14:00')}},absences:[]};call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-10-01'].a=shift('08:55','19:10');
 const change=call("compareMonthlyPlanToBaseline('2026-10',s).changes['2026-10-01'].a");
 assert.equal(change.workMinutesDifference,240);assert.equal(call("getMonthlyPlanEntryWorkedMinutes({kind:'shift',start:'08:55',end:'19:10',pause:0})"),540);
});

test('special 08:55 and 19:10 boundaries retain central worked-minute semantics', () => {
  const { call } = api();
  assert.equal(call("getMonthlyPlanChangeFacts({kind:'shift',start:'09:00',end:'14:00'},{kind:'shift',start:'08:55',end:'14:00'}).startDifferenceMinutes"), -5);
  assert.equal(call("getMonthlyPlanChangeFacts({kind:'shift',start:'09:00',end:'19:00'},{kind:'shift',start:'09:00',end:'19:10'}).endDifferenceMinutes"), 10);
  const fullDay = call("getMonthlyPlanChangeFacts({kind:'shift',start:'09:00',end:'19:00'},{kind:'shift',start:'08:55',end:'19:10'})");
  assert.equal(fullDay.changeType, 'SHIFT_MOVED_OR_RESIZED');
  assert.equal(fullDay.workMinutesDifference, 0);
});

test('published holiday resolution hides a technically stored shift',()=>{
 const {context,call}=api();context.s={stateKey:'schleswig-holstein',employees:[{id:'a',target:'30:00'}],schedule:{'2026-10-03':{a:shift('09:00','14:00')}},absences:[]};
 call("createMonthlyPlanBaseline('2026-10',s)");
 const entry=call("getMonthlyPlanBaseline('2026-10',s).entries['2026-10-03'].a");
 assert.equal(entry.kind,'holiday');assert.equal(entry.start,undefined);assert.equal(entry.end,undefined);
});

test('stored pause differences do not change an otherwise identical shift',()=>{
 const {context,call}=api();context.s={employees:[{id:'a'}],schedule:{'2026-10-01':{a:shift('09:00','17:00',15)}},absences:[]};call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-10-01'].a.pause=90;context.s.schedule['2026-10-01'].a.breakMinutes=90;
 assert.equal(call("compareMonthlyPlanToBaseline('2026-10',s).changes['2026-10-01'].a.type"),'UNCHANGED');
});

test('per-day lookup selects the baseline month at cross-month boundaries',()=>{
 const {context,call}=api();context.s={employees:[{id:'a'}],schedule:{'2026-09-30':{a:shift('09:00','14:00')},'2026-10-01':{a:shift('09:00','14:00')}},absences:[]};call("createMonthlyPlanBaseline('2026-09',s)");call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-09-30'].a.end='17:00';
 assert.equal(call("comparePlanEntryToMonthlyBaseline('2026-09-30','a',s).change.type"),'SHIFT_EXTENDED_END');assert.equal(call("comparePlanEntryToMonthlyBaseline('2026-10-01','a',s).change.type"),'UNCHANGED');
});

test('detail descriptions are derived from structured facts', () => {
 const {context,call}=api();context.change={changeType:'SHIFT_SHORTENED_START',changeOrigin:'planning',startDifferenceMinutes:30};
 assert.equal(call('formatMonthlyPlanChangeDescription(change)'), 'Schicht beginnt 0:30 später');
 assert.equal(call("formatMonthlyPlanChangeDescription({changeType:'WORKDAY_ADDED',changeOrigin:'planning'})"), 'Zusätzlicher Arbeitstag');
 assert.equal(call("formatMonthlyPlanChangeDescription({changeType:'STATUS_CHANGED',changeOrigin:'circumstance'})"), 'Geänderte Rahmenbedingung');
});

test('missing and legacy baseline state normalize safely',()=>{const {context,call}=api();context.s={schedule:{},absences:[]};assert.deepEqual(call("normalizeMonthlyPlanBaselines(undefined)"),{});assert.deepEqual(call("compareMonthlyPlanToBaseline('2026-10',s)"),{hasBaseline:false,month:'2026-10',changes:null,changeCount:null,netWorkMinutes:null});});

test('serialized plan state loads multiple normalized baselines unchanged',()=>{
 const {context,call}=api();context.persisted=JSON.stringify({schedule:{},absences:[],monthlyPlanBaselines:{'2026-09':{month:'2026-09',createdAt:'a',entries:{}},'2026-10':{month:'2026-10',createdAt:'b',entries:{'2026-10-01':{a:{kind:'off'}}}}}});context.loaded=JSON.parse(context.persisted);context.loaded.monthlyPlanBaselines=context.normalizeMonthlyPlanBaselines(context.loaded.monthlyPlanBaselines);
 assert.deepEqual(call("Object.keys(loaded.monthlyPlanBaselines)"),['2026-09','2026-10']);assert.equal(call("loaded.monthlyPlanBaselines['2026-10'].entries['2026-10-01'].a.kind"),'off');
});

test('serialized legacy plan state loads with an empty baseline map',()=>{const {context,call}=api();context.loaded=JSON.parse('{"schedule":{},"absences":[]}');context.loaded.monthlyPlanBaselines=context.normalizeMonthlyPlanBaselines(context.loaded.monthlyPlanBaselines);assert.deepEqual(call("loaded.monthlyPlanBaselines"),{});});

test('normal edits remain possible after freezing',()=>{const {context,call}=api();context.s={employees:[{id:'a'}],schedule:{'2026-10-01':{a:shift('09:00','14:00')}},absences:[]};call("createMonthlyPlanBaseline('2026-10',s)");context.s.schedule['2026-10-01'].a.end='17:00';assert.equal(context.s.schedule['2026-10-01'].a.end,'17:00');assert.equal(call("getMonthlyPlanBaseline('2026-10',s).entries['2026-10-01'].a.end"),'14:00');});
