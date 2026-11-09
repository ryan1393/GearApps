import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';

const { Client }=pg;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
function envFile(p){const o={}; if(!fs.existsSync(p))return o; for(const raw of fs.readFileSync(p,'utf8').split(/\r?\n/)){const s=raw.trim();if(!s||s.startsWith('#'))continue;const i=s.indexOf('=');if(i<1)continue;let v=s.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);o[s.slice(0,i).trim()]=v;}return o;}
const env={...envFile(path.join(root,'.env')),...process.env};
for(const k of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']) if(typeof env[k]!=='string'||!env[k]) throw new Error(`Missing ${k}`);
const c=new Client({host:env.DATABASE_HOST,port:Number(env.DATABASE_PORT),user:env.DATABASE_USERNAME,password:String(env.DATABASE_PASSWORD),database:env.DATABASE_NAME});
await c.connect();
try{
  await c.query('begin');
  const user=(await c.query(`select id from users where lower(email)=lower('test@gearapps.local') and active=true limit 1`)).rows[0];
  if(!user) throw new Error('Dedicated E2E user does not exist.');
  const tray=(await c.query(`
    select t.id
      from trays t join tray_stages s on s.id=t.current_stage_id
     where t.enabled=true and t.serial_number like 'E2E-SOURCE-%'
       and s.code='WAITING_FOR_GRINDING'
       and exists(select 1 from blade_tray bt join blades b on b.id=bt.blade_id where bt.tray_id=t.id and bt.enabled=true and b.enabled=true and b.status='waiting_for_grinding')
     order by t."createdAt" desc limit 1`)).rows[0];
  if(!tray) throw new Error('No valid E2E source tray is available for DB start-grinding contract.');
  const grinding=(await c.query(`select id from tray_stages where code='GRINDING' and enabled=true limit 1`)).rows[0];
  if(!grinding) throw new Error('GRINDING tray stage is missing.');
  const blades=(await c.query(`select b.id,b.status,b.service_cycle from blade_tray bt join blades b on b.id=bt.blade_id where bt.tray_id=$1 and bt.enabled=true and b.enabled=true`,[tray.id])).rows;
  if(!blades.length) throw new Error('E2E source tray has no active blades.');
  for(const b of blades){
    if(b.status!=='waiting_for_grinding') throw new Error(`Blade ${b.id} has invalid status ${b.status}`);
    await c.query(`insert into blade_history (id,"createdAt","updatedAt","createdBy","updatedBy",blade_id,event_type,from_status,to_status,service_cycle,tray_id,notes) values($1,now(),now(),$2,$2,$3,'status_changed','waiting_for_grinding','resharpening',$4,$5,'E2E DB contract rollback')`,
      [crypto.randomUUID(),user.id,b.id,b.service_cycle??0,tray.id]);
    await c.query(`update blades set status='resharpening',"updatedBy"=$2,"updatedAt"=now() where id=$1`,[b.id,user.id]);
  }
  await c.query(`update location_tray set enabled=false,"updatedBy"=$2,"updatedAt"=now() where tray_id=$1 and enabled=true`,[tray.id,user.id]);
  await c.query(`update trays set current_stage_id=$2,"updatedBy"=$3,"updatedAt"=now() where id=$1`,[tray.id,grinding.id,user.id]);
  await c.query('rollback');
  console.log(`[PASS] Start-grinding DB contract passed for ${blades.length} blade(s); transaction rolled back.`);
}catch(e){
  try{await c.query('rollback');}catch{}
  throw e;
}finally{await c.end();}
