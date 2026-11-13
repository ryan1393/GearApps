const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const ts=require('node:module').createRequire(path.join(path.resolve(process.argv[2]||root),'package.json'))('typescript');
class HttpError extends Error{}
const decorate=()=>()=>{};
const common=new Proxy({
  BadRequestException:HttpError,
  ForbiddenException:HttpError,
  ServiceUnavailableException:HttpError,
},{get:(o,k)=>o[k]||decorate});
const cache=new Map();
function loadTypeScript(relative){
  const normalized=relative.replaceAll('\\','/');
  if(cache.has(normalized))return cache.get(normalized).exports;
  const file=path.join(root,normalized),source=fs.readFileSync(file,'utf8');
  const result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:false,importHelpers:false}});
  assert.equal((result.diagnostics||[]).filter(d=>d.category===1).length,0,`TypeScript diagnostics in ${normalized}`);
  const module={exports:{}};cache.set(normalized,module);
  const localRequire=id=>{
    if(id==='@nestjs/common')return common;
    if(id==='@nestjs/config'||id==='typeorm')return {};
    if(id==='@truck-log/server/auth/admin')return{TruckLogAdminWrites:decorate};
    // Nx source aliases are public library boundaries, not npm packages.
    // Resolve them to their real index.ts so the security test still executes
    // production code after a library extraction/refactor.
    if(id.startsWith('@truck-log/')){
      const api=path.join(root,'libs/truck-log',id.slice('@truck-log/'.length),'src/index.ts');
      if(fs.existsSync(api))return loadTypeScript(path.relative(root,api));
    }
    if(id.startsWith('.')){
      const base=path.resolve(path.dirname(file),id);
      for(const candidate of [`${base}.ts`,path.join(base,'index.ts')]){
        if(fs.existsSync(candidate))return loadTypeScript(path.relative(root,candidate));
      }
    }
    return require(id);
  };
  const context={exports:module.exports,module,require:localRequire,__filename:file,__dirname:path.dirname(file),Buffer,process,URL,setTimeout,clearTimeout,setInterval,clearInterval,console};
  vm.runInNewContext(result.outputText,context,{filename:file,timeout:5000});
  return module.exports;
}
const Service=loadTypeScript('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.service.ts').RxoExpediteService;
const Controller=loadTypeScript('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.controller.ts').RxoExpediteController;
const databaseStub={query:async()=>[{batches:null,shipments:null}]};
const make=env=>new Service({get:(k,d)=>Object.hasOwn(env,k)?env[k]:d},databaseStub);
const config={TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN:'https://trucklog.test'};
const cred={username:'dedicated-user',usernameConfigured:true,passwordConfigured:true,configured:true,password:'DO_NOT_RETURN',passwordHash:'DO_NOT_RETURN_EITHER'};
const raw={source:'RXO_EXPEDITE',credentials:cred,acquisition:{state:'SUCCESS',lastError:null,lastSuccess:{verified:true,completedAt:'2026-09-21T17:00:00Z',rowCount:11,sourceBatchId:'20260921T170000000Z-12345678-1234-4234-8234-123456789abc'}},password:'DO_NOT_RETURN'};
const tests=[];const test=(n,f)=>tests.push({n,f});
test('default write policy disabled',()=>assert.equal(make({}).controlPolicy().credentialUpdatesEnabled,false));
test('HTTP disallowed without explicit override',()=>assert.equal(make({TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN:'http://trucklog.test'}).controlPolicy().credentialUpdatesEnabled,false));
test('approved HTTPS origin exact',()=>assert.equal(make(config).controlPolicy().credentialUpdatesEnabled,true));
test('URL userinfo/path/trailing slash rejected',()=>{for(const v of ['https://x:y@host','https://host/','https://host/path','javascript:foo'])assert.equal(make({TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN:v}).controlPolicy().credentialUpdatesEnabled,false);});
test('HTTP opt-in produces explicit warning',()=>assert.equal(make({TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN:'http://trucklog.test',TRUCK_LOG_RXO_EXPEDITE_ALLOW_HTTP:'true'}).controlPolicy().transportWarning,true));
test('public status strips unexpected password/hash fields',async()=>{const s=make(config);s.helper=async()=>raw;const r=await s.status();assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));assert.equal(r.acquisition.shipmentCount,11);assert.equal(r.schedulingEnabled,false);assert.equal(r.databaseIngestionEnabled,false);});
test('diagnostic metadata exposes only fixed stage/cause and never native details',async()=>{const s=make(config);s.helper=async()=>({...raw,acquisition:{...raw.acquisition,state:'FAILED',lastError:'EXPEDITE_ACQUISITION_FAILED',completedAt:'2026-11-10T04:00:00Z',diagnostic:{stage:'EXPORT_DOWNLOAD',cause:'TIMEOUT',message:'password=DO_NOT_RETURN',url:'https://private.invalid/?token=DO_NOT_RETURN',stack:'DO_NOT_RETURN',credentialVersion:'DO_NOT_RETURN'}}});const r=await s.status();assert.equal(r.acquisition.diagnostic.stage,'EXPORT_DOWNLOAD');assert.equal(r.acquisition.diagnostic.cause,'TIMEOUT');assert.deepEqual(Object.keys(r.acquisition.diagnostic).sort(),['cause','stage']);assert.equal(r.acquisition.completedAt,'2026-11-10T04:00:00.000Z');assert.equal(r.acquisition.shipmentCount,11);assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));assert.ok(!JSON.stringify(r).includes('private.invalid'));});
test('invalid or legacy diagnostic values become null rather than copying raw data',async()=>{for(const diagnostic of [undefined,null,'DO_NOT_RETURN',[],{stage:'password=DO_NOT_RETURN',cause:'TIMEOUT'},{stage:'BROWSER_LAUNCH',cause:'DO_NOT_RETURN'},{stage:'BROWSER_LAUNCH',cause:'NETWORK_ERROR ',message:'DO_NOT_RETURN'}]){const s=make(config);s.helper=async()=>({...raw,acquisition:{...raw.acquisition,state:'FAILED',lastError:'EXPEDITE_ACQUISITION_FAILED',diagnostic}});const r=await s.status();assert.equal(r.acquisition.diagnostic,null);assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));}});
test('all worker diagnostic enums cross the actual service allowlist without drift',async()=>{const {ACQUISITION_STAGES,ACQUISITION_CAUSES}=await import('../../../apps/rxo-expedite/src/lib/acquisition.mjs');for(const stage of ACQUISITION_STAGES)for(const cause of ACQUISITION_CAUSES){const s=make(config);s.helper=async()=>({...raw,acquisition:{...raw.acquisition,state:'FAILED',diagnostic:{stage,cause}}});const r=await s.status();assert.equal(r.acquisition.diagnostic.stage,stage);assert.equal(r.acquisition.diagnostic.cause,cause);}});
test('invalid status cannot masquerade as healthy',async()=>{const s=make(config);s.helper=async()=>({...raw,acquisition:{state:'magically okay'}});await assert.rejects(s.status());});
test('state remains an independent error, not standard heartbeat',async()=>{const s=make(config);s.helper=async()=>({...raw,acquisition:{state:'REVIEW',lastError:'SCHEMA_DRIFT_REVIEW'}});const r=await s.status();assert.equal(r.acquisition.state,'REVIEW');assert.equal(r.acquisition.lastSuccessfulExport,null);});
test('raw native error is not returned as review text',async()=>{const s=make(config);s.helper=async()=>({...raw,acquisition:{state:'FAILED',lastError:'password=LEAK'}});assert.equal((await s.status()).acquisition.lastError,null);});
test('malformed credential status rejected',async()=>{const s=make(config);s.helper=async()=>({...raw,credentials:{...cred,configured:'true'}});await assert.rejects(s.status());});
test('wrong origin denied before Docker call',async()=>{const s=make(config);let calls=0;s.helper=async()=>{calls++;return cred;};await assert.rejects(s.updateCredentials({username:'u',password:'p'},'https://other.test','update-credentials'));assert.equal(calls,0);});
test('missing deliberate request header denied',async()=>{const s=make(config);s.helper=async()=>{throw Error('must not call');};await assert.rejects(s.updateCredentials({username:'u',password:'p'},'https://trucklog.test',null));});
test('input extra keys / malformed password / username rejected',async()=>{for(const input of [{username:'u',password:13},{username:'',password:'p'},{username:'u',password:'p\n'},{username:'u',password:'p',rxo_password:'x'}]){const s=make(config);let calls=0;s.helper=async()=>{calls++;};await assert.rejects(s.updateCredentials(input,'https://trucklog.test','update-credentials'));assert.equal(calls,0);}});
test('save returns allowlisted fields; no password/hash',async()=>{const s=make(config);s.helper=async(write,body)=>{assert.equal(write,true);assert.equal(body.username,'u');assert.equal(body.password,'DO_NOT_RETURN');return{...cred,passwordUpdated:true};};const r=await s.updateCredentials({username:' u ',password:'DO_NOT_RETURN'},'https://trucklog.test','update-credentials');assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));assert.equal(r.passwordUpdated,true);});
test('Docker helper secret sent via stdin only, independent image, no network',async()=>{const s=make(config),calls=[];s.native=async(args,input)=>{calls.push({args,input});return{ok:true,stdout:JSON.stringify(cred)};};await s.helper(true,{username:'u',password:'EXAMPLE_SECRET'});assert.ok(!JSON.stringify(calls[0].args).includes('EXAMPLE_SECRET'));assert.match(calls[0].input,/EXAMPLE_SECRET/);assert.ok(calls[0].args.includes('--network=none'));assert.ok(calls[0].args.includes('truck-log-rxo-expedite:1.0.9'));assert.ok(!calls[0].args.some(x=>x.includes('rxo-export')));assert.equal(calls[1].args[0],'rm');assert.ok(calls[1].args.at(-1).startsWith('truck-log-expedite-control-'));});
test('GET helper mounts both volumes read-only',async()=>{const s=make(config);let args;s.native=async a=>{if(a[0]==='run')args=a;return{ok:true,stdout:JSON.stringify(raw)};};await s.helper(false);assert.ok(args.includes('truck-log-rxo-credentials:/run/secrets:ro'));assert.ok(args.includes('truck-log-rxo-expedite-data:/app/data:ro'));});
test('failed native process response sanitized',async()=>{const s=make(config);s.native=async()=>({ok:false,stdout:'private-secret'});await assert.rejects(s.helper(true,{username:'u',password:'secret'}),e=>!e.message.includes('private-secret'));});
test('controller requires application/json',()=>{const c=new Controller({updateCredentials(){throw Error('must not call')}});assert.throws(()=>c.credentials({}, {is:()=>false,headers:{}}));});
const manual={id:'manual-12345678-1234-4234-8234-123456789abc',status:'QUEUED',requestedAt:'2026-11-10T17:00:00Z',startedAt:null,completedAt:null,error:null,sourceBatchId:null};
test('manual scan controller requires JSON before calling service',()=>{let calls=0;const c=new Controller({requestRescan(){calls++;return manual;}});assert.throws(()=>c.rescan({is:()=>false}));assert.equal(calls,0);assert.equal(c.rescan({is:()=>true}),manual);assert.equal(calls,1);});
test('manual scan queues only through dedicated networkless scheduler helper',async()=>{const s=make(config),calls=[];s.native=async(args,input)=>{calls.push({args,input});return{ok:true,stdout:JSON.stringify({source:'RXO_EXPEDITE',accepted:true,manualRun:{...manual,password:'DO_NOT_RETURN'}})};};const r=await s.requestRescan();assert.equal(r.id,manual.id);assert.equal(r.status,'QUEUED');assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));const args=calls[0].args;assert.ok(args.includes('--network=none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--request-scan'));assert.ok(args.includes('truck-log-rxo-credentials:/run/secrets:ro'));assert.ok(args.includes('truck-log-rxo-expedite-data:/app/data'));assert.ok(!args.includes('--once'));assert.ok(!args.some(a=>a.includes('rxo-export')));assert.equal(calls.at(-1).args[0],'rm');});
test('concurrent manual scan API callers share one durable request operation',async()=>{const s=make(config);let calls=0,finish;s.native=async args=>{if(args[0]==='rm')return{ok:true,stdout:''};calls++;await new Promise(resolve=>{finish=resolve;});return{ok:true,stdout:JSON.stringify({source:'RXO_EXPEDITE',accepted:true,manualRun:manual})};};const first=s.requestRescan(),second=s.requestRescan();assert.equal(first,second);finish();await Promise.all([first,second]);assert.equal(calls,1);});
test('manual scan refuses recovery already being queued without Docker work',()=>{const s=make(config);s.connectionRecovery.isRecovering=()=>true;s.native=async()=>{throw Error('must not call');};assert.throws(()=>s.requestRescan(),/recovery is already/);});
test('manual scan policy refusal is sanitized and does not claim an accepted export',async()=>{for(const code of ['SCHEDULER_BUSY','AUTH_REVIEW','RECOVERY_PENDING','COOLDOWN','RETRY_LIMIT','CREDENTIALS_MISSING','STATE_REVIEW','REQUEST_BUSY','SCHEDULER_UNAVAILABLE','password=DO_NOT_RETURN']){const s=make(config);s.native=async args=>({ok:true,stdout:JSON.stringify({source:'RXO_EXPEDITE',accepted:false,errorCode:code,password:'DO_NOT_RETURN'})});await assert.rejects(s.requestRescan(),e=>!e.message.includes('DO_NOT_RETURN'));}});
test('manual scan transport or malformed response never exposes native details',async()=>{for(const result of [{ok:false,stdout:'DO_NOT_RETURN'},{ok:true,stdout:'DO_NOT_RETURN'},{ok:true,stdout:JSON.stringify({source:'STANDARD',accepted:true,manualRun:manual})},{ok:true,stdout:JSON.stringify({source:'RXO_EXPEDITE',accepted:true,manualRun:null})}]){const s=make(config);s.native=async()=>result;await assert.rejects(s.requestRescan(),e=>!e.message.includes('DO_NOT_RETURN'));}});
test('manual run public status only publishes allowlisted fields',async()=>{const s=make(config);s.helper=async()=>({...raw,manualRun:{...manual,status:'FAILED',error:'password=DO_NOT_RETURN',password:'DO_NOT_RETURN',sourceBatchId:'DO_NOT_RETURN'}});const r=await s.status();assert.equal(r.manualRun.status,'FAILED');assert.equal(r.manualRun.error,null);assert.equal(r.manualRun.sourceBatchId,null);assert.equal(r.manualRun.requestedAt,'2026-11-10T17:00:00.000Z');assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));});
(async()=>{for(const {n,f}of tests){await f();console.log('[PASS] '+n);}console.log(`EXPEDITE API SECURITY: ${tests.length}/${tests.length} PASS; Docker, network and DB not executed.`);})();
