import { contractPath } from './lib/contract-paths.mjs';
// Read-only regression checks. Run with: node tools/manufacturing/test-numbered-rough-shelves-contract.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
function load(rel,overrides={}) {
 const code=ts.transpileModule(fs.readFileSync(contractPath(root,rel),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 new Function('require','exports','module',code)(name => name in overrides ? overrides[name] : require(name),module.exports,module);
 return module.exports;
}
const department=load('libs/manufacturing/shared/util-constants/src/lib/department.constants.ts');
const shelf=load('libs/manufacturing/shared/util-constants/src/lib/shelf-location.constants.ts',{'./department.constants':department});
const workflow=load('libs/manufacturing/shared/util-constants/src/lib/blade-workflow.constants.ts',{'./shelf-location.constants':shelf});
let cases=0;
for(const [serial,part,number,position] of [['CGRR-A1A','RING','A1A',{shelf:'A',layer:1,bin:'A'}],['CGRP-D4B','PINION','D4B',{shelf:'D',layer:4,bin:'B'}],[' cgrr-z9z ','RING','Z9Z',{shelf:'Z',layer:9,bin:'Z'}]]) {
 const p=shelf.parseCuttergrindRoughShelfTag(serial);assert.equal(p.partTypeCode,part);assert.equal(p.shelfNumber,number);assert.deepEqual(p.position,position);assert.equal(p.department,'CUTTERGRIND');cases++;
}
for(const serial of ['CGRR','CGRP','CGRR-001','CGRR-1','CGRP-A0A','CGRR-ABC','CGRR-A1AX','CGDR-A1A']) {assert.equal(shelf.parseCuttergrindRoughShelfTag(serial),null);cases++;}
const full={stage_code:'READY_FOR_COATING',stage_name:'Ready for Coating',blade_count:13,required_blade_count:13,grinding_completed_at:'2026-09-30',part_type_code:'RING',location_serial:'CGRR-A1A',location_department:'CUTTERGRIND',location_type:'SHELF',container_serial:null};
for(const [overrides,expected] of [[{},'READY_FOR_COATING'],[{location_serial:'CGRP-A1A'},'NEEDS_SHELF_PLACEMENT'],[{location_serial:'CGRR-001'},'NEEDS_SHELF_PLACEMENT'],[{location_serial:'CGRR'},'NEEDS_SHELF_PLACEMENT'],[{location_serial:null},'NEEDS_SHELF_PLACEMENT'],[{blade_count:12},'NEEDS_REPLACEMENT_BLADES'],[{blade_count:0},'NEEDS_REPLACEMENT_BLADES'],[{required_blade_count:null},'NEEDS_REVIEW'],[{blade_count:14},'NEEDS_REVIEW'],[{grinding_completed_at:null},'NEEDS_REVIEW'],[{container_serial:'C0001'},'NEEDS_REVIEW'],[{stage_code:'AT_COATER'},'AT_COATER']]) {assert.equal(workflow.classifyTrayAvailabilityStage({...full,...overrides}).code,expected);cases++;}
// Dull and finished shelves: shelf letter, layer number, bin letter (CGDR-A1A = shelf A, layer 1, bin A).
for(const [serial,part,number,position,kind] of [['CGDR-A1A','RING','A1A',{shelf:'A',layer:1,bin:'A'},'CUTTERGRIND_DULL'],[' cgdp-c4b ','PINION','C4B',{shelf:'C',layer:4,bin:'B'},'CUTTERGRIND_DULL'],['CGFR-B2C','RING','B2C',{shelf:'B',layer:2,bin:'C'},'CUTTERGRIND_FINISHED'],['cgfp-z9z','PINION','Z9Z',{shelf:'Z',layer:9,bin:'Z'},'CUTTERGRIND_FINISHED']]) {
 const p=shelf.parseCuttergrindNumberedShelfTag(serial);assert.equal(p.kind,kind);assert.equal(p.partTypeCode,part);assert.equal(p.shelfNumber,number);assert.deepEqual(p.position,position);cases++;
}
for(const serial of ['CGDR-001','CGFR-012','CGDP-A0A','CGDR-A10A','CGFR-AA1','CGDR-1A1','CGFP-A1','CGRR-A1A']) {assert.equal(shelf.parseCuttergrindNumberedShelfTag(serial),null);cases++;}
assert.equal(shelf.buildCuttergrindShelfTag('CUTTERGRIND_DULL','PINION','b',2,'c'),'CGDP-B2C');cases++;
assert.equal(shelf.buildCuttergrindShelfTag('CUTTERGRIND_FINISHED','RING','A',1,'A'),'CGFR-A1A');cases++;
assert.equal(shelf.buildCuttergrindShelfTag('CUTTERGRIND_ROUGH','PINION','c',3,'d'),'CGRP-C3D');cases++;
assert.equal(shelf.buildCuttergrindShelfTag('CUTTERGRIND_FINISHED','RING','A',0,'A'),null);cases++;
assert.equal(shelf.describeCuttergrindShelfPosition({shelf:'A',layer:1,bin:'A'}),'Shelf A, layer 1, bin A');cases++;
assert.equal(shelf.parseSummaryShelfTag('GSR-31706').summaryNumber,'31706');cases++;
// Ground sets wait at COATER-STAGING by default; a container takes exactly one complete set.
assert.equal(workflow.classifyTrayAvailabilityStage({...full,location_serial:'COATER-STAGING'}).code,'READY_FOR_COATING');cases++;
assert.equal(workflow.classifyTrayAvailabilityStage({...full,location_serial:'COATER-STAGING',location_department:'GREENSHED'}).code,'NEEDS_SHELF_PLACEMENT');cases++;
const set=(status,count=13)=>({required_blade_count:13,blades:Array.from({length:count},()=>({status}))});
for(const [args,expected] of [
  [[true,0,[],null],{load:true,receive:false}],
  [[true,0,[],set('ready_for_coating')],{load:false,receive:false}],
  [[true,0,[],set('at_coater')],{load:false,receive:true}],
  [[true,0,[],set('at_coater',12)],{load:false,receive:false}],
  [[false,0,[],set('at_coater')],{load:false,receive:false}],
]) {assert.deepEqual(workflow.containerWorkflowEligibility(...args),expected);cases++;}
const ready={enabled:true,blade_count:13,required_blade_count:13,grinding_completed_at:'2026-09-30',summary_id:'s',part_type_id:'p',part_type:{code:'RING'},current_stage:{code:'READY_FOR_COATING'},current_container:null,current_cutter_build:null,blades:Array.from({length:13},()=>({status:'ready_for_coating'}))};
assert.equal(workflow.trayWorkflowEligibility({...ready,current_location:{serial_number:'COATER-STAGING'}}).coater_load,true);cases++;
assert.equal(workflow.trayWorkflowEligibility({...ready,current_location:{serial_number:'CGRR-A1A'}}).coater_load,true);cases++;
assert.equal(workflow.trayWorkflowEligibility({...ready,current_location:{serial_number:'CGRP-A1A'}}).coater_load,false);cases++;
console.log(`[PASS] Numbered rough shelves / readiness: ${cases} read-only cases`);
