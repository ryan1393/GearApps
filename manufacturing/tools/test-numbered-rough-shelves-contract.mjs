// Read-only regression checks. Run with: node tools/test-numbered-rough-shelves-contract.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(rel,overrides={}) {
 const code=ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 new Function('require','exports','module',code)(name => name in overrides ? overrides[name] : require(name),module.exports,module);
 return module.exports;
}
const department=load('libs/shared/util-constants/src/lib/department.constants.ts');
const shelf=load('libs/shared/util-constants/src/lib/shelf-location.constants.ts',{'./department.constants':department});
const workflow=load('libs/shared/util-constants/src/lib/blade-workflow.constants.ts',{'./shelf-location.constants':shelf});
let cases=0;
for(const [serial,part,number] of [['CGRR-001','RING','001'],['CGRP-042','PINION','042'],[' cgrr-999 ','RING','999']]) {
 const p=shelf.parseCuttergrindRoughShelfTag(serial);assert.equal(p.partTypeCode,part);assert.equal(p.shelfNumber,number);assert.equal(p.department,'CUTTERGRIND');cases++;
}
for(const serial of ['CGRR','CGRP','CGRR-1','CGRP-1000','CGRR-ABC','CGRR-001X','CGDR-001']) {assert.equal(shelf.parseCuttergrindRoughShelfTag(serial),null);cases++;}
const full={stage_code:'READY_FOR_COATING',stage_name:'Ready for Coating',blade_count:13,required_blade_count:13,grinding_completed_at:'2026-09-30',part_type_code:'RING',location_serial:'CGRR-001',location_department:'CUTTERGRIND',location_type:'SHELF',container_serial:null};
for(const [overrides,expected] of [[{},'READY_FOR_COATING'],[{location_serial:'CGRP-001'},'NEEDS_SHELF_PLACEMENT'],[{location_serial:'CGRR'},'NEEDS_SHELF_PLACEMENT'],[{location_serial:null},'NEEDS_SHELF_PLACEMENT'],[{blade_count:12},'NEEDS_REPLACEMENT_BLADES'],[{blade_count:0},'NEEDS_REPLACEMENT_BLADES'],[{required_blade_count:null},'NEEDS_REVIEW'],[{blade_count:14},'NEEDS_REVIEW'],[{grinding_completed_at:null},'NEEDS_REVIEW'],[{container_serial:'C0001'},'NEEDS_REVIEW'],[{stage_code:'AT_COATER'},'AT_COATER']]) {assert.equal(workflow.classifyTrayAvailabilityStage({...full,...overrides}).code,expected);cases++;}
assert.equal(shelf.parseCuttergrindNumberedShelfTag('CGFR-012').kind,'CUTTERGRIND_FINISHED');cases++;
assert.equal(shelf.parseSummaryShelfTag('GSR-31706').summaryNumber,'31706');cases++;
console.log(`[PASS] Numbered rough shelves / readiness: ${cases} read-only cases`);
