import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { assertTestAccountsAllowed } from './test-account-guard.mjs';

const { Client } = pg;
const AUTO_TEST_EMAIL = 'test@gearapps.local';
const AUTO_TEST_PASSWORD = 'GearApps-E2E-Only-2026!';
const AUTO_ADMIN_EMAIL = 'admin@gearapps.local';
const AUTO_ADMIN_PASSWORD = 'GearApps-Admin-Only-2026!';

function loadDotEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const scriptFile=fileURLToPath(import.meta.url);
const projectRoot=path.resolve(path.dirname(scriptFile),'..','..');
const env={...loadDotEnv(path.resolve(projectRoot, '..', '.env')),...process.env};
for (const key of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']) {
  if (typeof env[key] !== 'string' || !env[key].length) {
    throw new Error(`Missing ${key} for automatic test-user provisioning.`);
  }
}

assertTestAccountsAllowed(env,'ensure-automatic-test-user');
const client=new Client({
  host:env.DATABASE_HOST,
  port:Number(env.DATABASE_PORT),
  user:env.DATABASE_USERNAME,
  password:String(env.DATABASE_PASSWORD),
  database:env.DATABASE_NAME,
});

await client.connect();
try {
  async function upsertLocalAccount({ email, password, firstName, lastName, role, departmentCode }) {
    const departmentResult=await client.query(
      `select id from departments where code=$1 and enabled=true limit 1`,
      [departmentCode],
    );
    if(!departmentResult.rows[0]){
      throw new Error(`Department code ${departmentCode} is required for local account ${email}.`);
    }
    const departmentId=departmentResult.rows[0].id;
    const hash=await bcrypt.hash(password,10);
    const found=await client.query(
      `select id from users where lower(email)=lower($1) limit 1`,
      [email],
    );
    if (found.rows[0]) {
      await client.query(
        `update users
            set password=$2, role=$3, "departmentId"=$4, active=true, "isEmailVerified"=true,
                "emailVerifiedOn"=coalesce("emailVerifiedOn",now()),
                "updatedAt"=now()
          where id=$1`,
        [found.rows[0].id,hash,role,departmentId],
      );
    } else {
      const id=crypto.randomUUID();
      await client.query(
        `insert into users
          (id,"createdAt","updatedAt",email,password,"firstName","lastName",
           role,"departmentId",active,"isEmailVerified","emailVerifiedOn","socialProvider")
         values ($1,now(),now(),$2,$3,$4,$5,$6,$7,true,true,now(),'email')`,
        [id,email,hash,firstName,lastName,role,departmentId],
      );
    }
  }

  await upsertLocalAccount({
    email: AUTO_TEST_EMAIL,
    password: AUTO_TEST_PASSWORD,
    firstName: 'Gear Apps',
    lastName: 'E2E Test',
    role: 'user',
    departmentCode: '45',
  });

  await upsertLocalAccount({
    email: AUTO_ADMIN_EMAIL,
    password: AUTO_ADMIN_PASSWORD,
    firstName: 'Gear Apps',
    lastName: 'Local Admin',
    role: 'admin',
    departmentCode: '99',
  });

  console.log('[PASS] Dedicated automatic Gear Apps user + local admin are ready.');
} finally {
  await client.end();
}
