import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerClient, resolveContext } from './docker-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
try {
  const context=resolveContext(root), d=new DockerClient({context,root});
  const service=d.inspect('truck-log-rxo-export');
  if(!service?.State?.Running)throw new Error('RXO scheduler container is not running; no browser diagnostic can be collected.');
  const script=`const fs=require('fs'),crypto=require('crypto');
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const s=read('/app/data/scheduler-status.json'),h=read('/app/data/health.json');
const f='/app/src/rxo-fort-wayne-export.mjs';
console.log(JSON.stringify({exporterSha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),
filterReadinessSha256:crypto.createHash('sha256').update(fs.readFileSync('/app/src/lib/rxo-filter-readiness.mjs')).digest('hex'),
moduleSha256:Object.fromEntries(fs.readdirSync('/app/src/lib').filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync('/app/src/lib/'+n)).digest('hex')])),
playwrightVersion:require('playwright/package.json').version,
filterReadiness:read('/app/data/filter-readiness.json'),
scheduler:s?{currentPhase:s.currentPhase,currentTrigger:s.currentTrigger,heartbeat:s.schedulerHeartbeatAt,lastExitCode:s.lastExitCode,lastCompletedAt:s.lastCompletedAt}:null,
export:h?{status:h.status,lastSuccessAt:h.lastSuccessAt,lastBatchId:h.lastBatchId}:null},null,2));`;
  const evidence=d.json(['exec','truck-log-rxo-export','node','-e',script],{label:'Collect redacted RXO evidence'});
  const report={collectedAt:new Date().toISOString(),context,imageId:service.Image,
    state:service.State.Status,health:service.State.Health?.Status, ...evidence};
  const dir=path.join(root,'.new-host-state');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`rxo-diagnostics-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('[PASS] Diagnostic saved: '+file);
  console.log('[INFO] No credentials, cookies, input values, screenshots, raw HTML or raw container environment were collected.');
}catch(error){console.error('[FAIL] '+error.message);process.exitCode=1;}
