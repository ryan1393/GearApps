import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { assertTestAccountsAllowed } from './test-account-guard.mjs';
import { fileURLToPath } from 'node:url';

const { Client }=pg;
const ADMIN_EMAIL='e2e.admin@meshforge.local';
const ADMIN_PASSWORD='MeshForge-E2E-Admin-2026!';
const USER_EMAIL='e2e.user@meshforge.local';
const USER_PASSWORD='MeshForge-E2E-User-2026!';

function loadDotEnv(filePath){
  const out={};
  if(!fs.existsSync(filePath)) return out;
  for(const raw of fs.readFileSync(filePath,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#')) continue;
    const i=line.indexOf('=');
    if(i<1) continue;
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    out[line.slice(0,i).trim()]=value;
  }
  return out;
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..', '..', '..');
const env={...loadDotEnv(path.resolve(root, '.env')),...process.env};
for(const k of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']){
  if(typeof env[k]!=='string'||!env[k]) throw new Error(`Missing ${k}`);
}

assertTestAccountsAllowed(env,'ensure-backend-mutation-test-fixtures');
const client=new Client({
  host:env.DATABASE_HOST,
  port:Number(env.DATABASE_PORT),
  user:env.DATABASE_USERNAME,
  password:String(env.DATABASE_PASSWORD),
  database:env.DATABASE_NAME,
});

async function one(sql,args=[]){
  const r=await client.query(sql,args);
  return r.rows[0]??null;
}

async function ensureUser(email,password,role,departmentCode){
  const department=await one(
    `select id from departments where code=$1 and enabled=true limit 1`,
    [departmentCode],
  );
  if(!department) throw new Error(`Department ${departmentCode} is required for ${email}.`);
  const hash=await bcrypt.hash(password,10);
  const existing=await one(`select id from users where lower(email)=lower($1) limit 1`,[email]);
  if(existing){
    await client.query(
      `update users
          set password=$2, role=$3, "departmentId"=$4, active=true, "isEmailVerified"=true,
              "emailVerifiedOn"=coalesce("emailVerifiedOn",now()), "updatedAt"=now(),
              "socialProvider"='email'
        where id=$1`,
      [existing.id,hash,role,department.id],
    );
    return existing.id;
  }
  const id=crypto.randomUUID();
  await client.query(
    `insert into users
      (id,"createdAt","updatedAt",email,password,"firstName","lastName",
       role,"departmentId",active,"isEmailVerified","emailVerifiedOn","socialProvider")
     values($1,now(),now(),$2,$3,'MeshForge','E2E Backend',$4,$5,true,true,now(),'email')`,
    [id,email,hash,role,department.id],
  );
  return id;
}

await client.connect();
try{
  await client.query('begin');
  const adminId=await ensureUser(ADMIN_EMAIL,ADMIN_PASSWORD,'admin','99');
  const userId=await ensureUser(USER_EMAIL,USER_PASSWORD,'user','48');

  const reference=await one(`
    select r.summary_id,
           r.part_type_id,
           s.number as summary_number,
           pt.code as part_type_code
      from cutter_blade_requirements r
      join part_summaries s on s.id=r.summary_id
      join part_types pt on pt.id=r.part_type_id
     where r.enabled=true and s.enabled=true and pt.enabled=true
     order by s.number,pt.code
     limit 1`);
  if(!reference) throw new Error('No enabled blade requirement/summary/part type reference exists.');

  const opposite=await one(
    `select id,code from part_types
      where enabled=true and id<>$1
      order by code limit 1`,
    [reference.part_type_id],
  );
  if(!opposite) throw new Error('A second enabled part type is required for mismatch rollback testing.');

  const runToken=`${Date.now()}-${crypto.randomUUID().slice(0,8)}`.toUpperCase();

  // Direct fixtures are used only for endpoints whose successful prerequisite
  // state is created by a different workflow. The mutation itself is still
  // exercised through the authenticated API.
  const emptyStage=await one(`select id from tray_stages where code='EMPTY' and enabled=true limit 1`);
  if(!emptyStage) throw new Error('EMPTY tray stage is not configured.');

  const directTrayId=crypto.randomUUID();
  const directContainerId=crypto.randomUUID();
  const directContainerTrayId=crypto.randomUUID();
  await client.query(
    `insert into trays
      (id,"createdAt","updatedAt","createdBy","updatedBy",serial_number,blade_count,
       summary_id,part_type_id,grinding_completed_at,required_blade_count,current_stage_id,enabled)
     values($1,now(),now(),$2,$2,$3,0,null,null,null,null,$4,true)`,
    [directTrayId,adminId,`E2E-DIRECT-CT-TRAY-${runToken}`,emptyStage.id],
  );
  await client.query(
    `insert into containers
      (id,"createdAt","updatedAt","createdBy","updatedBy",serial_number,enabled)
     values($1,now(),now(),$2,$2,$3,true)`,
    [directContainerId,adminId,`E2E-DIRECT-CT-CONTAINER-${runToken}`],
  );
  await client.query(
    `insert into container_tray
      (id,"createdAt","updatedAt","createdBy","updatedBy",tray_id,container_id,enabled)
     values($1,now(),now(),$2,$2,$3,$4,true)`,
    [directContainerTrayId,adminId,directTrayId,directContainerId],
  );

  const targetUserId=crypto.randomUUID();
  const targetUserEmail=`e2e.mutation.target.${runToken.toLowerCase()}@meshforge.local`;
  const targetHash=await bcrypt.hash('MeshForge-E2E-Target-2026!',10);
  await client.query(
    `insert into users
      (id,"createdAt","updatedAt",email,password,"firstName","lastName",role,active,
       "isEmailVerified","emailVerifiedOn","socialProvider")
     values($1,now(),now(),$2,$3,'E2E','Mutation Target','user',true,true,now(),'email')`,
    [targetUserId,targetUserEmail,targetHash],
  );

  await client.query('commit');
  process.stdout.write(JSON.stringify({
    ok:true,
    admin_email:ADMIN_EMAIL,
    admin_password:ADMIN_PASSWORD,
    admin_id:adminId,
    user_email:USER_EMAIL,
    user_password:USER_PASSWORD,
    user_id:userId,
    summary_id:reference.summary_id,
    summary_number:reference.summary_number,
    part_type_id:reference.part_type_id,
    part_type_code:reference.part_type_code,
    opposite_part_type_id:opposite.id,
    opposite_part_type_code:opposite.code,
    run_token:runToken,
    direct_container_tray_id:directContainerTrayId,
    direct_container_id:directContainerId,
    direct_tray_id:directTrayId,
    target_user_id:targetUserId,
    target_user_email:targetUserEmail,
  }));
}catch(e){
  try{await client.query('rollback');}catch{}
  throw e;
}finally{
  await client.end();
}
