import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client }=pg;
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
  const i=x.indexOf('=');
  return i>0?[x.slice(0,i),x.slice(i+1)]:[x,true];
}));

function loadDotEnv(filePath){
  const out={};
  if(!fs.existsSync(filePath)) return out;
  for(const raw of fs.readFileSync(filePath,'utf8').split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith('#')) continue;
    const i=line.indexOf('='); if(i<1) continue;
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    out[line.slice(0,i).trim()]=value;
  }
  return out;
}

for(const key of ['--containerTrayId','--containerId','--trayId']){
  if(!args[key]) throw new Error(`Missing ${key}=...`);
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const env={...loadDotEnv(path.resolve(root, '..', '.env')),...process.env};
const client=new Client({
  host:env.DATABASE_HOST,port:Number(env.DATABASE_PORT),user:env.DATABASE_USERNAME,
  password:String(env.DATABASE_PASSWORD),database:env.DATABASE_NAME,
});
await client.connect();
try{
  await client.query('begin');

  // IDs are supplied from the fixture creator; still verify E2E serial prefixes
  // before deleting anything.
  const ct=(await client.query(`select id,tray_id,container_id from container_tray where id=$1`,[args['--containerTrayId']])).rows[0];
  if(ct){
    if(ct.tray_id!==args['--trayId']||ct.container_id!==args['--containerId']){
      throw new Error('Direct fixture IDs do not match each other; refusing cleanup.');
    }
    const tray=(await client.query(`select serial_number from trays where id=$1`,[ct.tray_id])).rows[0];
    const container=(await client.query(`select serial_number from containers where id=$1`,[ct.container_id])).rows[0];
    if(!tray?.serial_number?.startsWith('E2E-DIRECT-CT-TRAY-') ||
       !container?.serial_number?.startsWith('E2E-DIRECT-CT-CONTAINER-')){
      throw new Error('Direct fixture serial prefixes are not E2E; refusing cleanup.');
    }
    await client.query(`delete from container_tray where id=$1`,[ct.id]);
    await client.query(`delete from trays where id=$1`,[ct.tray_id]);
    await client.query(`delete from containers where id=$1`,[ct.container_id]);
  }

  await client.query('commit');
  console.log('[PASS] Direct backend-mutation DB fixtures cleaned safely.');
}catch(e){
  try{await client.query('rollback');}catch{}
  throw e;
}finally{
  await client.end();
}
