import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv, prepareEnv, VOLUMES } from '../../../../tools/truck-log/new-host/setup-config.mjs';
import { tunnelArguments, viewerPort } from '../../../../tools/truck-log/new-host/browser-bootstrap.mjs';
import { DockerClient } from '../../../../tools/truck-log/new-host/docker-client.mjs';

let count=0, skipped=0;
async function test(name, f, {posixOnly=false}={}){
  if(posixOnly&&process.platform==='win32'){skipped++;console.log('[SKIP] '+name+' — POSIX/Linux-container permission test, not a Windows ACL test.');return;}
  await f();count++;console.log('[PASS] '+name);
}
const root=process.cwd();
const template=fs.readFileSync('.env.example','utf8');
await test('Fresh .env generates database password and uses internal database host',()=>{
  const e=parseEnv(prepareEnv('',template,'http://vm.test:4300',()=> 'a'.repeat(64)));
  assert.equal(e.get('TRUCK_LOG_DATABASE_USERNAME'),'api');assert.equal(e.get('TRUCK_LOG_DATABASE_PASSWORD'),'a'.repeat(64));
  assert.equal(e.get('TRUCK_LOG_DATABASE_HOST'),'truck-log-postgres');assert.equal(e.get('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET'),'a'.repeat(64));
});
await test('Existing database password, CORS and signing secret are not reset',()=>{
  const old=`# fixture\nTRUCK_LOG_DATABASE_PASSWORD="kept-fixture"\nTRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET=${'b'.repeat(64)}\nTRUCK_LOG_CORS_ORIGINS=http://kept.test\n`;
  const s=prepareEnv(old,template,'http://new.test:4300',()=>{throw Error('must not rotate');});
  assert(s.includes('TRUCK_LOG_DATABASE_PASSWORD="kept-fixture"'));assert.equal(parseEnv(s).get('TRUCK_LOG_CORS_ORIGINS'),'http://kept.test');
});
await test('Setup preparation is byte-stable on repeat',()=>{
  const once=prepareEnv('',template,'http://vm.test:4300',()=> 'c'.repeat(64));
  assert.equal(prepareEnv(once,template,'http://vm.test:4300',()=>{throw Error('rotate');}),once);
});
await test('Duplicate .env keys fail instead of picking one',()=>assert.throws(()=>parseEnv('A=1\nA=2'),/Duplicate/));
await test('Invalid existing signing secret is not silently rotated',()=>assert.throws(()=>prepareEnv('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET=bad\n',template,'x'),/invalid/));
await test('All eight required data/state/credential volumes are named',()=>{assert.equal(VOLUMES.length,8);assert(VOLUMES.includes('truck-log-postgres-data'));assert(VOLUMES.includes('truck-log-rxo-credentials'));assert(VOLUMES.includes('truck-log-rxo-expedite-data'));assert(VOLUMES.includes('truck-log-rxo-expedite-state'));});
await test('SSH viewer tunnels bind localhost, not LAN',()=>{const a=tunnelArguments('ssh://operator@vm.test:2222',16880);assert(a.includes('127.0.0.1:16880:127.0.0.1:6080'));assert(a.includes('2222'));assert.equal(a.at(-1),'operator@vm.test');});
await test('SSH viewer tunnel follows TRUCK_LOG_RXO_BROWSER_PORT on the Docker host',()=>{const a=tunnelArguments('ssh://operator@vm.test',16880,16081);assert(a.includes('127.0.0.1:16880:127.0.0.1:16081'));assert.throws(()=>tunnelArguments('ssh://vm.test',16880,0),/port/);});
await test('Viewer port comes from the environment, then .env, then 6080',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tl-viewer-port-'));const file=path.join(dir,'.env');try{assert.equal(viewerPort({},file),6080);fs.writeFileSync(file,'TRUCK_LOG_RXO_BROWSER_PORT=16090\n');assert.equal(viewerPort({},file),16090);assert.equal(viewerPort({TRUCK_LOG_RXO_BROWSER_PORT:'16091'},file),16091);assert.throws(()=>viewerPort({TRUCK_LOG_RXO_BROWSER_PORT:'x'},file),/TCP port/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
await test('Plain TCP viewer access is refused',()=>assert.throws(()=>tunnelArguments('tcp://host:2375',16880),/SSH/));
await test('SSH options cannot be injected via endpoint',()=>assert.throws(()=>tunnelArguments('ssh://-BadHost',16880),/Unsafe/));
await test('Credential output redactor never blanket-redacts api words',()=>{const d=new DockerClient({secrets:['fixture-secret']});assert.equal(d.redact('API startup fixture-secret'),'API startup [REDACTED]');});

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tl-credential-test-'));
const helper=path.join(root,'tools/truck-log/new-host/credential-volume.cjs');
const call=data=>spawnSync(process.execPath,[helper],{input:JSON.stringify(data),encoding:'utf8',env:{...process.env,TRUCK_LOG_SETUP_SECRETS_ROOT:temp}});
try{
  await test('Empty volume is unconfigured, not successful login',()=>{const r=call({action:'probe'});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).configured,false);});
  await test('Credential writer accepts Unicode/quotes/ampersands through stdin',()=>{
    const username='fixture+ü@example.test',password='fixture-&|"$`æ-password';
    const r=call({action:'write',values:{rxo_username:username,rxo_password:password}});assert.equal(r.status,0,r.stderr);
    assert.equal(fs.readFileSync(path.join(temp,'rxo_password'),'utf8'),password);assert(!r.stdout.includes(password));assert(!r.stderr.includes(password));
  });
  await test('Secrets are stored mode 0600',()=>{assert.equal(fs.statSync(path.join(temp,'rxo_password')).mode&0o777,0o600);},{posixOnly:true});
  await test('Credential probe reports configured without returning values',()=>{const r=call({action:'probe'});assert.deepEqual(JSON.parse(r.stdout),{configured:true});});
  await test('Blank credential rejected before old pair changes',()=>{const before=fs.readFileSync(path.join(temp,'rxo_password'));const r=call({action:'write',values:{rxo_username:'fixture',rxo_password:''}});assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(path.join(temp,'rxo_password')),before);});
  await test('Multiline credential rejected without exposing input',()=>{const r=call({action:'write',values:{rxo_username:'fixture',rxo_password:'one\ntwo'}});assert.notEqual(r.status,0);assert(!r.stderr.includes('one'));});
  await test('Symlink credential path fails closed',()=>{fs.unlinkSync(path.join(temp,'rxo_username'));fs.symlinkSync(path.join(temp,'rxo_password'),path.join(temp,'rxo_username'));assert.notEqual(call({action:'probe'}).status,0);},{posixOnly:true});
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log(`[PASS] New-host unit and filesystem tests: ${count} passed, ${skipped} platform-specific skipped. Database responses in bootstrap tests are mocked.`);
