/** Optional thin Docker integration. Synthetic credentials, unique fixture resources, no RXO traffic. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import ts from 'typescript';
if(!process.argv.includes('--run')){console.log('[SKIP] Thin Docker integration is opt-in; pass --run on an isolated test daemon.');process.exit(0);}
const require=createRequire(import.meta.url),root=process.cwd(),cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),Buffer,process,URL,setTimeout,clearTimeout,console},{filename:file});return module.exports;}
const {RxoRecoveryRuntime}=load('libs/truck-log/server/infrastructure/rxo-recovery/src/lib/recovery-runtime.ts');
const {RxoConnectionRecoveryService}=load('libs/truck-log/server/infrastructure/rxo-recovery/src/lib/rxo-connection-recovery.service.ts');
const nonce=randomBytes(5).toString('hex'),release='1.0.3-recovery-test'+nonce,prefix='rxo-recovery-test-'+nonce,temp=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock'};for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,timeout=30000)=>execFileSync('docker',args,{encoding:'utf8',env,timeout,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const images=[],volumes=[],containers=[],calls=[];
const run=async(args,timeout)=>{calls.push(args);try{return {ok:true,stdout:docker(args,timeout||15000)};}catch{return {ok:false,stdout:''};}};
let checks=0;
try{
 docker(['info','--format','{{.ServerVersion}}'],5000);
 const base='node:24-alpine';docker(['image','inspect',base],5000);
 fs.copyFileSync('libs/truck-log/rxo-shared/rxo-auth.mjs',path.join(temp,'rxo-auth.mjs'));
 fs.copyFileSync('libs/truck-log/rxo-shared/process-lock.mjs',path.join(temp,'process-lock.mjs'));
 for(const role of ['standard','expedite']){
  const component=role==='standard'?'rxo-export':'rxo-expedite',image=`truck-log-${component}:${release}`,data=prefix+'-'+role+'-data',creds=prefix+'-'+role+'-creds';
  fs.writeFileSync(path.join(temp,'Dockerfile'),`FROM ${base}\nLABEL com.dana.truck-log.component="${component}" com.dana.truck-log.release="${release}"\nCOPY rxo-auth.mjs process-lock.mjs /app/src/lib/\nCMD ["node","-e","setInterval(()=>{},1000)"]\n`);
  docker(['build','--pull=false','-t',image,temp],60000);images.push(image);
  for(const volume of [data,creds]){docker(['volume','create',volume]);volumes.push(volume);}
  const seed=`const fs=require('fs');fs.writeFileSync('/run/secrets/rxo_username','fixture-user');fs.writeFileSync('/run/secrets/rxo_password','fixture-password-example');const g='11111111-1111-4111-8111-111111111111';fs.mkdirSync('/run/secrets/rxo_expedite_versions/'+g,{recursive:true});fs.writeFileSync('/run/secrets/rxo_expedite_current.json',JSON.stringify({contractVersion:1,generation:g}));fs.writeFileSync('/run/secrets/rxo_expedite_versions/'+g+'/rxo_expedite_username','fixture-user');fs.writeFileSync('/run/secrets/rxo_expedite_versions/'+g+'/rxo_expedite_password','fixture-password-example');fs.writeFileSync('/app/data/${role==='standard'?'scheduler-status.json':'expedite-scheduler-status.json'}',JSON.stringify({currentPhase:'WAITING',schedulerState:'WAITING',schedulerHeartbeatAt:new Date().toISOString(),schedulerLoopDeadlineAt:new Date(Date.now()+120000).toISOString()}));`;
  docker(['run','--rm','--pull=never','--network=none','--mount',`type=volume,source=${data},target=/app/data`,'--mount',`type=volume,source=${creds},target=/run/secrets`,image,'node','-e',seed]);
  const config={get:(k,d)=>({TRUCK_LOG_RELEASE:release,TRUCK_LOG_DOCKER_PROJECT:prefix,TRUCK_LOG_RXO_DOCKER_DATA_VOLUME:data,TRUCK_LOG_RXO_DOCKER_CREDENTIAL_VOLUME:creds}[k]??d)};
  const runtime=new RxoRecoveryRuntime(config,run),id=docker(['image','inspect','--format','{{.Id}}',image]);
  const target={id:'a'.repeat(64),role,image,imageId:id,dataVolume:data,credentialVolume:creds,running:false,restarting:false};
  const before=docker(['run','--rm','--network=none','--mount',`type=volume,source=${data},target=/app/data,readonly`,image,'node','-e',"console.log(JSON.stringify(require('fs').readdirSync('/app/data').sort()))"]);
  const status=await runtime.observe(target,'status');assert.equal(status.recovery.available,true);checks++;
  const after=docker(['run','--rm','--network=none','--mount',`type=volume,source=${data},target=/app/data,readonly`,image,'node','-e',"console.log(JSON.stringify(require('fs').readdirSync('/app/data').sort()))"]);assert.equal(after,before);checks++;
  const queued=await runtime.observe(target,'request');assert.equal(queued.requested,true);assert.equal((await runtime.observe(target,'status')).recovery.reason,'COOLDOWN');checks++;
  const persisted=JSON.parse(docker(['run','--rm','--network=none','--mount',`type=volume,source=${data},target=/app/data,readonly`,image,'node','-e',"console.log(require('fs').readFileSync('/app/data/rxo-connection-recovery.json','utf8'))"]));assert.equal(persisted.phase,'QUEUED');assert.equal(persisted.role,role);assert.equal(persisted.attempts.length,1);checks++;
  if(role==='standard'){
   // Clear only this fixture's queue to exercise the whole stopped-worker API path.
   docker(['run','--rm','--network=none','--mount',`type=volume,source=${data},target=/app/data`,image,'node','-e',"const fs=require('fs');for(const f of ['rxo-connection-recovery.json','rxo-auth-retry.json'])fs.unlinkSync('/app/data/'+f)"]);
   const name=prefix+'-worker';containers.push(name);
   const worker=docker(['create','--name',name,'--network=none','--label',`com.docker.compose.project=${prefix}`,'--label','com.docker.compose.service=rxo-export','--label','com.docker.compose.oneoff=False','--label',`com.dana.truck-log.release=${release}`,'--mount',`type=volume,source=${data},target=/app/data`,'--mount',`type=volume,source=${creds},target=/run/secrets,readonly`,image]);
   const service=new RxoConnectionRecoveryService(config);service.runtime=runtime;const recovered=await service.recover('standard');assert.equal(recovered.status,'QUEUED');assert.equal(docker(['inspect','--format','{{.State.Running}}',worker]),'true');checks++;
   const helperIndex=calls.findLastIndex(a=>a[0]==='run'&&a.at(-1)==='request'),startIndex=calls.findLastIndex(a=>a[0]==='start');assert(startIndex>helperIndex);checks++;
  }
  console.log(`[PASS] ${role}: actual network-none read-only status, durable request, cooldown and immutable helper image`);
 }
 const ownHelpers=calls.filter(a=>a[0]==='run'&&a.includes('--name')).map(a=>a[a.indexOf('--name')+1]);
 for(const helper of ownHelpers)assert.throws(()=>docker(['inspect','--type','container',helper],5000));checks++;
 console.log(`Thin Docker recovery fixture: ${checks} checks passed. No RXO login or production volumes used.`);
}finally{
 for(const name of containers)try{docker(['rm','-f',name],10000);}catch{}
 for(const name of volumes)try{docker(['volume','rm',name],10000);}catch{}
 for(const name of images)try{docker(['image','rm',name],10000);}catch{}
 fs.rmSync(temp,{recursive:true,force:true});
}
