'use strict';
// Native Windows service worker. No task-scheduler, INI, queue or driver writes.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const C=require('./core.cjs');const ROOT=__dirname,DATA=path.join(ROOT,'data'),HOST=path.join(ROOT,'TruckLogPrintAgent.exe');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function native(op,input=''){return execFileSync(HOST,[op],{input,encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:3*1024*1024,stdio:['pipe','pipe','pipe']});}
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
// Job state, result outbox and review journal are machine-DPAPI sealed: they hold job claim tokens.
function sealed(name){const f=path.join(DATA,name);return {load:()=>fs.existsSync(f)?JSON.parse(native('--unseal',fs.readFileSync(f,'utf8'))):null,save:v=>C.atomicWrite(f,native('--seal',JSON.stringify(v)))};}
const STATE=sealed('state.dpapi'),OUTBOX=sealed('outbox.dpapi'),JOURNAL=sealed('review-journal.dpapi');
const loadState=STATE.load,saveState=STATE.save;
function log(e){const f=path.join(DATA,'agent.log');if(fs.existsSync(f)&&fs.statSync(f).size>2*1024*1024){const old=f+'.old';if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(f,old);}fs.appendFileSync(f,new Date().toISOString()+' '+C.cleanError(e)+'\r\n');}
function verifyFiles(){const m=read(path.join(ROOT,'manifest.json'));for(const [f,h]of Object.entries(m.hashes)){C.must(/^[a-zA-Z0-9._-]+$/.test(f),'Unsafe manifest path.');C.must(C.sha(fs.readFileSync(path.join(ROOT,f)))===h,'Installed file hash mismatch: '+f);}}
function gates(config){return C.accessibleGates(config,JSON.parse(native('--probe',JSON.stringify(config.printers.map(({gate,printer})=>({gate,printer}))))));}
const downText=d=>d.gate+' printer not accessible to LocalSystem (Win32 '+d.win32Error+')';
// Strict form (setup test pages): both gates must be reachable.
function probe(config){const g=gates(config);C.must(!g.down.length,g.down.map(downText).join('; ')+'. The computer account needs Print access to the shared queue; no permission changes were made.');return g;}
function activationMatches(value,c){return value&&value.installId===c.installId&&value.eastConfirmed===true&&value.westConfirmed===true;}
async function main(){
 C.must(process.platform==='win32','Windows service only.');
 if(process.argv[2]==='--review'){
  native('--admin');const info=JSON.parse(native('--info'));C.must(!info||info.state==='Stopped','Stop TruckLogPrintAgent in Services before acknowledging an uncertain print.');
  const s=loadState(),held=s&&s.phase==='REVIEW'?s:null,journal=JOURNAL.load()||[],outbox=OUTBOX.load()||[];
  console.log('Print results awaiting server confirmation (kept and resent automatically): '+outbox.length);
  if(!held&&!journal.length){console.log('No uncertain job needs review.');return;}
  if(held){console.log(C.cleanError(held.message));if(held.job)console.log('Item '+held.job.itemId+' / printer '+held.job.printer);}
  for(const r of journal)console.log(String(r.at)+' '+C.cleanError(r.message)+(r.job?' [item '+r.job.itemId+' / printer '+r.job.printer+']':''));
  const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout});const v=await new Promise(r=>rl.question('Check physical output and Truck Log first. Type REVIEWED to clear these review records (never reprints; polling does not wait for this): ',r));rl.close();
  if(v==='REVIEWED'){C.atomicWrite(path.join(DATA,'review-'+Date.now()+'.dpapi'),native('--seal',JSON.stringify({state:held,journal})));if(held)saveState(null);JOURNAL.save([]);console.log('Review recorded. Start the service in Windows Services.');}return;
 }
 C.must(process.argv[2]==='--service'&&C.GUID.test(process.argv[3]),'Use Windows Services to start the agent.');
 const runId=process.argv[3],identity=JSON.parse(native('--identity'));
 C.must(identity.sid==='S-1-5-18'&&identity.machine.toUpperCase()==='USFTWLDAPP','Expected LocalSystem on USFTWLDAPP.');
 let launch;for(let i=0;i<100;i++){try{launch=read(path.join(DATA,'launch.json'));if(launch.runId===runId&&launch.workerPid===process.pid)break;}catch{}await sleep(100);}
 C.must(launch&&launch.runId===runId&&launch.workerPid===process.pid,'Native service handoff not confirmed.');
 verifyFiles();const config=C.validConfig(read(path.join(ROOT,'config.json')));
 const token=native('--unseal',fs.readFileSync(path.join(DATA,'credential.dpapi'),'utf8'));
 C.must(/^tlpa_[0-9a-f]{16}_[0-9a-f]{64}$/.test(token),'Stored credential is invalid.');const api=new C.Api(config.apiBase,token);
 let stop=false,lastError=null,beatAt=0,beatBody=null,busy=false,permission=false,lastAdvertised=false,lastGateError=null;
 const active=()=>{try{return activationMatches(read(path.join(DATA,'activation.json')),config);}catch{return false;}};
 const writeReady=state=>C.atomicWrite(path.join(DATA,'ready.json'),JSON.stringify({installId:config.installId,runId,workerPid:process.pid,servicePid:launch.servicePid,identitySid:identity.sid,hostName:identity.machine,state,printers:config.printers,serverReceivedAt:beatBody?.serverReceivedAt||null,permissionsVerified:permission}));
 const pollingAllowed=()=>{try{return read(path.join(DATA,'enable-polling.json')).installId===config.installId;}catch{return false;}};
 const outbox=new C.ResultOutbox({load:OUTBOX.load,save:OUTBOX.save}),journal=new C.ReviewJournal({load:JOURNAL.load,save:JOURNAL.save});
 const worker=new C.Worker({config,api,load:loadState,save:saveState,log,outbox,journal,
  // Checked BEFORE the durable print-intent marker: an unreachable printer/share is retried, never 'uncertain'.
  preflight:async j=>{const g=gates(config),d=g.down.find(p=>p.printer===j.printer);if(d)throw new C.NotPrinted(downText(d)+'.');C.must(g.ok.some(p=>p.printer===j.printer),'Job printer is not a configured gate.');},
  printer:async(bytes,j)=>{
   const file=path.join(DATA,'job-'+j.itemId+'-'+j.attemptNumber+'.pdf');
   try{try{fs.unlinkSync(file);}catch{}fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}catch(e){throw new C.NotPrinted('Could not stage the PDF for the renderer: '+C.cleanError(e));}
   try{const timeout=Math.min(60000,Date.parse(j.leaseExpiresAt)-Date.now()-10000);if(!(timeout>10000))throw new C.NotPrinted('Too little print lease time remains.');await C.printProcess(path.join(ROOT,'SumatraPDF.exe'),C.renderArgs(j.printer,file,DATA),timeout);}finally{try{fs.unlinkSync(file);}catch{}}
 }});
 const heartbeat=async()=>{
  if(busy||stop)return;busy=true;
  try{
   if(!permission){const p=await api.request('GET','/print-agents/setup-check');C.must(p.accepted===true&&p.permissionsVerified===true&&p.agentId===config.agentId,'Credential identity or required scopes were not confirmed.');permission=true;}
   const routing=await api.request('GET','/print-agents/gate-routing',null,null,{auth:false});
   C.must(C.mappingMatches(routing,config),'Saved gate mapping or server identity changed. New jobs are paused; no job is rerouted. Reconfigure and verify the service before using new printers.');
   // One unreachable gate must not stop the other: advertise only the gates LocalSystem can open now.
   const g=gates(config),activated=active(),advertise=activated?g.ok:[];
   const gateError=g.down.length?g.down.map(downText).join('; ')+'. Its jobs stay queued on the server until it is reachable again.':null;
   if(gateError!==lastGateError){log(gateError||'Both gate printers are reachable again.');lastGateError=gateError;}
   const r=await api.heartbeat(config,[worker.error(),gateError].filter(Boolean).join(' ')||undefined,advertise);
   C.must(r.accepted===true&&r.agentId===config.agentId&&Number.isFinite(Date.parse(r.serverReceivedAt)),'Exact service heartbeat was not accepted.');
   beatAt=Date.now();beatBody=r;lastAdvertised=advertise.length>0;lastError=null;if(activated)writeReady(g.down.length?'ACTIVE_DEGRADED':'ACTIVE');
  }catch(e){beatAt=0;lastAdvertised=false;lastError=C.cleanError(e);log(lastError);try{await api.heartbeat(config,lastError,false);}catch{};writeReady('WAITING');}
  finally{busy=false;}
 };
 const stopTimer=setInterval(()=>{try{if(fs.readFileSync(path.join(DATA,'stop.request'),'utf8')===runId)stop=true;}catch{}},500);
 process.on('SIGINT',()=>stop=true);process.on('SIGTERM',()=>stop=true);
 const timer=setInterval(heartbeat,10000);
 try{
  await heartbeat();while(!stop&&!beatAt)await sleep(500);if(stop)return;
  if(!active()){
   for(const p of config.printers){
    const intent=path.join(DATA,'test-'+p.gate+'-intent.json'),result=path.join(DATA,'test-'+p.gate+'-result.json');let prior;try{prior=read(result);}catch{}
    if(prior&&prior.installId===config.installId)continue;
    C.must(!fs.existsSync(intent),p.gate+' test outcome is uncertain after interruption. No automatic test reprint. Inspect the physical printer before rerunning setup.');
    probe(config);C.atomicWrite(intent,JSON.stringify({installId:config.installId,runId,printer:p.printer,startedAt:new Date().toISOString()}));
    log('Submitting ONE '+p.gate+' setup test from LocalSystem; no RXO jobs have been claimed.');
    await C.printProcess(path.join(ROOT,'SumatraPDF.exe'),C.renderArgs(p.printer,path.join(ROOT,'test-'+p.gate+'.pdf'),DATA),60000);
    C.atomicWrite(result,JSON.stringify({installId:config.installId,runId,printer:p.printer,submittedAt:new Date().toISOString()}));
   }
   writeReady('AWAITING_PHYSICAL_CONFIRMATION');
  }
  while(!stop){
   // Results are flushed and an acquired job is finished even while heartbeats fail; only NEW claims need
   // a fresh heartbeat with at least one reachable, advertised gate.
   if(active()&&pollingAllowed()){const fresh=beatAt>Date.now()-25000;try{await worker.tick({claim:fresh&&lastAdvertised,print:fresh,credentialOk:fresh});}catch(e){lastError=C.cleanError(e);log(e);}}
   await sleep(3000);
  }
 }finally{clearInterval(timer);clearInterval(stopTimer);log('Worker stopped; encrypted print journal retained.');}
}
if(require.main===module)main().catch(e=>{try{log(e);C.atomicWrite(path.join(DATA,'failure.json'),JSON.stringify({error:C.cleanError(e),at:new Date().toISOString()}));}catch{}process.exitCode=1;setTimeout(()=>process.exit(1),100);});
module.exports={main,activationMatches};
