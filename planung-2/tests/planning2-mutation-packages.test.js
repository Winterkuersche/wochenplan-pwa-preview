const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');
const central = loadScripts(['time-utils.js','employee-availability.js']);
global.getBusinessRequiredBreakMinutes = central.getBusinessRequiredBreakMinutes;
global.getWorkedMinutesFromRange = central.getWorkedMinutesFromRange;
global.isPlanning2AllowedPlanTime = central.isPlanning2AllowedPlanTime;
global.validateShiftAgainstEmployeeAvailability = central.validateShiftAgainstEmployeeAvailability;
const packages = require('../planning2-mutation-packages.js');

const shift = (start, end) => ({ type: 'shift', status: 'work', start, end, minutes: central.getWorkedMinutesFromRange(start, end, central.getBusinessRequiredBreakMinutes(start, end)) });
function context({ plan, people, dates, evaluateCoverage } = {}) {
  people ||= [{ employeeId: 'a', evaluation: { weeklyActualMinutes: 900 }, gfbMonthActualMinutes: 900, gfbMonthLimitMinutes: 2580 }];
  dates ||= ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12'];
  plan ||= { schedule: { '2026-09-07': { a: shift('09:00','15:00') }, '2026-09-08': {}, '2026-09-09': { a: shift('09:00','15:00') }, '2026-09-10': { a: shift('09:00','15:00') }, '2026-09-11': { a: shift('09:00','15:00') }, '2026-09-12': { a: shift('09:00','15:00') } } };
  const days = dates.map(isoDate => ({ isoDate, resolvedEntries: people.map(p => { const value=plan.schedule?.[isoDate]?.[p.employeeId]; return value ? { type:'shift', sourceEntry:value } : { type:'empty' }; }), coverage:{ok:true,gaps:[]} }));
  return { sourcePlan:plan, employees:people, sourceEmployees:people.map(p=>({id:p.employeeId})), days, evaluateCoverage };
}
const mutation = (isoDate, employeeId, before, after) => ({ isoDate, employeeId, before, after });

test('free-day compensation validates only the complete package and removal creates an empty cell',()=>{
  const c=context(), create=mutation('2026-09-08','a',null,{type:'shift',start:'09:00',end:'12:00'}), remove=mutation('2026-09-07','a',{start:'09:00',end:'15:00'},null);
  assert.equal(packages.simulatePlanning2MutationPackage(c,{mutations:[create]}).valid,false);
  const result=packages.simulatePlanning2MutationPackage(c,{packageType:'FREE_DAY_COMPENSATION',mutations:[create,remove]});
  assert.equal(result.valid,true); assert.equal(result.simulatedPlan.schedule['2026-09-07'].a,undefined); assert.ok(!JSON.stringify(result.simulatedPlan).includes('AG-Frei'));
});

test('combined hour transfer has net GFB facts and can exchange remove/add coverage atomically',()=>{
  const people=[{employeeId:'a',evaluation:{weeklyActualMinutes:900,isGfb:true},gfbMonthActualMinutes:2400,gfbMonthLimitMinutes:2580},{employeeId:'b',evaluation:{weeklyActualMinutes:600,isGfb:true},gfbMonthActualMinutes:600,gfbMonthLimitMinutes:2580}];
  const plan={schedule:{'2026-09-07':{a:shift('09:00','12:00')},'2026-09-08':{b:shift('09:00','12:00')}}};
  const c=context({plan,people,dates:['2026-09-07','2026-09-08','2026-09-09']});
  const result=packages.simulatePlanning2MutationPackage(c,{mutations:[mutation('2026-09-07','a',{start:'09:00',end:'12:00'},null),mutation('2026-09-07','b',null,{type:'shift',start:'09:00',end:'12:00'})]});
  assert.equal(result.valid,true); assert.equal(result.hoursFacts.a.deltaMinutes,-180); assert.equal(result.hoursFacts.b.deltaMinutes,180); assert.equal(result.gfbFacts.employees.length,2);
});

test('GFB package is rejected only when its final employee month total exceeds the hard maximum',()=>{
  const people=[{employeeId:'a',evaluation:{weeklyActualMinutes:0,isGfb:true},gfbMonthActualMinutes:2500,gfbMonthLimitMinutes:2580}];
  const c=context({people,plan:{schedule:{}},dates:['2026-09-07','2026-09-08']});
  const result=packages.simulatePlanning2MutationPackage(c,{mutations:[mutation('2026-09-07','a',null,{start:'09:00',end:'12:00'})]});
  assert.ok(result.constraintResults.violations.some(v=>v.rule==='GFB_MONTH_LIMIT'));
});

test('coverage is evaluated after every package mutation and a final new gap rejects the package',()=>{
  let calls=0; const evaluateCoverage=entries=>{calls++;return entries.some(e=>e?.sourceEntry?.start==='12:00')?{ok:false,gaps:[{kind:'understaffing',start:540,end:600}]}:{ok:true,gaps:[]}};
  const c=context({evaluateCoverage}), bad=packages.simulatePlanning2MutationPackage(c,{mutations:[mutation('2026-09-07','a',{start:'09:00',end:'15:00'},{start:'12:00',end:'15:00'})]});
  assert.equal(calls,1); assert.equal(bad.valid,false); assert.ok(bad.constraintResults.violations.some(v=>v.rule==='NEW_UNDERSTAFFING'));
});

test('conflicting cell mutations reject while exact duplicates deduplicate and IDs stay deterministic',()=>{
  const a=mutation('2026-09-07','a',{start:'09:00',end:'15:00'},{start:'09:00',end:'14:00'}), b={...a,after:{start:'10:00',end:'14:00'}};
  assert.equal(packages.normalizePlanning2PackageMutations([a,a]).mutations.length,1);
  assert.ok(packages.simulatePlanning2MutationPackage(context(),{mutations:[a,b]}).constraintResults.violations.some(v=>v.rule==='CONFLICTING_PACKAGE_MUTATIONS'));
  assert.equal(packages.planning2PackageId('X',[a],['b','a']),packages.planning2PackageId('X',[a],['a','b']));
});

test('time constraints accept only the regular grid plus exact 08:55 and 19:10 boundaries',()=>{
  const c=context();
  for(const [start,end,valid] of [['08:55','12:00',true],['16:00','19:10',true],['07:00','10:00',false],['18:00','20:00',false],['13:10','16:10',false],['14:05','17:05',false],['09:00','11:45',false]]){
    const result=packages.simulatePlanning2MutationPackage(c,{mutations:[mutation('2026-09-07','a',{start:'09:00',end:'15:00'},{start,end})]});
    assert.equal(result.constraintResults.violations.some(v=>['INVALID_TIME_GRID','MINIMUM_SHIFT_DURATION'].includes(v.rule)),!valid,`${start}-${end}`);
  }
});

test('generation is side-effect free, creates compensation packages, and exposes complete facts',()=>{
  const c=context(), before=JSON.stringify(c), candidates=[
    {candidateId:'create',problemId:'p1',employeeId:'a',mutationType:'EMPTY_TO_WORK',requiresCompensatingPackage:true,actualChangeMinutes:180,mutations:[mutation('2026-09-08','a',null,{type:'shift',start:'09:00',end:'12:00'})]},
    {candidateId:'remove',problemId:'p2',employeeId:'a',mutationType:'SHIFT_REMOVE',actualChangeMinutes:-360,mutations:[mutation('2026-09-07','a',{start:'09:00',end:'15:00'},null)]}
  ];
  const result=packages.generatePlanning2MutationPackages(c,candidates), value=result.packages[0];
  assert.equal(JSON.stringify(c),before); assert.equal(value.packageType,'FREE_DAY_COMPENSATION'); assert.equal(value.mutations.length,2); assert.deepEqual(value.affectedEmployeeIds,['a']); assert.deepEqual(value.affectedIsoDates,['2026-09-07','2026-09-08']); assert.ok(value.coverageFacts&&value.hoursFacts&&value.gfbFacts&&value.freeDayFacts&&value.disruptionFacts);
});

test('atomic apply rejects stale before state without changing source and applies/undo-ready copies otherwise',()=>{
  const c=context(), source=structuredClone(c.sourcePlan), packageSuggestion={mutations:[mutation('2026-09-07','a',{start:'09:00',end:'15:00'},null),mutation('2026-09-08','a',null,{start:'09:00',end:'12:00'})]};
  const prepared=packages.preparePlanning2MutationPackageApply(source,packageSuggestion,{validationContext:c});
  assert.equal(prepared.valid,true); assert.equal(source.schedule['2026-09-07'].a.start,'09:00'); assert.equal(prepared.plan.schedule['2026-09-07'].a,undefined);
  const stale=packages.preparePlanning2MutationPackageApply({...source,schedule:{...source.schedule,'2026-09-07':{a:shift('10:00','15:00')}}},packageSuggestion,{validationContext:c});
  assert.equal(stale.valid,false); assert.equal(stale.plan,null);
});

test('apply fully revalidates a package against fresh availability and leaves the source untouched',()=>{
  const original=context(), source=structuredClone(original.sourcePlan), packageSuggestion={mutations:[mutation('2026-09-07','a',{start:'09:00',end:'15:00'},{start:'09:00',end:'14:00'}),mutation('2026-09-08','a',null,{start:'09:00',end:'12:00'})]};
  const fresh=context({plan:source,people:[{employeeId:'a',sourceEmployee:{availability:{dates:{'2026-09-08':{earliestStart:'13:00'}}}},evaluation:{weeklyActualMinutes:900},gfbMonthActualMinutes:900,gfbMonthLimitMinutes:2580}]});
  const before=JSON.stringify(source), result=packages.preparePlanning2MutationPackageApply(source,packageSuggestion,{buildFreshContext:()=>fresh});
  assert.equal(result.valid,false); assert.ok(result.violations.some(v=>v.rule==='EMPLOYEE_AVAILABILITY')); assert.equal(result.plan,null); assert.equal(JSON.stringify(source),before);
});

test('generator prunes large unrelated candidate sets before package simulation',()=>{
  const candidates=[];
  for(let problem=0;problem<40;problem++)for(let option=0;option<20;option++){const date=new Date('2026-09-07T00:00:00Z');date.setUTCDate(date.getUTCDate()+problem*7);candidates.push({candidateId:`${problem}-${option}`,problemId:`p${problem}`,employeeId:`e${problem%5}`,mutationType:'SHIFT_RESIZE',actualChangeMinutes:option%2?15:-15,mutations:[mutation(date.toISOString().slice(0,10),`e${problem%5}`,{start:'09:00',end:'15:00'},{start:'09:00',end:option%2?'15:15':'14:45'})]})}
  const result=packages.generatePlanning2MutationPackages(context(),candidates);
  assert.equal(result.generationFacts.inputCandidateCount,800); assert.ok(result.generationFacts.preselectedCandidateCount<=40*8); assert.equal(result.generationFacts.simulatedPairCount,0); assert.ok(result.generationFacts.consideredPairCount<800*799/2);
});
