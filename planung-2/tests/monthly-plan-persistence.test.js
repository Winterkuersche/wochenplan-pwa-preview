const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadScripts } = require('./test-helpers');
const app = fs.readFileSync('app.js', 'utf8');
function extract(name) { const start=app.indexOf(`function ${name}`); assert.notEqual(start,-1); const bodyStart=app.indexOf(') {',start)+2; let depth=0; for(let i=bodyStart;i<app.length;i+=1){if(app[i]==='{')depth+=1;else if(app[i]==='}'&&--depth===0)return app.slice(start,i+1)} throw Error(name); }
function baseline(month) { return { month, createdAt: month, entries: {} }; }

test('savePlanData persists every normalized monthly baseline in the existing plan state',()=>{
 const base=loadScripts(['monthly-plan-baselines.js']); let saved=null;
 const context=vm.createContext({normalizeMonthlyPlanBaselines:base.normalizeMonthlyPlanBaselines,PLAN_KEY:'plan',state:{weekFrom:'',weekTo:'',schedule:{},absences:[],salesByDate:{},monthlyPlanBaselines:{'2026-09':baseline('2026-09'),'2026-10':baseline('2026-10')}},saveJson:(_key,value)=>{saved=value;return true}});
 vm.runInContext(`${extract('savePlanData')};savePlanData()`,context);
 assert.deepEqual(Object.keys(saved.monthlyPlanBaselines),['2026-09','2026-10']);
});

test('buildInitialState loads multiple baselines and normalizes a legacy plan without the field',()=>{
 const base=loadScripts(['monthly-plan-baselines.js']);
 const context=vm.createContext({Date,MASTER_KEY:'master',normalizeMonthlyPlanBaselines:base.normalizeMonthlyPlanBaselines,loadJson:()=>({employees:[]}),defaultMasterState:()=>({employees:[]}),normalizeEmployee:x=>x,normalizeSchedule:x=>x,validateNormalizedSchedule:s=>({schedule:s}),normalizeAbsences:x=>x,normalizeIsoDate:x=>x,toIsoDate:()=> '2026-01-01'});
 vm.runInContext(extract('buildInitialState'),context);
 const modern=context.buildInitialState({planOverride:{schedule:{},absences:[],monthlyPlanBaselines:{'2026-09':baseline('2026-09'),'2026-10':baseline('2026-10')}}});
 const legacy=context.buildInitialState({planOverride:{schedule:{},absences:[]}});
 assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(modern.monthlyPlanBaselines))),['2026-09','2026-10']);
 assert.deepEqual(JSON.parse(JSON.stringify(legacy.monthlyPlanBaselines)),{});
});
