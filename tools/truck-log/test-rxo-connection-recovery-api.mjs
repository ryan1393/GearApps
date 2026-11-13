// Behavioral checks against the real public recovery API and fixed helper program.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url), root=process.cwd(), modules=new Map();
function load(relative,overrides={}) {
 const file=path.resolve(root,relative);if(modules.has(file)&&!Object.keys(overrides).length)return modules.get(file);
 const module={exports:{}};modules.set(file,module.exports);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 const local=name=>{
  if(name in overrides)return overrides[name];
  if(name==='@truck-log/server/infrastructure/rxo-recovery')return load('libs/truck-log/server/infrastructure/rxo-recovery/src/index.ts');
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name)+'.ts');
  return require(name);
 };
 vm.runInNewContext(code,{module,exports:module.exports,require:local,process,Buffer,URL,setTimeout,clearTimeout,setInterval,clearInterval,console},{filename:file});
 return module.exports;
}
const lib='libs/truck-log/server/infrastructure/rxo-recovery/src/';
const {RxoRecoveryRuntime,RxoConnectionRecoveryService}=load(lib+'index.ts');
const {RECOVERY_HELPER}=load(lib+'lib/recovery-helper.ts');
const {TruckLogAdminWriteGuard}=load('libs/truck-log/server/auth/admin/src/lib/admin-auth.module.ts',{'./admin-auth.service':{TruckLogAdminService:class{}}});
const config={get:(key,fallback)=>({TRUCK_LOG_RELEASE:'1.0.3'}[key]??fallback)};
let checks=0;
async function test(name,fn){await fn();checks++;console.log('[PASS] '+name);}
const now=()=>new Date().toISOString(), future=()=>new Date(Date.now()+120000).toISOString();
function fixture(role='standard',options={}){
 const calls=[],id='a'.repeat(64),release='1.0.3',service=role==='standard'?'rxo-export':'rxo-expedite-scheduler', image=`truck-log-${role==='standard'?'rxo-export':'rxo-expedite'}:${release}`;
 const component=role==='standard'?'rxo-export':'rxo-expedite',data=role==='standard'?'truck-log-rxo-data':'truck-log-rxo-expedite-data';
 const target={Id:id,Image:'sha256:'+ 'b'.repeat(64),Config:{Image:image,Labels:{'com.docker.compose.project':'truck-log','com.docker.compose.service':service,'com.docker.compose.oneoff':'False','com.dana.truck-log.release':release}},State:{Running:options.running!==false,Status:options.running===false?'exited':'running'},Mounts:[{Type:'volume',Name:data,Destination:'/app/data',RW:true},{Type:'volume',Name:'truck-log-rxo-credentials',Destination:'/run/secrets',RW:false}]};
 if(options.changeTarget)options.changeTarget(target);
 let queued=false,statusReads=0;
 const native=async args=>{
  calls.push(args);
  if(args[0]==='ps')return {ok:true,stdout:options.duplicate?id+'\n'+'c'.repeat(64):id};
  if(args[0]==='inspect')return {ok:true,stdout:JSON.stringify(target)};
  if(args[0]==='image')return {ok:true,stdout:JSON.stringify({Id:target.Image,Config:{Labels:{'com.dana.truck-log.release':release,'com.dana.truck-log.component':component}}})};
  if(args[0]==='volume')return {ok:true,stdout:JSON.stringify({Name:args.at(-1)})};
  if(args[0]==='run'){
   const operation=args.at(-1);assert.equal(args.at(-2),role);
   if(options.helperDelayMs)await new Promise(resolve=>setTimeout(resolve,options.helperDelayMs));
   if(operation==='request'||operation==='acknowledge')queued=true;else statusReads++;
   const state=options.starting?'STARTING':options.active?'EXPORTING':options.becomesActive&&queued?'EXPORTING':'WAITING';
   const scheduler=options.stale?{state,heartbeatAt:'2000-01-01T00:00:00Z',deadlineAt:'2000-01-01T00:00:00Z'}:{state,heartbeatAt:now(),deadlineAt:future()};
   const deniedReason=options.deniedReason||'INTERACTIVE_LOGIN_REQUIRED';
   const recovery=operation==='acknowledge'?{requested:true,holdCleared:true,requestedAt:now(),message:'SECRET raw helper text'}:operation==='request'?{requested:!options.denied,requestedAt:now(),reason:options.denied?'COOLDOWN':null,message:'SECRET raw helper text'}:{available:!options.denied,reason:options.denied?deniedReason:null,requiresInteractiveLogin:!!options.denied&&deniedReason==='INTERACTIVE_LOGIN_REQUIRED',requiresCredentials:deniedReason==='CREDENTIALS_UNCHANGED',message:'SECRET raw helper text'};
   return {ok:!options.helperFail,stdout:JSON.stringify({role,recovery,scheduler})};
  }
  if(['start','restart'].includes(args[0])){assert(queued||options.restartOnly,'durable queue must precede lifecycle');return {ok:!options.lifecycleFail,stdout:id};}
  return {ok:true,stdout:''};
 };
 const runtime=new RxoRecoveryRuntime(config,native),serviceObject=new RxoConnectionRecoveryService(config);serviceObject.runtime=runtime;
 return {calls,runtime,service:serviceObject,target};
}
for(const role of ['standard','expedite']){
 await test(role+' status uses hardened read-only helper and caches concurrent polling',async()=>{
  const f=fixture(role);const [a,b]=await Promise.all([f.service.status(role),f.service.status(role)]);assert.equal(a.available,true);assert.equal(a.message,b.message);assert(!JSON.stringify(a).includes('SECRET'));
  await f.service.status(role);const helpers=f.calls.filter(x=>x[0]==='run');assert.equal(helpers.length,1);const args=helpers[0];
  for(const flag of ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=128m','--cpus=0.5'])assert(args.includes(flag));
  assert(args.includes('sha256:'+'b'.repeat(64)), 'helper uses validated immutable image ID');assert(!args.some(x=>x.startsWith('truck-log-rxo-export:')||x.startsWith('truck-log-rxo-expedite:')));
  assert(args.some(x=>x.includes('target=/app/data,readonly')));assert(args.some(x=>x.includes('target=/run/secrets,readonly')));assert(f.calls.some(x=>x[0]==='rm'));
 });
 await test(role+' stopped worker queues durably before start and deduplicates clicks',async()=>{
  const f=fixture(role,{running:false});const one=f.service.recover(role),two=f.service.recover(role);assert.equal(one,two);assert(f.service.isRecovering(role));
  const result=await one;assert.equal(result.status,'QUEUED');assert(!f.service.isRecovering(role));assert.equal(f.calls.filter(x=>x[0]==='start').length,1);assert.equal(f.calls.filter(x=>x[0]==='run'&&x.at(-1)==='request').length,1);
  const request=f.calls.find(x=>x[0]==='run'&&x.at(-1)==='request');assert(request.some(x=>/target=\/app\/data$/.test(x)));assert(request.some(x=>x.includes('target=/run/secrets,readonly')));
 });
 await test(role+' healthy active export is neither queued nor interrupted',async()=>{
  const f=fixture(role,{active:true});assert.equal((await f.service.recover(role)).status,'ALREADY_RUNNING');assert(!f.calls.some(x=>['start','restart'].includes(x[0])||(x[0]==='run'&&x.at(-1)==='request')));
 });
 await test(role+' fresh startup is preserved without a second recovery attempt',async()=>{
  const f=fixture(role,{starting:true});assert.equal((await f.service.recover(role)).status,'ALREADY_RUNNING');assert(!f.calls.some(x=>['start','restart'].includes(x[0])||(x[0]==='run'&&x.at(-1)==='request')));
 });
 await test(role+' stale running worker restarts only after durable request',async()=>{
  const f=fixture(role,{stale:true});assert.equal((await f.service.recover(role)).status,'QUEUED');assert.equal(f.calls.filter(x=>x[0]==='restart').length,1);
 });
 await test(role+' healthy worker becoming active after queue is preserved',async()=>{
  const f=fixture(role,{becomesActive:true});assert.equal((await f.service.recover(role)).status,'QUEUED');assert(!f.calls.some(x=>['start','restart'].includes(x[0])));
 });
 await test(role+' interactive denial preserves flags and sanitizes helper text',async()=>{
  const f=fixture(role,{denied:true});await assert.rejects(f.service.recover(role),error=>error.getStatus()===409&&error.getResponse().requiresInteractiveLogin===true&&!JSON.stringify(error.getResponse()).includes('SECRET'));
  assert(!f.calls.some(x=>['start','restart'].includes(x[0])));
 });
}
for(const [name,change] of [
 ['wrong project',v=>v.Config.Labels['com.docker.compose.project']='other'],['wrong service',v=>v.Config.Labels['com.docker.compose.service']='rxo-browser'],
 ['one-off',v=>v.Config.Labels['com.docker.compose.oneoff']='True'],['old release',v=>v.Config.Labels['com.dana.truck-log.release']='1.0.1'],
 ['wrong image',v=>v.Config.Image='malicious:latest'],['writable credentials',v=>v.Mounts[1].RW=true],['wrong data volume',v=>v.Mounts[0].Name='other'],
 ])await test('reject '+name+' before any helper or lifecycle mutation',async()=>{
  const f=fixture('standard',{changeTarget:change});assert.equal((await f.service.status('standard')).available,false);await assert.rejects(f.service.recover('standard'));assert(!f.calls.some(x=>['run','start','restart'].includes(x[0])));
 });
await test('a slow Docker host answers CHECKING at first, then the real state, never "worker unavailable"',async()=>{
 const f=fixture('expedite',{helperDelayMs:4200});const started=Date.now();
 const first=await f.service.status('expedite');assert.equal(first.reason,'CHECKING');assert(Date.now()-started<4100,'the first status request does not wait for the slow check');
 await new Promise(resolve=>setTimeout(resolve,1200));
 const later=await f.service.status('expedite');assert.equal(later.available,true);assert.notEqual(later.reason,'WORKER_UNAVAILABLE');
});
for(const [name,options,pattern] of [
 ['missing worker',{changeTarget:v=>v.Config.Labels['com.docker.compose.service']='rxo-browser'},/was not found/],
 ['duplicate worker',{duplicate:true},/More than one container/],
 ['older worker build',{changeTarget:v=>v.Config.Labels['com.dana.truck-log.release']='1.0.1'},/different Truck Log build/],
 ['wrong volumes',{changeTarget:v=>v.Mounts[0].Name='other'},/data and credential volumes/],
 ['failed helper',{helperFail:true},/did not finish/],
])await test('status names the worker problem: '+name,async()=>{
 const f=fixture('standard',options);const info=await f.service.status('standard');assert.equal(info.reason,'WORKER_UNAVAILABLE');assert.match(info.message,pattern);assert(!JSON.stringify(info).includes('SECRET'));
});
for(const role of ['standard','expedite']){
 await test(role+' Retry sign-in clears a review hold through the acknowledge helper and queues once',async()=>{
  const f=fixture(role,{denied:true});await assert.rejects(f.service.recover(role),e=>e.getStatus()===409);
  const result=await f.service.recover(role,{acknowledgeHold:true});assert.equal(result.status,'QUEUED');assert.match(result.message,/Sign-in hold cleared/);
  const helper=f.calls.find(x=>x[0]==='run'&&x.at(-1)==='acknowledge');assert(helper,'acknowledge helper ran');assert(helper.some(x=>/target=\/app\/data$/.test(x)),'data writable for acknowledgement');assert(helper.some(x=>x.includes('target=/run/secrets,readonly')));
  assert(!f.calls.some(x=>x[0]==='run'&&x.at(-1)==='request'));
 });
 await test(role+' Retry sign-in never clears rejected credentials',async()=>{
  const f=fixture(role,{denied:true,deniedReason:'CREDENTIALS_UNCHANGED'});
  await assert.rejects(f.service.recover(role,{acknowledgeHold:true}),e=>e.getStatus()===409&&e.getResponse().requiresCredentials===true);
  assert(!f.calls.some(x=>x[0]==='run'&&['acknowledge','request'].includes(x.at(-1))));assert(!f.calls.some(x=>['start','restart'].includes(x[0])));
 });
 await test(role+' Restart worker restarts only the verified worker, without helpers',async()=>{
  const f=fixture(role,{restartOnly:true});const result=await f.service.restartWorker(role);assert.equal(result.status,'RESTARTED');
  const restart=f.calls.filter(x=>x[0]==='restart');assert.equal(restart.length,1);assert.equal(restart[0].at(-1),'a'.repeat(64));assert(!f.calls.some(x=>x[0]==='run'));
 });
 await test(role+' Restart worker starts a stopped worker',async()=>{
  const f=fixture(role,{restartOnly:true,running:false});assert.equal((await f.service.restartWorker(role)).status,'STARTED');assert.equal(f.calls.filter(x=>x[0]==='start').length,1);
 });
}
await test('Restart worker refuses a worker that fails identity checks, with the reason',async()=>{
 const f=fixture('standard',{restartOnly:true,changeTarget:v=>v.Config.Image='malicious:latest'});
 await assert.rejects(f.service.restartWorker('standard'),e=>e.getStatus()===503&&/different Truck Log build/.test(e.getResponse().message));assert(!f.calls.some(x=>['start','restart','run'].includes(x[0])));
});
await test('Restart worker and recovery share one in-flight action per worker',async()=>{
 const f=fixture('standard',{restartOnly:true});const restart=f.service.restartWorker('standard');assert(f.service.isRecovering('standard'));assert.equal(f.service.recover('standard'),restart);await restart;
});
await test('ambiguous Compose identity fails closed',async()=>{const f=fixture('standard',{duplicate:true});await assert.rejects(f.service.recover('standard'));assert(!f.calls.some(x=>x[0]==='run'));});
await test('helper failure cleans up helper and exposes only a fixed safe error',async()=>{
 const f=fixture('standard',{helperFail:true});await assert.rejects(f.service.recover('standard'),e=>e.getStatus()===503&&!JSON.stringify(e.getResponse()).includes('SECRET'));assert(f.calls.some(x=>x[0]==='rm'));
});
await test('independent services never share lifecycle identities',async()=>{const a=fixture('standard',{running:false}),b=fixture('expedite',{running:false});await Promise.all([a.service.recover('standard'),b.service.recover('expedite')]);assert(a.calls.some(x=>x.includes('label=com.docker.compose.service=rxo-export')));assert(b.calls.some(x=>x.includes('label=com.docker.compose.service=rxo-expedite-scheduler')));});
await test('administrator guard refuses unauthorized recovery writes before handler',async()=>{
 let authorized=0;const guard=new TruckLogAdminWriteGuard({getAllAndOverride:()=>true},{safe:fn=>fn(),authorize:async()=>{authorized++;throw new Error('Unauthorized');}});
 const context={getType:()=> 'http',getHandler:()=>({name:'recover'}),getClass:()=>({name:'RxoControlController'}),switchToHttp:()=>({getRequest:()=>({method:'POST',headers:{}})})};await assert.rejects(guard.canActivate(context));assert.equal(authorized,1);
});
await test('standard scan reserves before Docker await and rejects concurrent recovery',async()=>{
 const {RxoControlService}=load('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.service.ts',{'./rxo-ingestion.service':{},'./rxo-control-runtime':{RxoControlRuntime:class{}},'./rxo-ingestion-paths':{RXO_BOUNDARY_FILE:'boundary.json'}});
 let unblock;const waiting=new Promise(resolve=>unblock=resolve),recovery={isRecovering:()=>false,recover:()=>{throw new Error('must not queue');}};
 const control=new RxoControlService(config,{},recovery);control.runtime={requireDocker:()=>waiting,findExporterContainer:async()=>null};
 const scan=control.requestRescan();const result=await control.recoverConnection();assert.equal(result.status,'ALREADY_RUNNING');await assert.rejects(control.requestRescan(),/already running/);unblock();await assert.rejects(scan,/unavailable/);
});
await test('status reads started before recovery cannot refill the cache with old availability',async()=>{
 const f=fixture('standard');let resolveOld,reads=0;
 const initial=new Promise(resolve=>resolveOld=resolve);
 const safe={available:true,reason:'READY',message:'old',requiresCredentials:false,requiresInteractiveLogin:false,cooldownUntil:null};
 f.service.readStatus=async()=>++reads===1?initial:{...safe,available:false,reason:'COOLDOWN',message:'new'};
 const old=f.service.status('standard');await f.service.recover('standard');
 const current=await f.service.status('standard');assert.equal(current.available,false);
 resolveOld(safe);await old;assert.equal((await f.service.status('standard')).available,false);assert.equal(reads,2);
});
await test('overall request deadline prevents later Docker commands',async()=>{
 let calls=0,seenTimeout;
 const native=async(args,timeout)=>{calls++;seenTimeout=timeout;await new Promise(resolve=>setTimeout(resolve,25));return {ok:true,stdout:'a'.repeat(64)};};
 const runtime=new RxoRecoveryRuntime(config,native).withDeadline(10);
 await assert.rejects(runtime.target('standard'));assert.equal(calls,1);assert(seenTimeout<=10);
});
await test('expired request budget starts no helper mutation and still attempts cleanup',async()=>{
 const calls=[];const runtime=new RxoRecoveryRuntime(config,async args=>{calls.push(args);return {ok:true,stdout:''};}).withDeadline(0);
 const target={role:'standard',imageId:'sha256:'+'b'.repeat(64),dataVolume:'fixture-data',credentialVolume:'fixture-creds'};
 await assert.rejects(runtime.observe(target,'request'));assert.equal(calls.length,1);assert.equal(calls[0][0],'rm');
});
await test('a failed lifecycle command reports that the durable request is still queued',async()=>{
 const f=fixture('standard',{running:false,lifecycleFail:true});await assert.rejects(f.service.recover('standard'),e=>e.getStatus()===503&&/queued/.test(e.getResponse().message));
});
await test('fixed helper executes in a real Node subprocess for both role files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rxo-helper-'));
 try{
  const auth=path.join(dir,'auth.mjs');fs.writeFileSync(auth,'export const connectionRecoveryStatus=(root,role)=>({available:true,reason:null,message:"RAW SECRET"});export const requestConnectionRecovery=(root,role)=>({requested:true,requestedAt:new Date().toISOString()});export const acknowledgeAuthHold=(root,role)=>({requested:true,holdCleared:true,requestedAt:new Date().toISOString()});');
  fs.writeFileSync(path.join(dir,'scheduler-status.json'),JSON.stringify({currentPhase:'WAITING',schedulerHeartbeatAt:now(),schedulerLoopDeadlineAt:future()}));
  fs.writeFileSync(path.join(dir,'expedite-scheduler-status.json'),JSON.stringify({schedulerState:'EXPORTING',schedulerHeartbeatAt:now(),schedulerLoopDeadlineAt:future()}));
  const program=RECOVERY_HELPER.replace("'/app/src/lib/rxo-auth.mjs'",JSON.stringify(pathToFileURL(auth).href)).replaceAll('/app/data',dir);
  for(const role of ['standard','expedite'])for(const operation of ['status','request','acknowledge']){
   const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,role,operation],{encoding:'utf8',timeout:5000,maxBuffer:65536}));
   assert.equal(result.role,role);assert.equal(result.scheduler.state,role==='standard'?'WAITING':'EXPORTING');assert.equal(result.recovery[operation==='status'?'available':'requested'],true);
   if(operation==='acknowledge')assert.equal(result.recovery.holdCleared,true);
  }
  // An unknown operation is refused before touching any state.
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',program,'standard','delete-everything'],{encoding:'utf8',timeout:5000,stdio:'pipe'}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
console.log(`RXO recovery API/lifecycle/security: ${checks} passed`);
