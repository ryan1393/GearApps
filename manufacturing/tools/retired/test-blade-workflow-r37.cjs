'use strict';
// Isolated source-level regression tests. Repositories and HTTP are in-memory doubles.
// No connection strings, Docker commands, SQL, installations, or external services.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(process.argv[2]||process.cwd());
const req=createRequire(path.join(root,'package.json'));
let ts;try{ts=req('typescript')}catch(e){if(process.env.DANA_R37_TEST_TS)ts=require(process.env.DANA_R37_TEST_TS);else throw e;}
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const tests=[];const test=(name,f)=>tests.push({name,f});
function deco(){return ()=>{};}
const entityTokens=new Proxy({PaginationService:class PaginationService{constructor(){} }},{get:(o,k)=>o[k]||(o[k]=class {[Symbol.toStringTag]=k;static entityName=k})});
const exceptions={};for(const n of ['ConflictException','NotFoundException','UnprocessableEntityException','BadRequestException'])exceptions[n]=class extends Error{constructor(m){super(m);this.name=n;}};
const common={...exceptions,Injectable:deco,Logger:class{log(){}debug(){}warn(){}}};
class Subscription {constructor(fn){this.fn=fn;this.closed=false}unsubscribe(){if(!this.closed){this.closed=true;this.fn?.()}}}
class Observable {
 constructor(start){this.start=start;}
 subscribe(target){if(typeof target==='function')target={next:target};target=target||{};let finished=false,inner;const obs={next:v=>{if(!finished)target.next?.(v)},error:e=>{if(!finished){finished=true;target.error?.(e)}},complete:()=>{if(!finished){finished=true;target.complete?.()}}};
 try{inner=this.start(obs)}catch(e){obs.error(e)}return new Subscription(()=>{finished=true;if(typeof inner==='function')inner();else inner?.unsubscribe()});}
 pipe(...ops){return ops.reduce((o,f)=>f(o),this);}
}
class Subject extends Observable {constructor(){const targets=new Set();super(o=>{targets.add(o);return()=>targets.delete(o)});this.targets=targets;}next(v){for(const o of [...this.targets])o.next(v)}error(e){for(const o of [...this.targets])o.error(e);this.targets.clear()}complete(){for(const o of [...this.targets])o.complete();this.targets.clear()}}
const of=(...values)=>new Observable(o=>{values.forEach(v=>o.next(v));o.complete()});const EMPTY=of();
const map=f=>src=>new Observable(o=>src.subscribe({next:v=>{try{o.next(f(v))}catch(e){o.error(e)}},error:e=>o.error(e),complete:()=>o.complete()}));
const catchError=f=>src=>new Observable(o=>{let sub;const s=src.subscribe({next:v=>o.next(v),complete:()=>o.complete(),error:e=>{sub=f(e).subscribe(o)}});return()=>{s.unsubscribe();sub?.unsubscribe()}});
const takeUntil=notifier=>src=>new Observable(o=>{const s=src.subscribe(o);const n=notifier.subscribe({next:()=>{s.unsubscribe();o.complete()}});return()=>{s.unsubscribe();n.unsubscribe()}});
const defer=f=>new Observable(o=>f().subscribe(o));const throwError=f=>new Observable(o=>o.error(f()));
const reduce=(fn,seed)=>src=>new Observable(o=>{let a=seed;return src.subscribe({next:v=>{a=fn(a,v)},error:e=>o.error(e),complete:()=>{o.next(a);o.complete()}})});
const expand=project=>src=>new Observable(o=>{let active=0,done=false;const subs=[];function visit(s){active++;subs.push(s.subscribe({next:v=>{if(done)return;o.next(v);try{visit(project(v))}catch(e){done=true;o.error(e)}},error:e=>{done=true;o.error(e)},complete:()=>{if(!--active&&!done)o.complete()}}))}visit(src);return()=>{done=true;subs.forEach(s=>s.unsubscribe())}});
const forkJoin=sources=>new Observable(o=>{const keys=Object.keys(sources),out={};let left=keys.length;const ss=keys.map(k=>sources[k].subscribe({next:v=>out[k]=v,error:e=>o.error(e),complete:()=>{if(!--left){o.next(out);o.complete()}}}));return()=>ss.forEach(s=>s.unsubscribe())});
const rx={Subject,Observable,Subscription,of,EMPTY,map,catchError,takeUntil,defer,throwError,reduce,expand,forkJoin};
let injection={};const tokens={};function token(n){return tokens[n]||(tokens[n]=class{static key=n})}
const angular={Component:deco,Injectable:deco,ViewChild:deco,inject:t=>{const key=t.key;if(!(key in injection))throw Error('Missing injection '+key);return injection[key];}};
const typeorm={In:v=>({op:'in',v}),Not:v=>({op:'not',v}),IsNull:()=>({op:'null'}),Repository:class{},DataSource:class{}};
const exportsCache=new Map();
function load(rel,overrides={}){
 const key=rel;if(!Object.keys(overrides).length && exportsCache.has(key))return exportsCache.get(key);
 const code=ts.transpileModule(read(rel),{fileName:rel,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:false},reportDiagnostics:true});
 const errors=(code.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);assert.equal(errors.length,0,rel+' TypeScript syntax: '+errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
 const mod={exports:{}};
 const resolver=id=>{
  if(id in overrides)return overrides[id];
  if(id==='@libs/shared/util-types')return utilTypes;
  if(id==='@libs/shared/util-constants')return constants;
  if(id==='@libs/server/data-access')return entityTokens;
  if(id==='@nestjs/common')return common;
  if(id==='@nestjs/typeorm')return {InjectRepository:deco,InjectDataSource:deco};
  if(id==='typeorm')return typeorm;
  if(id==='crypto'||id==='node:crypto')return require('node:crypto');
  if(id==='@angular/core')return angular;
  if(id==='@angular/common')return {CommonModule:token('CommonModule')};
  if(id==='@angular/forms')return {FormsModule:token('FormsModule')};
  if(id==='@angular/common/http')return {HttpClient:token('HttpClient'),HttpErrorResponse:class extends Error{constructor(x){super(x.message);Object.assign(this,x)}}};
  if(id==='@libs/frontend/util-common')return {GearToastService:token('GearToastService')};
  if(id==='@libs/frontend/data-access-blade-tracking')return {BladeTrackingApiService:token('BladeTrackingApiService'),apiErrorText:(e,f)=>e?.error?.message||e?.message||f};
  if(id==='@dana/ui')return new Proxy({},{get:(o,k)=>token(String(k))});
  if(id.includes('scan-panel.component'))return {ScanPanelComponent:token('ScanPanelComponent')};
  if(id.includes('scan-message'))return {};
  if(id==='rxjs')return rx;
  if(id==='./department.constants')return load('libs/shared/util-constants/src/lib/department.constants.ts');
  if(id==='./cutter-card-ipl')return {};
  throw Error('Unexpected module in isolated test: '+id+' ('+rel+')');
 };
 vm.runInNewContext(code.outputText,{require:resolver,module:mod,exports:mod.exports,console,Date,Math,Set,Map,JSON,queueMicrotask,Uint8Array,TextEncoder,Buffer,setTimeout,clearTimeout},{filename:rel});
 if(!Object.keys(overrides).length)exportsCache.set(key,mod.exports);return mod.exports;
}
let utilTypes={};let constants={};
Object.assign(utilTypes,load('libs/shared/util-types/src/lib/enums/blade-status.enum.ts'),load('libs/shared/util-types/src/lib/enums/blade-history-event.enum.ts'));
// Shelf constants are self-contained.
Object.assign(constants,load('libs/shared/util-constants/src/lib/department.constants.ts'),load('libs/shared/util-constants/src/lib/shelf-location.constants.ts'),load('libs/shared/util-constants/src/lib/blade-workflow.constants.ts'));
const serviceRel=(feat,name=feat)=>`libs/server/feat-${feat}/src/lib/server-feat-${name}.service.ts`;
const Batch=load(serviceRel('blade-tray')).ServerFeatBladeTrayService;
const Trays=load(serviceRel('tray')).ServerFeatTrayService;
const Containers=load(serviceRel('container')).ServerFeatContainerService;
const Coater=load(serviceRel('container-tray')).ServerFeatContainerTrayService;
const Movement=load(serviceRel('location-tray')).ServerFeatLocationTrayService;
const Cutter=load(serviceRel('cutter-build')).ServerFeatCutterBuildService;
const plain=x=>JSON.parse(JSON.stringify(x));
function memory(){
 let state={},seq=0;const calls=[];const relation={tray:['TrayOrmEntity','tray_id'],blade:['BladeOrmEntity','blade_id'],container:['ContainerOrmEntity','container_id'],summary:['PartSummaryOrmEntity','summary_id'],part_type:['CutterPartTypeOrmEntity','part_type_id'],current_stage:['TrayStageOrmEntity','current_stage_id'],location:['LocationOrmEntity','location_id'],status:['CutterBuildStatusOrmEntity','status_id'],cutter_body:['CutterBodyOrmEntity','cutter_body_id']};
 const match=(r,w)=>{if(Array.isArray(w))return w.some(x=>match(r,x));return Object.entries(w||{}).every(([k,v])=>v?.op==='in'?v.v.includes(r[k]):v?.op==='not'?r[k]!==v.v:v?.op==='null'?r[k]==null:r[k]===v)};
 const hydrate=(r,rels)=>{if(!r)return null;const out=plain(r);for(const [k,config]of Object.entries(rels||{})){const [n,f]=relation[k]||[];if(n)out[k]=hydrate((state[n]||[]).find(x=>x.id===out[f]),typeof config==='object'?config:{});}
 Object.defineProperty(out,'toJSON',{enumerable:false,value:()=>Object.fromEntries(Object.entries(out))});return out;};
 const getRepository=t=>{const name=typeof t==='string'?t:t.entityName;if(!name)throw Error('Unnamed entity');const rows=()=>state[name]||(state[name]=[]);
 const repo={manager:null,create:x=>plain(x),find:async(opts={})=>{calls.push({entity:name,method:'find',opts:plain(opts)});let all=rows().filter(r=>match(r,opts.where));for(const [k,d]of Object.entries(opts.order||{}).reverse())all=all.slice().sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(d==='DESC'?-1:1));return all.map(r=>hydrate(r,opts.relations));},
 findOne:async opts=>{calls.push({entity:name,method:'findOne',opts:plain(opts)});if(opts.lock&&opts.relations)throw Error('Nullable-join lock rejected');return hydrate(rows().find(r=>match(r,opts.where)),opts.relations)},
 findOneBy:async where=>hydrate(rows().find(r=>match(r,where))),findOneOrFail:async opts=>{const r=await repo.findOne(opts);if(!r)throw Error('Not found '+name);return r;},count:async(opts={})=>rows().filter(r=>match(r,opts.where)).length,
 save:async input=>{if(Array.isArray(input)){const out=[];for(const x of input)out.push(await repo.save(x));return out;}const x=plain(input);x.id=x.id||`${name}-${++seq}`;x.createdAt=x.createdAt||new Date(seq).toISOString();x.updatedAt=x.updatedAt||x.createdAt;
 const at=rows().findIndex(r=>r.id===x.id);if(at<0)rows().push(x);else rows()[at]={...rows()[at],...x};return hydrate(rows().find(r=>r.id===x.id));},
 update:async(w,p)=>{let n=0;for(const r of rows())if(match(r,w)){Object.assign(r,plain(p));n++;}return{affected:n}}};repo.manager=manager;return repo;
 };
 const manager={getRepository,transaction:async(...args)=>{const snapshot=plain(state);try{return await args[args.length-1](manager)}catch(e){state=snapshot;throw e}}};
 return {manager,getRepository,calls,get state(){return state},add(n,x){(state[n]||(state[n]=[])).push(plain(x));return x;},rows:n=>state[n]||[]};
}
function fixture(count=0,stage='EMPTY',status='new',part='RING'){
 const db=memory();
 for(const code of ['EMPTY','GRINDING','WAITING_FOR_GRINDING','READY_FOR_COATING','AT_COATER','READY_FOR_CUTTER'])db.add('TrayStageOrmEntity',{id:code,code,name:code,enabled:true});
 db.add('PartSummaryOrmEntity',{id:'s',number:'1.955FC',enabled:true});db.add('PartSummaryOrmEntity',{id:'s2',number:'OTHER',enabled:true});
 db.add('CutterPartTypeOrmEntity',{id:'p',code:part,enabled:true});db.add('CutterBladeRequirementOrmEntity',{id:'req',summary_id:'s',part_type_id:'p',required_blade_count:17,enabled:true});db.add('CutterBladeRequirementOrmEntity',{id:'req2',summary_id:'s2',part_type_id:'p',required_blade_count:9,enabled:true});
 db.add('TrayOrmEntity',{id:'t',serial_number:'T0001',enabled:true,blade_count:count,summary_id:count?'s':null,part_type_id:count?'p':null,current_stage_id:stage,grinding_completed_at:stage==='READY_FOR_COATING'?'2026-09-20T12:00:00Z':null,required_blade_count:stage==='READY_FOR_COATING'?17:null});
 db.add('ContainerOrmEntity',{id:'c',serial_number:'C0001',enabled:true});
 for(const prefix of ['CGDR','CGDP','CGFR','CGFP'])db.add('LocationOrmEntity',{id:prefix,serial_number:prefix+'-007',number:'007',enabled:true,department:'CUTTERGRIND',location_type:'SHELF'});
 for(let i=0;i<count;i++){db.add('BladeOrmEntity',{id:'b'+i,serial_number:'B'+i,status,summary_id:'s',part_type_id:'p',enabled:true,service_cycle:0});db.add('BladeTrayOrmEntity',{id:'a'+i,blade_id:'b'+i,tray_id:'t',enabled:true,createdAt:new Date(i).toISOString()});}
 const r=n=>db.getRepository(n);
 db.batch=new Batch(r('BladeTrayOrmEntity'));db.trays=new Trays(r('TrayOrmEntity'),r('BladeTrayOrmEntity'),r('CutterBladeRequirementOrmEntity'),r('PartSummaryOrmEntity'),r('CutterPartTypeOrmEntity'));db.coater=new Coater(r('ContainerTrayOrmEntity'));db.movement=new Movement(r('LocationTrayOrmEntity'));db.containers=new Containers(r('ContainerOrmEntity'));db.cutter=new Cutter(db.manager);
 db.dto=(qty,status='new',summary='s')=>({tray_id:'t',summary_id:summary,part_type_id:'p',quantity:qty,status});
 db.scan=()=>db.trays.getTrayBySerialNumber('t0001');return db;
}
async function rejectUnchanged(db,fn,pattern){const before=plain(db.state);await assert.rejects(fn,pattern);assert.deepEqual(plain(db.state),before,'Transaction changed state after rejecting');}
function one(obs){let value,error;obs.subscribe({next:v=>value=v,error:e=>error=e});if(error)throw error;return value;}
// Core batch and disposition sequences.
test('first batch enters GRINDING, never automatically coating-ready',async()=>{const d=fixture();const r=await d.batch.createBladeBatch(d.dto(12),'user');assert.equal(r.tray_blade_count,12);const t=await d.scan();assert.equal(t.pending_grinding_count,12);assert.equal(t.current_stage.code,'GRINDING');assert.equal(t.workflow_eligibility.coater_load,false);assert.equal(d.rows('TrayGrindingRunOrmEntity').length,0)});
test('second batch before completion stays in the same pending pass',async()=>{const d=fixture();await d.batch.createBladeBatch(d.dto(12),'u');await d.batch.createBladeBatch(d.dto(5),'u');const r=await d.trays.completeGrinding('t','s','p',0,'u');assert.equal(r.starting_blade_count,17);assert.equal(r.active_blade_count,17);assert.equal(r.complete,true);assert.equal(d.rows('TrayGrindingRunOrmEntity').length,1)});
test('second batch after completion reopens disposition and keeps previous run immutable',async()=>{const d=fixture();await d.batch.createBladeBatch(d.dto(12),'u');await d.trays.completeGrinding('t','s','p',0,'u');const old=plain(d.rows('TrayGrindingRunOrmEntity')[0]);await d.batch.createBladeBatch(d.dto(5),'u');let t=await d.scan();assert.equal(t.grinding_completed_at,null);assert.equal(t.current_stage.code,'GRINDING');assert.equal(t.pending_grinding_count,5);assert.equal(t.blades.filter(b=>b.status==='ready_for_coating').length,12);assert.equal(t.workflow_eligibility.coater_load,false);const r=await d.trays.completeGrinding('t','s','p',0,'u');assert.equal(r.starting_blade_count,5);assert.equal(r.returned_blade_count,5);assert.equal(r.active_blade_count,17);assert.deepEqual(d.rows('TrayGrindingRunOrmEntity')[0],old);assert.equal(d.rows('TrayGrindingRunOrmEntity').length,2);assert.equal((await d.scan()).workflow_eligibility.coater_load,true)});
test('second pass scraps only new blades; prior ready blades and histories remain intact',async()=>{const d=fixture(12,'GRINDING');await d.trays.completeGrinding('t','s','p',0,'u');const firstIds=d.rows('BladeOrmEntity').map(b=>b.id);await d.batch.createBladeBatch(d.dto(5,'grinding'),'u');const r=await d.trays.completeGrinding('t','s','p',2,'u');assert.equal(r.returned_blade_count,3);assert.equal(r.active_blade_count,15);assert.equal(r.complete,false);assert.ok(firstIds.every(id=>d.rows('BladeOrmEntity').find(b=>b.id===id).status==='ready_for_coating'));await d.batch.createBladeBatch(d.dto(2),'u');assert.equal((await d.trays.completeGrinding('t','s','p',0,'u')).complete,true);assert.equal(d.rows('TrayGrindingRunOrmEntity').length,3)});
test('all-scrapped tray can start a new Summary batch without erasing old history',async()=>{const d=fixture(4,'GRINDING');await d.trays.completeGrinding('t','s','p',4,'u');const old=plain(d.rows('TrayGrindingRunOrmEntity'));await d.batch.createBladeBatch(d.dto(2,'new','s2'),'u');const t=await d.scan();assert.equal(t.summary_id,'s2');assert.equal(t.required_blade_count,null);assert.deepEqual(d.rows('TrayGrindingRunOrmEntity'),old)});
for(const quantity of [0,-1,1.5,501,NaN])test('invalid batch quantity rejected without writes: '+quantity,async()=>{const d=fixture();await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(quantity),'u'),/quantity/)});
for(const status of ['ready_for_coating','at_coater','returned_from_coating','scrapped'])test('batch rejects workflow-skipping status '+status,async()=>{const d=fixture();await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(2,status),'u'),/NEW or GRINDING/)});
for(const n of ['ContainerTrayOrmEntity','CutterBuildTrayOrmEntity'])test('batch rejects active '+n,async()=>{const d=fixture();d.add(n,{id:'busy',tray_id:'t',container_id:'c',enabled:true});await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(2),'u'),/cannot be changed/)});
for(const stage of ['READY_FOR_CUTTER','AT_COATER','WAITING_FOR_GRINDING'])test('batch cannot skip stage '+stage,async()=>{const d=fixture(1,stage,'new');await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(1),'u'),/not available for intake/)});
test('post-grind capacity remains enforced after reopening',async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');await d.batch.createBladeBatch(d.dto(3),'u');await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(3),'u'),/cannot exceed/)});
test('batch count drift rejects instead of silently repairing inventory',async()=>{const d=fixture(2,'GRINDING');d.rows('TrayOrmEntity')[0].blade_count=3;await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(1),'u'),/count differs/)});
for(const scrap of [-1,0.5,6])test('disposition rejects invalid scrap '+scrap,async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');await d.batch.createBladeBatch(d.dto(5),'u');await rejectUnchanged(d,()=>d.trays.completeGrinding('t','s','p',scrap,'u'),/Scrap|Scrapped/)});
test('duplicate grinding completion does not create a second history row',async()=>{const d=fixture(4,'GRINDING');await d.trays.completeGrinding('t','s','p',0,'u');await rejectUnchanged(d,()=>d.trays.completeGrinding('t','s','p',0,'u'),/already been completed/)});
test('completed pass snapshot requirement survives later requirement configuration edit',async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');d.rows('CutterBladeRequirementOrmEntity')[0].required_blade_count=19;await d.batch.createBladeBatch(d.dto(5),'u');assert.equal((await d.trays.completeGrinding('t','s','p',0,'u')).required_blade_count,17)});
test('waiting tray must explicitly start grinding; new cycle flags are cleared',async()=>{const d=fixture(5,'WAITING_FOR_GRINDING','waiting_for_grinding');await d.trays.startGrinding('t','u');const t=await d.scan();assert.equal(t.current_stage.code,'GRINDING');assert.equal(t.pending_grinding_count,5);assert.equal(t.required_blade_count,null);assert.ok(t.blades.every(b=>b.status==='resharpening'));assert.ok(d.calls.some(c=>c.method==='findOne'&&c.opts.lock?.mode==='pessimistic_write'&&!c.opts.relations))});
// Full ready->coater->numbered finished shelf transition.
for(const part of ['RING','PINION'])test('load and receive '+part+' at a numbered finished shelf',async()=>{const d=fixture(17,'READY_FOR_COATING','ready_for_coating',part);await d.coater.createContainerTray({container_id:'c',tray_id:'t'},'u');assert.equal((await d.scan()).current_stage.code,'AT_COATER');const c=await d.containers.getContainerBySerialNumber('c0001');assert.equal(c.workflow_eligibility.load,false);assert.equal(c.workflow_eligibility.receive,true);await d.coater.unloadTrayFromContainer('c','t',(part==='RING'?'CGFR':'CGFP')+'-007','u');const t=await d.scan();assert.equal(t.current_stage.code,'READY_FOR_CUTTER');assert.ok(t.blades.every(b=>b.status==='returned_from_coating'));assert.equal(t.current_location.serial_number,(part==='RING'?'CGFR':'CGFP')+'-007');assert.equal(t.current_container,null);assert.equal((await d.containers.getContainerBySerialNumber('C0001')).workflow_eligibility.receive,false)});
for(const serial of ['CGFP-007','CGDR-007','CGFR-1.955FC'])test('receive rejects wrong/legacy shelf '+serial,async()=>{const d=fixture(17,'READY_FOR_COATING','ready_for_coating');await d.coater.createContainerTray({container_id:'c',tray_id:'t'},'u');await rejectUnchanged(d,()=>d.coater.unloadTrayFromContainer('c','t',serial,'u'),/numbered/) });
test('disabled target container cannot be loaded',async()=>{const d=fixture(17,'READY_FOR_COATING','ready_for_coating');d.rows('ContainerOrmEntity')[0].enabled=false;await rejectUnchanged(d,()=>d.coater.createContainerTray({container_id:'c',tray_id:'t'},'u'),/Container not found/)});
test('pending second-pass tray cannot be sent to coater',async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');await d.batch.createBladeBatch(d.dto(5),'u');await rejectUnchanged(d,()=>d.coater.createContainerTray({container_id:'c',tray_id:'t'},'u'),/post-grind/)});
test('move numbered dull shelf accepts different Summary number',async()=>{const d=fixture(4,'WAITING_FOR_GRINDING','waiting_for_grinding');await d.movement.createLocationTray({tray_id:'t',location_id:'CGDR'},'u');assert.equal((await d.scan()).current_location.serial_number,'CGDR-007')});
for(const target of ['CGFR','CGDP'])test('movement rejects stage/type mismatch '+target,async()=>{const d=fixture(4,'WAITING_FOR_GRINDING','waiting_for_grinding');await rejectUnchanged(d,()=>d.movement.createLocationTray({tray_id:'t',location_id:target},'u'),/requires tray stage|Part Type/) });
test('empty tray remains reusable, no fabricated physical shelf',async()=>{const d=fixture();await rejectUnchanged(d,()=>d.movement.createLocationTray({tray_id:'t',location_id:'CGDR'},'u'),/Empty trays/)});
test('cutter-assigned tray cannot move',async()=>{const d=fixture(2,'WAITING_FOR_GRINDING','waiting_for_grinding');d.add('CutterBuildTrayOrmEntity',{id:'link',tray_id:'t',cutter_build_id:'build',enabled:true});await rejectUnchanged(d,()=>d.movement.createLocationTray({tray_id:'t',location_id:'CGDR'},'u'),/cutter-assigned/)});
function teardownFixture(part='RING'){
 const d=fixture(0,'EMPTY','new',part);
 d.add('CutterBodyOrmEntity',{id:'body',dana_serial_number:'REAL-BODY',mf_serial_number:'REAL-MF'});
 d.add('CutterBuildStatusOrmEntity',{id:'pulled',code:'PULLED',enabled:true});d.add('CutterBuildStatusOrmEntity',{id:'closed',code:'CLOSED',enabled:true});d.add('CutterEventTypeOrmEntity',{id:'td',code:'TD',enabled:true});
 d.add('CutterBuildOrmEntity',{id:'build',build_number:'BUILD1',summary_id:'s',part_type_id:'p',status_id:'pulled',cutter_body_id:'body',completed_at:null,enabled:true});
 for(let i=0;i<4;i++){d.add('BladeOrmEntity',{id:'cb'+i,status:'in_cutter',summary_id:'s',part_type_id:'p',enabled:true,service_cycle:1});d.add('CutterBuildBladeOrmEntity',{id:'snap'+i,cutter_build_id:'build',blade_id:'cb'+i,position:i,enabled:true});}
 d.td=(scrap=1,serial=(part==='RING'?'CGDR':'CGDP')+'-007')=>({build_number:'BUILD1',teardown_tray_serial_number:'T0001',scrapped_blade_count:scrap,shelf_location_serial_number:serial});return d;
}
for(const part of ['RING','PINION'])test('teardown '+part+' -> numbered dull shelf -> next grinding pass',async()=>{const d=teardownFixture(part);const r=await d.cutter.teardownBuild(d.td(),'u');assert.equal(r.returned_blade_count,3);assert.equal((await d.scan()).current_stage.code,'WAITING_FOR_GRINDING');await d.trays.startGrinding('t','u');const g=await d.trays.completeGrinding('t','s','p',0,'u');assert.equal(g.starting_blade_count,3);assert.equal(g.returned_blade_count,3);assert.equal(d.rows('CutterBuildOrmEntity')[0].status.code,'CLOSED')});
test('all-scrapped teardown needs no shelf and releases an empty tray',async()=>{const d=teardownFixture();await d.cutter.teardownBuild(d.td(4,null),'u');assert.equal((await d.scan()).current_stage.code,'EMPTY');assert.equal(d.rows('LocationTrayOrmEntity').length,0)});
test('teardown rejects wrong numbered part-type shelf transactionally',async()=>{const d=teardownFixture();await rejectUnchanged(d,()=>d.cutter.teardownBuild(d.td(0,'CGDP-007'),'u'),/must be returned/) });
// Frontend observable tests: callbacks execute actual component methods, with HTTP doubles.
const pageRel=p=>`libs/frontend/feature-blade-tracking/src/lib/pages/${p}/${p}.component.ts`;
const Intake=load(pageRel('intake')).IntakeComponent;
const Load=load(pageRel('load-container')).LoadContainerComponent;
const Receive=load(pageRel('receive-container')).ReceiveContainerComponent;
const Move=load(pageRel('internal-movement')).InternalMovementComponent;
const Api=load('libs/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts').BladeTrackingApiService;
function front(Class,api={}){const notices=[];const defaults={getWorkflowTrays:()=>of([]),getWorkflowContainers:()=>of([])};injection={BladeTrackingApiService:{...defaults,...api},GearToastService:{success:(...a)=>notices.push(a),error:(...a)=>notices.push(a),info:(...a)=>notices.push(a)}};const instance=new Class();return{instance,notices,api:injection.BladeTrackingApiService}}
function uiTray(id='t',pending=3,old=0,stage='GRINDING'){return{id,serial_number:id==='t'?'T0001':'T0002',enabled:true,summary_id:'s',part_type_id:'p',blade_count:pending+old,grinding_completed_at:pending?null:'2026-09-20',required_blade_count:17,current_stage:{code:stage},blades:[...Array.from({length:pending},()=>({status:'new'})),...Array.from({length:old},()=>({status:'ready_for_coating'}))],workflow_eligibility:{intake:true,coater_load:false,internal_movement:true}}}
test('Intake re-reads tray and history after adding a second batch',()=>{const response=new Subject();let scans=0,runs=0;const f=front(Intake,{createBladeBatch:()=>response,scanTray:()=>{scans++;return of(uiTray('t',5,12))},getTrayGrindingRuns:()=>{runs++;return of([{id:'old',starting_blade_count:12}])}});const c=f.instance;c.tray=uiTray('t',0,12,'READY_FOR_COATING');c.summaryId='s';c.partTypeId='p';c.quantity=5;c.grindingRuns=[{id:'old'}];c.create();assert.equal(c.busy,true);response.next({quantity:5});response.complete();assert.equal(scans,1);assert.equal(runs,1);assert.equal(c.pendingGrindingCount,5);assert.equal(c.previouslyReadyCount,12);assert.equal(c.tray.grinding_completed_at,null);assert.equal(c.canRecordGrinding,true);assert.equal(c.grindingRuns[0].starting_blade_count,12)});
test('Intake prevents a duplicate Add click and a different tray selection during save',()=>{const response=new Subject();let writes=0,scans=0;const f=front(Intake,{createBladeBatch:()=>{writes++;return response},scanTray:()=>{scans++;return of(uiTray())},getTrayGrindingRuns:()=>of([])});const c=f.instance;c.tray=uiTray();c.summaryId='s';c.partTypeId='p';c.create();c.create();c.scanTray('T0002');assert.equal(writes,1);assert.equal(scans,0);response.next({quantity:1});assert.equal(c.tray.serial_number,'T0001')});
test('history read error keeps previous rows visible with explicit error/retry state',()=>{const f=front(Intake,{scanTray:()=>of(uiTray()),getTrayGrindingRuns:()=>throwError(()=>Error('history offline'))});const c=f.instance;c.tray=uiTray();c.selectedTraySerial='T0001';c.grindingRuns=[{id:'old'}];c.retryTray();assert.equal(c.grindingRuns.length,1);assert.match(c.historyError,/offline/);assert.equal(c.busy,false)});
test('saved batch refresh failure blocks another mutation instead of inventing counts',()=>{const f=front(Intake,{createBladeBatch:()=>of({quantity:1}),scanTray:()=>throwError(()=>Error('read offline'))});const c=f.instance;c.tray=uiTray();c.summaryId='s';c.partTypeId='p';c.create();assert.equal(c.refreshRequired,true);assert.equal(c.canAddBladeBatch,false);assert.equal(c.canRecordGrinding,false);assert.match(c.message.text,/offline/)});
test('component destruction ignores delayed scan/history response',()=>{const response=new Subject();const f=front(Intake,{scanTray:()=>response,getTrayGrindingRuns:()=>of([])});const c=f.instance;c.scanTray('T0001');c.ngOnDestroy();response.next(uiTray());assert.equal(c.tray,null)});
test('Intake exposes Start Grinding for waiting trays, not an invalid Complete call',()=>{let started=0,completed=0;const f=front(Intake,{startTrayGrinding:()=>{started++;return of({})},completeTrayGrinding:()=>{completed++;return of({})},scanTray:()=>of(uiTray()),getTrayGrindingRuns:()=>of([])});const c=f.instance;c.tray=uiTray('t',3,0,'WAITING_FOR_GRINDING');c.summaryId='s';c.partTypeId='p';assert.equal(c.canAddBladeBatch,false);c.completeGrinding();assert.equal(started,1);assert.equal(completed,0)});
test('scan and select both reject a loaded container for a new load session',()=>{let scans=0;const f=front(Load,{scanContainer:()=>{scans++;return of({workflow_eligibility:{load:false}})}});f.instance.scanContainer('C0001');assert.equal(f.instance.container,null);f.instance.chooseContainer('C0001');assert.equal(f.instance.container,null);assert.equal(scans,2)});
test('receive rejects empty container before loading an expected-tray list',()=>{let reads=0;const f=front(Receive,{scanContainer:()=>of({workflow_eligibility:{receive:false}}),getActiveContainerTrays:()=>{reads++;return of([])}});f.instance.chooseContainer('C0001');assert.equal(reads,0);assert.equal(f.instance.container,null)});
test('internal movement failed destination scan clears stale confirmed target',()=>{const f=front(Move,{scanLocation:()=>throwError(()=>Error('not found'))});const c=f.instance;c.tray=uiTray();c.destination={id:'old'};c.scanLocation('BAD');assert.equal(c.destination,null);assert.equal(c.busy,false)});
test('internal movement current-location labels use objects as serials, never [object Object]',()=>{const f=front(Move,{getWorkflowTrays:()=>of([{id:'t',current_location:{serial_number:'CGDR-007'}}])});assert.equal(f.instance.trayLocationLabels.t,'CGDR-007')});
// Actual API pagination logic runs against a synchronous HttpClient double.
test('workflow picker traverses all six pages and includes eligible rows beyond first 50',()=>{const pages=[];injection={HttpClient:{get:(_url,opts)=>{const p=opts.params.page;pages.push(p);return of({data:Array.from({length:50},(_,i)=>({id:String((p-1)*50+i),workflow_eligibility:{intake:true}})),meta:{page:p,hasNextPage:p<6}})}}};const api=new Api();const rows=one(api.getWorkflowTrays('intake'));assert.equal(rows.length,300);assert.deepEqual(pages,[1,2,3,4,5,6])});
test('picker fails visibly against an old server without eligibility metadata',()=>{injection={HttpClient:{get:()=>of({data:[{id:'a'}],meta:{page:1,hasNextPage:false}})}};const a=new Api();assert.throws(()=>one(a.getWorkflowTrays('intake')),/matching Blade Tracking server/)});
test('picker rejects non-advancing pagination instead of returning a partial list',()=>{injection={HttpClient:{get:()=>of({data:[],meta:{page:1,hasNextPage:true}})}};assert.throws(()=>one(new Api().getWorkflowTrays('intake')),/did not advance/)});
test('tray-details HTTP 500 is surfaced rather than showing false empty inventory',()=>{injection={HttpClient:{get:()=>throwError(()=>({status:500,message:'server unavailable'}))}};assert.throws(()=>one(new Api().getTrayDetails({id:'t'})),e=>e.status===500)});
test('lookup does not mask a server failure with a different inventory type',()=>{let n=0;injection={HttpClient:{get:()=>{n++;return throwError(()=>({status:500,message:'offline'}))}}};assert.throws(()=>one(new Api().lookup('T0001')),e=>e.status===500);assert.equal(n,1)});
test('lookup falls through genuine 404s and preserves the returned container kind',()=>{let n=0;injection={HttpClient:{get:()=>++n===1?throwError(()=>({status:404})):of({id:'c',serial_number:'C0001'})}};const r=one(new Api().lookup(' c0001 '));assert.equal(n,2);assert.equal(r.kind,'container')});
test('lookup stops on a container server error instead of calling location',()=>{let n=0;injection={HttpClient:{get:()=>throwError(()=>({status:++n===1?404:503}))}};assert.throws(()=>one(new Api().lookup('C0001')),e=>e.status===503);assert.equal(n,2)});
test('empty selected load container may be changed before first tray; loaded session cannot',()=>{let n=0;const f=front(Load,{scanContainer:s=>{n++;return of({id:s,serial_number:s,workflow_eligibility:{load:true}})}});f.instance.scanContainer('C0001');f.instance.scanContainer('C0002');assert.equal(f.instance.container.serial_number,'C0002');f.instance.trays=[{id:'t'}];f.instance.scanContainer('C0003');assert.equal(n,2);assert.equal(f.instance.container.serial_number,'C0002')});
for(const part of ['RING','PINION'])test('new completed tray '+part+' is excluded from Intake once full and available for coater',async()=>{const d=fixture(17,'GRINDING','new',part);await d.trays.completeGrinding('t','s','p',0,'u');const t=await d.scan();assert.equal(t.workflow_eligibility.intake,false);assert.equal(t.workflow_eligibility.coater_load,true)});
test('positive blade count in EMPTY stage is not allowed through direct batch API',async()=>{const d=fixture(3,'EMPTY','new');await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(1),'u'),/inconsistent/)});
test('ready stage without completed timestamp cannot bypass batch consistency guard',async()=>{const d=fixture(3,'READY_FOR_COATING','ready_for_coating');d.rows('TrayOrmEntity')[0].grinding_completed_at=null;await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(1),'u'),/inconsistent/)});
test('Intake green readiness follows server full-tray eligibility, not old timestamp',()=>{const c=front(Intake).instance;c.tray=uiTray('t',0,12,'READY_FOR_COATING');assert.equal(c.readyForCoating,false);assert.match(c.stageLabel,/5 NEEDED/);c.tray.workflow_eligibility.coater_load=true;c.tray.blade_count=17;assert.equal(c.readyForCoating,true);assert.equal(c.stageLabel,'READY FOR COATING')});
test('failed batch transaction creates no extra grinding history and leaves prior pass intact',async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');d.add('TrayGrindingRunOrmEntity',{id:'old',tray_id:'t',starting_blade_count:12,returned_blade_count:12});await rejectUnchanged(d,()=>d.batch.createBladeBatch(d.dto(6),'u'),/cannot exceed/);assert.equal(d.rows('TrayGrindingRunOrmEntity').length,1)});
test('second pass only records new blade status history',async()=>{const d=fixture(12,'READY_FOR_COATING','ready_for_coating');await d.batch.createBladeBatch(d.dto(5),'u');const before=d.rows('BladeHistoryOrmEntity').length;await d.trays.completeGrinding('t','s','p',1,'u');const events=d.rows('BladeHistoryOrmEntity').slice(before);assert.equal(events.length,5);assert.equal(events.some(e=>/^b\d+$/.test(e.blade_id)),false)});
test('coater receive rejects active assignment count drift rather than creating false shelf inventory',async()=>{const d=fixture(17,'READY_FOR_COATING','ready_for_coating');await d.coater.createContainerTray({tray_id:'t',container_id:'c'},'u');d.rows('TrayOrmEntity')[0].blade_count=18;await rejectUnchanged(d,()=>d.coater.unloadTrayFromContainer('c','t','CGFR-007','u'),/count/)});

test('generic quantity readiness remains complete after coating for Cutter Builder',async()=>{const d=fixture(17,'READY_FOR_COATING','ready_for_coating');assert.equal((await d.trays.getReadiness('t')).complete,true);await d.coater.createContainerTray({tray_id:'t',container_id:'c'},'u');assert.equal((await d.trays.getReadiness('t')).complete,true);await d.coater.unloadTrayFromContainer('c','t','CGFR-007','u');const r=await d.trays.getReadiness('t');assert.equal(r.complete,true);assert.equal(r.workflow_eligibility.coater_load,false);assert.equal((await d.scan()).current_stage.code,'READY_FOR_CUTTER')});
test('internal movement rejects mismatched active blade inventory',async()=>{const d=fixture(2,'WAITING_FOR_GRINDING','waiting_for_grinding');d.rows('TrayOrmEntity')[0].blade_count=3;await rejectUnchanged(d,()=>d.movement.createLocationTray({tray_id:'t',location_id:'CGDR'},'u'),/inconsistent/)});
test('internal movement rejects a numbered tag with wrong physical routing metadata',async()=>{const d=fixture(2,'WAITING_FOR_GRINDING','waiting_for_grinding');d.rows('LocationOrmEntity').find(x=>x.id==='CGDR').location_type='WORKCENTER';await rejectUnchanged(d,()=>d.movement.createLocationTray({tray_id:'t',location_id:'CGDR'},'u'),/metadata is inconsistent/)});
// Parse every supplied changed TS file, not just the modules executed above.
test('all patched TypeScript files parse',()=>{const dirs=['libs/server','libs/frontend','libs/shared/util-constants'];let n=0;function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.ts')){const sf=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);assert.equal(sf.parseDiagnostics.length,0,f);n++;}}}for(const d of dirs)walk(path.join(root,d));assert.ok(n>200)});
(async()=>{let passed=0;for(const t of tests){try{await t.f();passed++;console.log('[PASS] '+t.name)}catch(e){console.error('[FAIL] '+t.name+'\n'+e.stack);process.exitCode=1;break}}console.log(`R37 isolated workflow regression: ${passed}/${tests.length} PASS. No live database/browser was used.`);if(passed!==tests.length)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1});
