import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DockerClient, resolveContext, stopContainerVerified } from './docker-client.mjs';
import { resolveCompose } from './compose-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Host port of the loopback-only viewer: TRUCK_LOG_RXO_BROWSER_PORT from the
// environment or the workstation's .env (Compose reads the same value).
export function viewerPort(env=process.env,envFile=path.join(root,'.env')) {
  let raw=env.TRUCK_LOG_RXO_BROWSER_PORT;
  if(raw==null&&fs.existsSync(envFile)) {
    for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)) {
      const m=/^\s*TRUCK_LOG_RXO_BROWSER_PORT\s*=\s*"?([^"\s#]*)"?\s*(?:#.*)?$/.exec(line); if(m)raw=m[1];
    }
  }
  if(raw==null||raw==='')return 6080;
  const port=Number(raw);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('TRUCK_LOG_RXO_BROWSER_PORT must be a TCP port number.');
  return port;
}
export function tunnelArguments(endpoint,localPort,remotePort=6080) {
  if(!Number.isInteger(remotePort)||remotePort<1||remotePort>65535)throw new Error('Invalid RXO viewer port.');
  const u=new URL(endpoint);
  if(u.protocol!=='ssh:')throw new Error('Interactive remote login requires an SSH Docker context; no public browser port will be opened.');
  const host=u.hostname.replace(/^\[|\]$/g,''); const user=decodeURIComponent(u.username||'');
  if(!host||/[\s\x00-\x1f]/.test(host+user)||host.startsWith('-')||user.startsWith('-')||u.password)throw new Error('Unsafe SSH endpoint.');
  const args=['-N','-T','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
    '-L',`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`];
  if(u.port)args.push('-p',u.port);
  args.push(user?`${user}@${host}`:host);return args;
}
async function unusedPort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
function openBrowser(url){
  // URL is generated from a numeric loopback port; no user data reaches a shell.
  let p;if(process.platform==='win32')p=spawn('cmd.exe',['/d','/c','start','',url],{stdio:'ignore',windowsHide:true});
  else if(process.platform==='darwin')p=spawn('open',[url],{stdio:'ignore'});
  else p=spawn('xdg-open',[url],{stdio:'ignore'});
  p.on('error',()=>console.log('[ACTION] Open '+url));
}
// Shared lifecycle, exported for tests that supply in-memory clients only.
// Compose configuration validation happens before the scheduler can be paused.
export async function withBrowserSession(d, compose, env, task, stop = stopContainerVerified) {
  compose.run(['--profile','rxo-browser','config','--quiet'], {
    label: 'Validate RXO browser Compose profile', timeout: 30000, env,
  });
  const scheduler=d.inspect('truck-log-rxo-export');
  const wasRunning=Boolean(scheduler?.State?.Running||scheduler?.State?.Restarting);
  const active=c=>Boolean(c?.State?.Running||c?.State?.Restarting);
  const owners=()=>d.run(['ps','--filter','volume=truck-log-rxo-state','--format','{{.Names}}'], {
    label:'Check RXO browser profile ownership', timeout:30000,
  }).stdout.trim().split(/\r?\n/).filter(Boolean);
  if(active(d.inspect('truck-log-rxo-browser')))throw new Error('An RXO browser is already running. Close the other bootstrap session first.');
  const other=owners().filter(n=>n!=='truck-log-rxo-export');
  if(other.length)throw new Error('Another running container owns the browser profile: '+other.join(', ')+'. Scheduler was not paused.');
  let viewerAttempted=false, result, failure=null;
  const cleanupErrors=[];
  try {
    if(wasRunning)await stop(d,'truck-log-rxo-export');
    const remaining=owners();
    if(remaining.length)throw new Error('Browser profile is still in use: '+remaining.join(', ')+'. Refusing two Chromium writers.');
    console.log('[RUN] Building/starting ONLY the optional RXO interactive browser service.');
    viewerAttempted=true;
    compose.run(['--profile','rxo-browser','up','-d','--build','--no-deps','rxo-browser'], {
      label:'Start RXO viewer', timeout:1200000, visible:true, env,
    });
    result=await task();
  } catch(error) { failure=error; }
  finally {
    if(viewerAttempted) {
      try {
        compose.run(['--profile','rxo-browser','stop','rxo-browser'], {
          label:'Stop only RXO viewer', allowFailure:true, env,
        });
      } catch(error) { cleanupErrors.push('Viewer stop: '+error.message); }
    }
    // A command's exit code is not proof the remote viewer stopped after an SSH
    // reset. Require observed container/profile ownership before restoring RXO.
    let safe=false;
    try {
      const runningOwners=owners().filter(n=>n!=='truck-log-rxo-export');
      safe=!active(d.inspect('truck-log-rxo-browser'))&&runningOwners.length===0;
      if(!safe)cleanupErrors.push('Viewer/profile is still active. Scheduler NOT restarted to protect the shared profile.');
    } catch(error) { cleanupErrors.push('Cannot prove profile is released; scheduler NOT restarted: '+error.message); }
    if(wasRunning&&safe) {
      try {
        const now=d.inspect('truck-log-rxo-export');
        if(!now)throw new Error('Original RXO scheduler container is missing.');
        if(!active(now))d.run(['start','truck-log-rxo-export'],{label:'Restore RXO scheduler'});
      } catch(error) { cleanupErrors.push('Scheduler restore: '+error.message); }
    }
  }
  if(failure||cleanupErrors.length)throw new Error([failure?.message,...cleanupErrors].filter(Boolean).join('\n'));
  return result;
}

async function main(){
  if(process.argv.length>2)throw new Error('Run BOOTSTRAP-RXO-BROWSER.cmd without arguments.');
  const context=resolveContext(root);const d=new DockerClient({context,root});
  const endpoint=d.json(['context','inspect',context])[0]?.Endpoints?.docker?.Host;
  if(!endpoint)throw new Error('Missing Docker endpoint.');
  const local=/^(unix|npipe):/.test(endpoint);
  if(!local&&!endpoint.startsWith('ssh:'))throw new Error('Use an SSH context for encrypted interactive browser access.');
  const compose=resolveCompose(d);
  console.log(`[PASS] Compose frontend: ${compose.command} ${compose.version}; Docker context: ${context}`);
  const session=crypto.randomUUID();const env={...process.env,RXO_BOOTSTRAP_SESSION:session};
  let tunnel=null;let tunnelError=null;let cancelled=false;
  const cancel=()=>{cancelled=true;};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try{
    await withBrowserSession(d,compose,env,async()=>{
    const hostPort=viewerPort();
    let port=hostPort;
    if(!local){
      port=await unusedPort();console.log('[INFO] Opening an SSH tunnel; complete an SSH prompt if shown.');
      tunnel=spawn('ssh',tunnelArguments(endpoint,port,hostPort),{stdio:'inherit',windowsHide:false});
      tunnel.on('error',e=>{tunnelError=e;});tunnel.on('exit',code=>{if(code!==0)tunnelError=new Error('SSH tunnel ended.');});
    }
    const url=`http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=remote`;
    let ready=false;
    for(let i=0;i<90;i++){
      if(cancelled)throw new Error('Cancelled.');if(tunnelError)throw tunnelError;
      try{const r=await fetch(`http://127.0.0.1:${port}/vnc.html`,{signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break;}}catch{}
      await wait(1000);
    }
    if(!ready)throw new Error('The loopback RXO viewer did not become ready.');
    // The viewer requires a per-session VNC password generated inside the container.
    const secret=d.run(['exec','truck-log-rxo-browser','cat','/run/rxo-browser/vnc-password'],{allowFailure:true,timeout:15000,label:'Read viewer session password'});
    const vncPassword=secret.status===0?String(secret.stdout).trim():'';
    if(!/^[A-Za-z0-9]{8}$/.test(vncPassword))throw new Error('The RXO viewer did not publish its session password; refusing an unauthenticated viewer.');
    console.log('[ACTION] Complete RXO sign-in / MFA / account selection in '+url);
    console.log('[ACTION] Viewer password for this session only: '+vncPassword);openBrowser(url);
    const deadline=Date.now()+16*60*1000;let success=false;
    const readStatus="const f=require('fs');const p='/app/state/browser-bootstrap.json';process.stdout.write(f.existsSync(p)?f.readFileSync(p,'utf8'):'{}')";
    while(Date.now()<deadline){
      if(cancelled)throw new Error('Cancelled.');if(tunnelError)throw tunnelError;
      const r=d.run(['exec','truck-log-rxo-browser','node','-e',readStatus],{allowFailure:true,timeout:15000,label:'Read bootstrap status'});
      if(r.status===0){let state;try{state=JSON.parse(r.stdout);}catch{state={};}
        if(state.session===session){
          if(state.status==='READY'&&state.authenticated===true&&state.originFilterVisible&&state.destinationFilterVisible){success=true;break;}
          if(['FAILED','TIMEOUT'].includes(state.status))throw new Error('RXO interactive task did not reach both direction filters. Check the browser; no export is claimed.');
        }
      }
      await wait(2000);
    }
    if(!success)throw new Error('Interactive login timed out.');
    });
    console.log('[PASS] RXO SESSION BOOTSTRAP: profile saved, Origin/Destination available; viewer stopped and previous scheduler state restored.');
    console.log('[NEXT] Run Now in RXO Control Center. A completed six-file batch is still required to prove export success.');
  }finally{
    tunnel?.kill();
    process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){main().catch(error=>{console.error('[FAIL] '+error.message);console.error('[INFO] Truck Log server, web, PostgreSQL and source were not changed by this browser operation.');process.exitCode=1;});}
