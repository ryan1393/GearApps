/** tests: injected in-memory command runners ONLY. No Docker/SSH/network. */
import assert from 'node:assert/strict';
import { parseComposeVersion, resolveCompose } from '../../../../tools/truck-log/new-host/compose-client.mjs';
import { withBrowserSession } from '../../../../tools/truck-log/new-host/browser-bootstrap.mjs';

let passed=0;
async function test(name, fn) { await fn(); passed++; console.log('[PASS] '+name); }
const originalDockerContext=process.env.DOCKER_CONTEXT;
const response=(stdout='',status=0,stderr='',error=undefined)=>({stdout,status,stderr,error});
function selectorFixture({plugin='2.39.4', standalone='2.39.4', pluginProfile=true, standaloneProfile=true, platform='win32', engineError=null}={}) {
  const calls=[];
  const docker={context:'usftwvmdocker',root:"C:\\Users\\Ryan's Folder\\Truck-Log",secrets:['test-secret'],
    redact:s=>String(s??'').replaceAll('test-secret','[REDACTED]'),
    run(args,options={}) {
      calls.push({program:'docker',args,options});
      assert.equal(args[0],'compose');
      if(args[1]==='version')return plugin===null?response('',1,"docker: 'compose' is not a docker command"):response(plugin);
      if(args[1]==='--help')return response(pluginProfile?'Usage: docker compose\n --profile stringArray':'Usage: docker');
      if(engineError)throw Error(engineError);
      return response('plugin result');
    },
  };
  const spawnProcess=(program,args,options)=>{
    calls.push({program,args,options});
    assert.equal(program,platform==='win32'?'docker-compose.exe':'docker-compose');
    if(args[0]==='version')return standalone===null?response('',null,'',{code:'ENOENT',message:'spawn ENOENT'}):response(standalone);
    if(args[0]==='--help')return response(standaloneProfile?'Usage: docker-compose\n --profile stringArray':'Usage: docker');
    if(engineError)return response('',1,engineError);
    return response('standalone result');
  };
  return {docker,calls,options:{spawnProcess,platform,env:{PATH:'fixture-path',DOCKER_CONTEXT:'old-context',DOCKER_CONFIG:'fixture-config'}}};
}

await test('Accept short plugin version',()=>assert.equal(parseComposeVersion('2.39.4\n'),'2.39.4'));
await test('Accept standalone full version banner',()=>assert.equal(parseComposeVersion('Docker Compose version v2.39.4'),'v2.39.4'));
await test('Accept current major and desktop suffix',()=>{assert.equal(parseComposeVersion('v5.5.0'),'v5.5.0');assert.equal(parseComposeVersion('v2.39.4-desktop.1'),'v2.39.4-desktop.1');});
await test('Reject Docker root help, even on exit zero',()=>assert.equal(parseComposeVersion('Usage: docker [OPTIONS] COMMAND\nVersion 29.0.0'),null));
await test('Reject legacy Compose v1, empty and arbitrary banners',()=>{for(const v of ['1.29.2','docker-compose version 1.29.2','', 'not Compose 2.3.0'])assert.equal(parseComposeVersion(v),null);});
await test('Prefer working plugin without probing standalone',()=>{const f=selectorFixture();const c=resolveCompose(f.docker,f.options);assert.equal(c.kind,'plugin');assert.equal(f.calls.length,2);assert(f.calls.every(x=>x.program==='docker'));});
await test('Missing plugin falls back to docker-compose.exe',()=>{const f=selectorFixture({plugin:null});assert.equal(resolveCompose(f.docker,f.options).kind,'standalone');assert(f.calls.some(x=>x.program==='docker-compose.exe'));});
await test('Top-level Docker help instead of Compose triggers fallback',()=>{const f=selectorFixture({plugin:'Usage: docker [OPTIONS] COMMAND'});assert.equal(resolveCompose(f.docker,f.options).kind,'standalone');});
await test('Plugin without --profile support is not used',()=>{const f=selectorFixture({pluginProfile:false});assert.equal(resolveCompose(f.docker,f.options).kind,'standalone');});
await test('Neither frontend available is a clear preflight failure',()=>{const f=selectorFixture({plugin:null,standalone:null});assert.throws(()=>resolveCompose(f.docker,f.options),/Both docker compose and docker-compose.*before any/);assert(f.calls.every(c=>c.args.includes('version')));});
await test('Legacy standalone is rejected before actions',()=>{const f=selectorFixture({plugin:null,standalone:'1.29.2'});assert.throws(()=>resolveCompose(f.docker,f.options),/No working Compose v2/);});
await test('Standalone without profiles is rejected',()=>{const f=selectorFixture({plugin:null,standaloneProfile:false});assert.throws(()=>resolveCompose(f.docker,f.options),/did not advertise --profile/);});
await test('POSIX standalone uses docker-compose, never a shell',()=>{const f=selectorFixture({plugin:null,platform:'linux'});const c=resolveCompose(f.docker,f.options);c.run(['--profile','rxo-browser','config','--quiet']);const call=f.calls.at(-1);assert.equal(call.program,'docker-compose');assert.equal(call.options.shell,false);});
await test('Standalone action gets --profile directly, never as a Docker root flag',()=>{const f=selectorFixture({plugin:null});const c=resolveCompose(f.docker,f.options);c.run(['--profile','rxo-browser','up','-d','--build','--no-deps','rxo-browser']);assert.deepEqual(f.calls.at(-1).args,['--profile','rxo-browser','up','-d','--build','--no-deps','rxo-browser']);assert.equal(f.calls.at(-1).program,'docker-compose.exe');});
await test('Plugin action always retains compose subcommand',()=>{const f=selectorFixture();const c=resolveCompose(f.docker,f.options);c.run(['--profile','rxo-browser','config','--quiet']);assert.deepEqual(f.calls.at(-1).args,['compose','--profile','rxo-browser','config','--quiet']);});
await test('Selected context, config, cwd and session propagate to standalone',()=>{const f=selectorFixture({plugin:null});const c=resolveCompose(f.docker,f.options);c.run(['up','rxo-browser'],{env:{PATH:'fixture',DOCKER_CONTEXT:'wrong',Docker_Context:'also-wrong',DOCKER_CONFIG:'kept-config',RXO_BOOTSTRAP_SESSION:'session-123'}});const o=f.calls.at(-1).options;assert.equal(o.env.DOCKER_CONTEXT,'usftwvmdocker');assert.equal(o.env.DOCKER_CONFIG,'kept-config');assert.equal(o.env.RXO_BOOTSTRAP_SESSION,'session-123');assert(!('Docker_Context' in o.env));assert.equal(o.cwd,f.docker.root);assert.equal(o.shell,false);assert.equal(process.env.DOCKER_CONTEXT,originalDockerContext);});
await test('Plugin receives same pinned context env',()=>{const f=selectorFixture();const c=resolveCompose(f.docker,f.options);c.run(['config','--quiet']);assert.equal(f.calls.at(-1).options.env.DOCKER_CONTEXT,'usftwvmdocker');});
await test('DOCKER_HOST conflict refused before any probe',()=>{const f=selectorFixture();assert.throws(()=>resolveCompose(f.docker,{...f.options,env:{Docker_Host:'tcp://unexpected'}}),/DOCKER_HOST/);assert.equal(f.calls.length,0);});
await test('Missing or multiline context refused before any probe',()=>{for(const context of ['', 'bad\nctx']){const f=selectorFixture();f.docker.context=context;assert.throws(()=>resolveCompose(f.docker,f.options),/resolved Docker context/);assert.equal(f.calls.length,0);}});
await test('Build failure never switches frontends or retries up',()=>{const f=selectorFixture({plugin:null,engineError:'test-secret build failed'});const c=resolveCompose(f.docker,f.options);const before=f.calls.length;assert.throws(()=>c.run(['up','rxo-browser']),e=>e.message.includes('[REDACTED]')&&!e.message.includes('test-secret'));assert.equal(f.calls.length,before+1);});
await test('Action timeout/stdin/visible options preserved on standalone',()=>{const f=selectorFixture({plugin:null});const c=resolveCompose(f.docker,f.options);c.run(['config'],{timeout:2222,input:'fixture-only',visible:true});const o=f.calls.at(-1).options;assert.equal(o.timeout,2222);assert.equal(o.input,'fixture-only');assert.equal(o.stdio,'inherit');});
await test('Cleanup uses same resolved executable without re-probe',()=>{const f=selectorFixture({plugin:null});const c=resolveCompose(f.docker,f.options);const count=f.calls.length;c.run(['up','rxo-browser']);c.run(['stop','rxo-browser']);assert.equal(f.calls.length,count+2);assert(f.calls.slice(count).every(c=>c.program==='docker-compose.exe'));});
await test('Reject shell-string or NUL arguments',()=>{const f=selectorFixture();const c=resolveCompose(f.docker,f.options);for(const args of ['up rxo-browser',[],['up','bad\0']])assert.throws(()=>c.run(args),/argument array/);});

function sessionFixture({running=true, restarting=false, viewer=false, other='', badConfig=false, failUp=false, cleanupStuck=false, failRestore=false, raceOwner=false, taskError=false, stopError=false}={}) {
  const calls=[];let scheduler=running, viewerRunning=viewer, phase='preflight';
  const d={
    inspect(name) {calls.push('inspect:'+name); if(name==='truck-log-rxo-export')return {State:{Running:scheduler,Restarting:restarting&&phase==='preflight'}};if(name==='truck-log-rxo-browser')return viewerRunning?{State:{Running:true}}:null;throw Error('Unexpected inspect');},
    run(args) {
      calls.push('docker:'+args.join(' '));
      if(args[0]==='ps')return response([scheduler?'truck-log-rxo-export':'',viewerRunning?'truck-log-rxo-browser':'',other,raceOwner&&phase==='stopped'?'racing-browser':''].filter(Boolean).join('\n'));
      if(args.join(' ')==='start truck-log-rxo-export'){if(failRestore)throw Error('fixture restore failed');scheduler=true;return response();}
      throw Error('Unexpected Docker mutation: '+args.join(' '));
    },
  };
  const c={run(args,options){calls.push('compose:'+args.join(' '));assert.equal(options.env.RXO_BOOTSTRAP_SESSION,'fixture-session');
    if(args.includes('config')){if(badConfig)throw Error('fixture config failed');return response();}
    if(args.includes('up')){viewerRunning=true;phase='started';if(failUp)throw Error('fixture build failed');return response();}
    if(args.includes('stop')){if(!cleanupStuck)viewerRunning=false;return response('',cleanupStuck?1:0);}
    throw Error('Unexpected Compose operation');
  }};
  const stop=async(_d,name)=>{assert.equal(_d,d);assert.equal(name,'truck-log-rxo-export');calls.push('verified-stop');if(stopError)throw Error('fixture stop failed');scheduler=false;phase='stopped';return true;};
  const task=async()=>{calls.push('task');if(taskError)throw Error('fixture auth timeout');return 'verified-session';};
  return {calls,d,c,stop,task,state:()=>({scheduler,viewer:viewerRunning}),go:()=>withBrowserSession(d,c,{RXO_BOOTSTRAP_SESSION:'fixture-session'},task,stop)};
}
await test('Valid profile checked before scheduler stop, success restored afterward',async()=>{const f=sessionFixture();assert.equal(await f.go(),'verified-session');assert.equal(f.calls[0],'compose:--profile rxo-browser config --quiet');assert(f.calls.indexOf('verified-stop')<f.calls.indexOf('task'));assert(f.calls.indexOf('compose:--profile rxo-browser stop rxo-browser')<f.calls.indexOf('docker:start truck-log-rxo-export'));assert.deepEqual(f.state(),{scheduler:true,viewer:false});});
await test('Bad Compose config never pauses the scheduler',async()=>{const f=sessionFixture({badConfig:true});await assert.rejects(f.go(),/config failed/);assert.equal(f.calls.length,1);assert(f.state().scheduler);});
await test('Stopped scheduler remains stopped on success',async()=>{const f=sessionFixture({running:false});await f.go();assert(!f.calls.includes('verified-stop'));assert(!f.calls.some(x=>x.startsWith('docker:start')));assert(!f.state().scheduler);});
await test('Restarting scheduler is considered active',async()=>{const f=sessionFixture({running:false,restarting:true});await f.go();assert(f.calls.includes('verified-stop'));assert(f.state().scheduler);});
await test('Existing viewer is rejected before scheduler stop',async()=>{const f=sessionFixture({viewer:true});await assert.rejects(f.go(),/already running/);assert(!f.calls.includes('verified-stop'));});
await test('Other profile writer is rejected before scheduler stop',async()=>{const f=sessionFixture({other:'other-browser'});await assert.rejects(f.go(),/Scheduler was not paused/);assert(!f.calls.includes('verified-stop'));});
await test('Failed up cleans viewer and restores prior scheduler',async()=>{const f=sessionFixture({failUp:true});await assert.rejects(f.go(),/build failed/);assert(!f.calls.includes('task'));assert.deepEqual(f.state(),{scheduler:true,viewer:false});});
await test('Failed authentication task cleans viewer and restores scheduler',async()=>{const f=sessionFixture({taskError:true});await assert.rejects(f.go(),/auth timeout/);assert.deepEqual(f.state(),{scheduler:true,viewer:false});});
await test('Cleanup failure never starts scheduler against active viewer',async()=>{const f=sessionFixture({cleanupStuck:true});await assert.rejects(f.go(),/Scheduler NOT restarted/);assert(!f.calls.some(x=>x.startsWith('docker:start')));assert.deepEqual(f.state(),{scheduler:false,viewer:true});});
await test('Racing profile owner prevents viewer launch and scheduler restart',async()=>{const f=sessionFixture({raceOwner:true});await assert.rejects(f.go(),/Refusing two Chromium writers/);assert(!f.calls.some(x=>x.includes(' up ')));assert(!f.calls.some(x=>x.startsWith('docker:start')));});
await test('Scheduler restoration failure is not reported as success',async()=>{const f=sessionFixture({failRestore:true});await assert.rejects(f.go(),/restore failed/);});
await test('Failed scheduler stop prevents viewer start',async()=>{const f=sessionFixture({stopError:true});await assert.rejects(f.go(),/stop failed/);assert(!f.calls.includes('task'));assert(!f.calls.some(x=>x.includes(' up ')));});
await test('Every session mutation is scoped to RXO browser or scheduler only',async()=>{const f=sessionFixture();await f.go();const actions=f.calls.filter(x=>x.startsWith('compose:')||x.startsWith('docker:'));for(const a of actions)assert(!/truck-log-(server|web|postgres)|volume rm|down|prune/.test(a));});
console.log(`[PASS] Compose/bootstrap tests: ${passed} passed. All command runners are simulated; no real Docker, SSH, browser or network used.`);
