// Live role, token, and inventory regressions. Requires an explicitly opted-in TEST DB.
// node --env-file=.env tools/manufacturing/test-release-regressions.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { assertTestAccountsAllowed } from './test-data/test-account-guard.mjs';

assertTestAccountsAllowed(process.env, 'test-release-regressions');
for (const name of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']) assert.ok(process.env[name], `Missing ${name}`);
const client = new pg.Client({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME });
const base = (process.env.MESHFORGE_BASE_URL || 'http://localhost:3333/api/v1').replace(/\/$/,'');
const tag = `RELEASE-${crypto.randomUUID()}`;
const password = `Release-${crypto.randomBytes(24).toString('base64url')}!`;
const users = []; const blades = []; let tray; let checks = 0;
const one = async (sql, values=[]) => (await client.query(sql, values)).rows[0];
function pass(name) { ++checks; console.log(`[PASS] ${name}`); }
async function request(method, route, body, token) {
  const r = await fetch(base + route, { method, headers: { 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status:r.status, json };
}
async function expect(label, method, route, body, token, statuses) {
  const r = await request(method,route,body,token); assert.ok(statuses.includes(r.status), `${label}: expected HTTP ${statuses.join('/')}, got ${r.status}`); pass(label); return r.json;
}
async function account(departmentId, label) {
  const id=crypto.randomUUID(), email=`${tag}.${label}@example.invalid`.toLowerCase();
  await client.query(`INSERT INTO users(id,email,password,role,"departmentId",active,"isEmailVerified","socialProvider") VALUES($1,$2,$3,'user',$4,true,true,'email')`, [id,email,await bcrypt.hash(password,10),departmentId]);
  users.push(id);
  const auth = await request('POST','/auth/email/login',{email,password});
  assert.equal(auth.status,200,'Unique test account login');
  return { id,...auth.json };
}
await client.connect();
try {
  const grind=await one("SELECT id FROM departments WHERE code='45' AND enabled AND active");
  const quality=await one("SELECT id FROM departments WHERE code='48' AND enabled AND active");
  const empty=await one("SELECT id FROM tray_stages WHERE code='EMPTY' AND enabled");
  const ref=await one('SELECT summary_id,part_type_id FROM cutter_blade_requirements WHERE enabled LIMIT 1');
  assert.ok(grind && quality && empty && ref,'Load base/reference data before running live regressions');
  const g=await account(grind.id,'grind'),q=await account(quality.id,'quality');
  pass('Normal Department45 and48 users can log in');
  const me=await expect('Authenticated normal user department is loaded','GET','/auth/me',undefined,g.accessToken,[200]);
  assert.equal(me.department.code,'45');
  for(const name of ['password','refreshToken','authVersion','passwordResetTokenHash','passwordResetExpiresAt','verificationHash']) assert.equal(Object.hasOwn(me,name),false,`Credential field ${name} must be excluded`);
  pass('User responses exclude credential and recovery fields');
  const race=await Promise.all([request('GET','/auth/refresh',undefined,q.refreshToken),request('GET','/auth/refresh',undefined,q.refreshToken)]);
  assert.equal(race.filter(r=>r.status===200).length,1,'Exactly one concurrent refresh must succeed');
  assert.equal(race.filter(r=>[401,403].includes(r.status)).length,1,'The replayed refresh must fail');
  pass('Concurrent refresh has exactly one successful rotation');
  const winner=race.find(r=>r.status===200).json;
  await expect('Previous refresh token cannot be replayed','GET','/auth/refresh',undefined,q.refreshToken,[401,403]);
  await expect('Replacement refresh token remains usable','GET','/auth/refresh',undefined,winner.refreshToken,[200]);
  await expect('Refresh token cannot authenticate an access route','GET','/auth/me',undefined,g.refreshToken,[401]);
  await expect('Access token cannot authenticate a refresh route','GET','/auth/refresh',undefined,g.accessToken,[401]);

  tray=crypto.randomUUID();
  await client.query('INSERT INTO trays(id,serial_number,blade_count,current_stage_id,enabled) VALUES($1,$2,0,$3,true)',[tray,tag,empty.id]);
  const batch={tray_id:tray,...ref,quantity:1,status:'new'};
  await expect('Department48 cannot perform blade intake','POST','/bladeTrays/batch',batch,q.accessToken,[403]);
  const added=await expect('Department45 can perform blade intake','POST','/bladeTrays/batch',batch,g.accessToken,[200,201]);
  blades.push(...added.blade_ids);
  const assignment=await one('SELECT id FROM blade_tray WHERE blade_id=$1 AND enabled',[blades[0]]);
  await expect('Assigned blade deletion is rejected','DELETE',`/blades/${blades[0]}`,undefined,g.accessToken,[409]);
  await expect('Assigned blade status edit is rejected','PATCH',`/blades/${blades[0]}`,{status:'scrapped'},g.accessToken,[409]);
  await expect('Generic blade assignment PATCH is rejected','PATCH',`/bladeTrays/${assignment.id}`,{enabled:false},g.accessToken,[422]);
  await expect('Occupied tray deactivation is rejected','DELETE',`/trays/${tray}`,undefined,g.accessToken,[409]);
  const state=await one('SELECT t.blade_count,b.status,bt.enabled FROM trays t JOIN blade_tray bt ON bt.tray_id=t.id JOIN blades b ON b.id=bt.blade_id WHERE t.id=$1',[tray]);
  assert.deepEqual(state,{blade_count:1,status:'new',enabled:true});pass('Rejected mutations preserve inventory count, blade state and assignment');
  await client.query('UPDATE users SET active=false WHERE id=$1',[g.id]);
  await expect('Deactivation revokes an issued access token','GET','/auth/me',undefined,g.accessToken,[401]);
  await expect('Deactivation revokes an issued refresh token','GET','/auth/refresh',undefined,g.refreshToken,[401]);
  console.log(`[PASS] LIVE RELEASE REGRESSIONS COMPLETE (${checks} checks)`);
} finally {
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dana_workflow_changes_v1 WHERE operation_id IN (SELECT id FROM dana_workflow_journal_v1 WHERE created_by=ANY($1::text[]))',[users]);
    await client.query('DELETE FROM dana_workflow_journal_v1 WHERE created_by=ANY($1::text[])',[users]);
    if(tray){
      const own=(await client.query('SELECT blade_id FROM blade_tray WHERE tray_id=$1',[tray])).rows.map(r=>r.blade_id);
      const ownBlades=[...new Set([...blades,...own])];
      await client.query('DELETE FROM blade_history WHERE blade_id::text=ANY($1::text[]) OR tray_id::text=$2',[ownBlades,tray]);
      await client.query('DELETE FROM blade_tray WHERE tray_id=$1',[tray]);
      await client.query('DELETE FROM trays WHERE id=$1',[tray]);
      await client.query('DELETE FROM blades WHERE id::text=ANY($1::text[])',[ownBlades]);
    }
    await client.query('DELETE FROM users WHERE id::text=ANY($1::text[])',[users]);
    await client.query('COMMIT');console.log('[PASS] Removed only this run\'s test fixtures');
  } catch(error){await client.query('ROLLBACK');throw error;} finally {await client.end();}
}
