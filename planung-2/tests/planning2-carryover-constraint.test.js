const test = require('node:test');
const assert = require('node:assert/strict');
global.isHolidayDate = (state, iso) => new Set(['2026-05-14','2026-12-25','2026-12-26','2027-01-01']).has(iso);
const carryover = require('../planning2-carryover.js');
const employees = [{id:'normal',roleKey:'MA'},{id:'sv',roleKey:'SV'},{id:'tl',roleKey:'TL'}];
const shift = (start='09:00',end='19:00') => ({type:'shift',start,end});
const plan = (closing='2026-09-30',morning='2026-10-01',morningStarts={tl:'08:55',sv:'09:00',normal:'09:00'}) => ({schedule:{[closing]:{normal:shift('09:00','19:10'),sv:shift('09:00','19:10'),tl:shift('09:00','19:10')},[morning]:Object.fromEntries(employees.map(e=>[e.id,shift(morningStarts[e.id]||'09:00','15:00')]))},absences:[],monthlyPlanBaselines:{}});
const evaluate = (value,morning='2026-10-01') => carryover.evaluatePlanning2CarryoverRule({plan:value,employees,morningIso:morning});

test('read-only validator accepts the ranked opener and preserves its complete input',()=>{const value=plan(),before=JSON.stringify(value),result=evaluate(value);assert.equal(result.ok,true);assert.equal(result.expectedOpenerEmployeeId,'tl');assert.deepEqual(result.actualOpenerEmployeeIds,['tl']);assert.equal(JSON.stringify(value),before)});
test('missing, wrong, and multiple 08:55 openers have explicit violation codes',()=>{let missing=evaluate(plan(undefined,undefined,{}));assert.ok(missing.violations.some(v=>v.code==='MISSING_0855_OPENER'));let wrong=evaluate(plan(undefined,undefined,{normal:'08:55'}));assert.ok(wrong.violations.some(v=>v.code==='WRONG_0855_OPENER'));let multiple=evaluate(plan(undefined,undefined,{normal:'08:55',tl:'08:55'}));assert.ok(multiple.violations.some(v=>v.code==='MULTIPLE_0855_OPENERS'))});
test('central rank is TL, then SV/STV, then stable employee order',()=>{let get=(e,d)=>d==='close'?shift('09:00','19:10'):shift();assert.deepEqual(carryover.rankPlanning2CarryoverCandidates(employees,get,'close','morning').map(e=>e.id),['tl','sv','normal']);let regular=[{id:'b'},{id:'a'}];assert.deepEqual(carryover.rankPlanning2CarryoverCandidates(regular,get,'close','morning').map(e=>e.id),['b','a'])});
test('Monday links to Saturday and Friday links to Saturday',()=>{assert.equal(carryover.previousPlanning2RelevantWorkday('2026-10-05'),'2026-10-03');assert.equal(carryover.nextPlanning2RelevantWorkday('2026-10-02'),'2026-10-03')});
test('cross-month and cross-year searches skip arbitrary closed sequences',()=>{assert.equal(carryover.previousPlanning2RelevantWorkday('2026-10-01'),'2026-09-30');assert.equal(carryover.nextPlanning2RelevantWorkday('2026-12-24'),'2026-12-28');assert.equal(carryover.nextPlanning2RelevantWorkday('2026-12-31'),'2027-01-02')});
test('custom closed dates and holiday plus Sunday are skipped without warnings on closed days',()=>{let value={closedDates:['2026-05-15','2026-05-16'],schedule:{}};assert.equal(carryover.nextPlanning2RelevantWorkday('2026-05-13',value),'2026-05-18');assert.equal(carryover.evaluatePlanning2CarryoverRule({plan:value,employees,morningIso:'2026-05-14'}).ok,true)});
test('problem representation is deterministic and isolated from evaluation arrays',()=>{let result=evaluate(plan(undefined,undefined,{})),problem=carryover.planning2CarryoverProblem(result);assert.equal(problem.problemId,'2026-10-01|carryover-opener');assert.equal(problem.type,'carryover-opener');problem.actualEmployeeIds.push('x');assert.deepEqual(result.actualOpenerEmployeeIds,[])});
test('candidate closer change exposes required follow-up and hard violation without mutating plan',()=>{let value={schedule:{'2026-10-05':{tl:shift('09:00','19:00')},'2026-10-06':{tl:shift('09:00','15:00')}},absences:[],monthlyPlanBaselines:{}},before=JSON.stringify(value),candidate={mutations:[{isoDate:'2026-10-05',employeeId:'tl',before:{start:'09:00',end:'19:00'},after:{start:'09:00',end:'19:10'}}]},result=carryover.evaluatePlanning2CandidateFollowUpRules(candidate,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift:(workingPlan,employee,isoDate)=>workingPlan.schedule?.[isoDate]?.[employee.id]||null});assert.equal(result.valid,false);assert.equal(result.touchesCarryoverRule,true);assert.deepEqual(result.requiredFollowUpMutations,[{isoDate:'2026-10-06',employeeId:'tl',before:{start:'09:00',end:'15:00'},after:{start:'08:55',end:'15:00'},reason:'CARRYOVER_OPENER'}]);assert.ok(result.violations.some(v=>v.rule==='CARRYOVER_OPENER_RULE'&&v.reason==='MISSING_0855_OPENER'));assert.equal(JSON.stringify(value),before)});
test('candidate without special boundaries has no carryover follow-up',()=>{let value={schedule:{'2026-10-05':{normal:shift('09:00','13:00')}},absences:[]},candidate={mutations:[{isoDate:'2026-10-05',employeeId:'normal',before:{start:'09:00',end:'13:00'},after:{start:'09:00',end:'14:00'}}]},result=carryover.evaluatePlanning2CandidateFollowUpRules(candidate,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift:(workingPlan,employee,isoDate)=>workingPlan.schedule?.[isoDate]?.[employee.id]||null});assert.equal(result.valid,true);assert.equal(result.touchesCarryoverRule,false);assert.deepEqual(result.requiredFollowUpMutations,[])});
test('candidate before several closed days affects first relevant morning',()=>{let value={closedDates:['2026-12-24'],schedule:{'2026-12-23':{tl:shift('09:00','19:00')},'2026-12-28':{tl:shift('09:00','15:00')}}},candidate={mutations:[{isoDate:'2026-12-23',employeeId:'tl',before:{start:'09:00',end:'19:00'},after:{start:'09:00',end:'19:10'}}]},result=carryover.evaluatePlanning2CandidateFollowUpRules(candidate,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift:(workingPlan,employee,isoDate)=>workingPlan.schedule?.[isoDate]?.[employee.id]||null});assert.equal(result.rules[1].morningIso,'2026-12-28');assert.equal(result.requiredFollowUpMutations[0].isoDate,'2026-12-28')});

test('explicit manual 08:55 group is preferred, auto opener is not, and roles rank inside the active group',()=>{
  const people=[{id:'tl',roleKey:'TL'},{id:'sv',roleKey:'SV'},{id:'normal',roleKey:'MA'}];
  const values={close:Object.fromEntries(people.map(e=>[e.id,shift('09:00','19:10')])),morning:{tl:{...shift('08:55','15:00'),planning2AutoOpener:true,code:'FO'},sv:{...shift('08:55','15:00'),code:'FLEX'},normal:{...shift('08:55','15:00'),code:'FO'}}};
  const get=(employee,day)=>values[day][employee.id];
  assert.deepEqual(carryover.rankPlanning2CarryoverCandidates(people,get,'close','morning').map(e=>e.id),['sv','normal']);
  values.morning.sv.planning2AutoOpener=true; values.morning.normal.planning2AutoOpener=true;
  assert.deepEqual(carryover.rankPlanning2CarryoverCandidates(people,get,'close','morning').map(e=>e.id),['tl','sv','normal']);
  delete values.morning.sv.planning2AutoOpener; delete values.morning.normal.planning2AutoOpener; people[2].roleKey='TL';
  assert.deepEqual(carryover.rankPlanning2CarryoverCandidates(people,get,'close','morning').map(e=>e.id),['normal','sv']);
});

test('resolved sickness, vacation, and holiday states govern candidate follow-up',()=>{
  const resolveWorkShift=(workingPlan,employee,isoDate)=>{
    if(global.isHolidayDate('',isoDate))return null;
    if((workingPlan.absences||[]).some(a=>a.employeeId===employee.id&&a.from<=isoDate&&a.to>=isoDate))return null;
    const value=workingPlan.schedule?.[isoDate]?.[employee.id];return value?.type==='shift'?value:null;
  };
  for(const type of ['sick','vacation']){
    const value={schedule:{'2026-10-05':{tl:shift('09:00','19:00')},'2026-10-06':{tl:shift('08:55','15:00')}},absences:[{employeeId:'tl',type,from:'2026-10-05',to:'2026-10-05'}]};
    const candidate={mutations:[{isoDate:'2026-10-05',employeeId:'tl',before:{start:'09:00',end:'19:00'},after:{start:'09:00',end:'19:10'}}]},before=JSON.stringify(value);
    const result=carryover.evaluatePlanning2CandidateFollowUpRules(candidate,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift});
    assert.equal(result.valid,true,type);assert.deepEqual(result.introducedViolations,[],type);assert.equal(JSON.stringify(value),before,type);
  }
  const sickMorning={schedule:{'2026-10-05':{tl:shift('09:00','19:00')},'2026-10-06':{tl:shift('08:55','15:00')}},absences:[{employeeId:'tl',type:'sick',from:'2026-10-06',to:'2026-10-06'}]};
  const result=carryover.evaluatePlanning2CandidateFollowUpRules({mutations:[{isoDate:'2026-10-05',employeeId:'tl',before:{start:'09:00',end:'19:00'},after:{start:'09:00',end:'19:10'}}]},{sourcePlan:sickMorning,sourceEmployees:employees,resolveWorkShift});
  assert.ok(result.introducedViolations.some(v=>v.reason==='NO_ELIGIBLE_CARRYOVER_OPENER'));
  assert.equal(carryover.evaluatePlanning2CarryoverRule({plan:sickMorning,employees,morningIso:'2026-05-14',getShift:(e,d)=>resolveWorkShift(sickMorning,e,d)}).ok,true);
});

test('unchanged pre-existing violation does not reject, changed violation does, and fixing one is allowed',()=>{
  const resolveWorkShift=(workingPlan,employee,isoDate)=>workingPlan.schedule?.[isoDate]?.[employee.id]||null;
  const value=plan('2026-10-05','2026-10-06',{normal:'08:55'});
  const unrelated={mutations:[{isoDate:'2026-10-06',employeeId:'sv',before:{start:'09:00',end:'15:00'},after:{start:'09:00',end:'16:00'}}]};
  let result=carryover.evaluatePlanning2CandidateFollowUpRules(unrelated,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift});
  assert.equal(result.valid,true);assert.ok(result.preExistingViolations.length);assert.deepEqual(result.introducedViolations,[]);assert.deepEqual(result.requiredFollowUpMutations,[]);
  const fixes={mutations:[{isoDate:'2026-10-06',employeeId:'normal',before:{start:'08:55',end:'15:00'},after:{start:'09:00',end:'15:00'}},{isoDate:'2026-10-06',employeeId:'tl',before:{start:'09:00',end:'15:00'},after:{start:'08:55',end:'15:00'}}]};
  result=carryover.evaluatePlanning2CandidateFollowUpRules(fixes,{sourcePlan:value,sourceEmployees:employees,resolveWorkShift});assert.equal(result.valid,true);assert.deepEqual(result.introducedViolations,[]);
});
