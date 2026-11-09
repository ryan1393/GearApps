'use strict';
// Explicit, interactive operator-only maintenance; never invoked by automatic setup or API startup.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const security = require('./admin-auth-core.cjs');
const VERSION = security.ADMIN_VERSION;
function check(ok, message) { if (!ok) throw Error(message); }
async function verifySchema(client) {
  const version = await client.query('SELECT version FROM truck_log_admin.schema_version WHERE id=1');
  check(version.rows.length === 1 && version.rows[0].version === VERSION, 'Unexpected Admin schema version; no changes made.');
  const columns = await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='truck_log_admin'");
  const actual = new Set(columns.rows.map(r => r.table_name + '.' + r.column_name));
  for (const [table, names] of Object.entries({schema_version:['id','version','installed_at'],users:['id','username','email','display_name','password_hash','enabled','must_change_password','session_epoch','created_at','updated_at'],sessions:['token_hash','user_id','user_epoch','created_at','last_seen_at','expires_at'],login_limits:['key_hash','attempts','expires_at'],audit:['id','occurred_at','actor_id','target_id','action','detail']})) {
    for(const name of names) check(actual.delete(table+'.'+name),'Admin schema is missing expected columns.');
  }
  check(actual.size === 0, 'Unexpected Admin schema columns; manual review required.');
}
async function transaction(client, fn) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('truck-log-admin-users-v1',0))");
    const result = await fn(); await client.query('COMMIT'); return result;
  } catch(error) { try { await client.query('ROLLBACK'); } catch { /* original failure */ } throw error; }
}
async function ensureTruckLog(client) {
  const result = await client.query("SELECT current_database() AS name,to_regclass('public.truck_visits') AS visits,to_regclass('public.visit_events') AS events");
  check(result.rows[0]?.visits && result.rows[0]?.events,'Selected database is not the existing Truck Log database. Refusing setup.');
}
async function migrate(client) {
  // The admin schema is part of the database baseline (database/truck-log/migrations/0001_baseline.sql);
  // the server applies it on start. This only confirms it is present and correct.
  await ensureTruckLog(client);
  const exists = await client.query("SELECT to_regnamespace('truck_log_admin') AS schema");
  check(exists.rows[0]?.schema, 'Admin schema is missing. Start the Truck Log server once so it applies database migrations.');
  await verifySchema(client);
  return 'ALREADY_INSTALLED';
}
async function setupAccount(client, operation, values) {
  check(['bootstrap','recover'].includes(operation), 'Unsupported account operation.');
  const handle = security.username(values.username), hash = await security.hashPassword(values.password);
  const mail = operation === 'bootstrap' ? security.email(values.email) : null;
  const name = operation === 'bootstrap' ? security.displayName(values.displayName) : null;
  await ensureTruckLog(client); await verifySchema(client);
  return transaction(client, async () => {
    let id;
    if (operation === 'bootstrap') {
      const count = await client.query('SELECT count(*)::integer AS count FROM truck_log_admin.users');
      check(count.rows[0].count === 0, 'An Admin account already exists. Use recovery rather than creating another first account.');
      id = crypto.randomUUID();
      await client.query(`INSERT INTO truck_log_admin.users(id,username,email,display_name,password_hash,must_change_password)
        VALUES ($1,$2,$3,$4,$5,true)`,[id,handle,mail,name,hash]);
    } else {
      const rows = await client.query(`UPDATE truck_log_admin.users SET password_hash=$2,enabled=true,must_change_password=true,
        session_epoch=session_epoch+1,updated_at=now() WHERE username=$1 RETURNING id`, [handle,hash]);
      check(rows.rows.length === 1,'Existing Truck Log administrator was not found. No account was created.');
      id=rows.rows[0].id;
      await client.query('DELETE FROM truck_log_admin.sessions WHERE user_id=$1',[id]);
      await client.query('DELETE FROM truck_log_admin.login_limits WHERE key_hash=$1',[security.sha256('identifier:'+handle)]);
    }
    await client.query('INSERT INTO truck_log_admin.audit(action,target_id,detail) VALUES ($1,$2,$3)',
      [operation==='bootstrap'?'BOOTSTRAP_ADMIN':'RECOVER_USER',id,'Explicit local maintenance; OS/database access required']);
    return {id,username:handle,mustChangePassword:true};
  });
}
async function ask(question, secret=false) {
  let muted=false;
  const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
  output.isTTY=true;output.columns=process.stdout.columns;
  const r=readline.createInterface({input:process.stdin,output,terminal:true,historySize:0});
  return new Promise((resolve,reject)=>{
    r.on('SIGINT',()=>{r.close();reject(Error('Canceled.'));});
    r.question(question,value=>{muted=false;r.close();if(secret)process.stdout.write('\n');resolve(value);});
    muted=secret;
  });
}
async function main() {
  const args=process.argv.slice(2);
  check(args.length===1 && ['--migrate','--bootstrap','--recover','--verify'].includes(args[0]),
    'Usage: node tools/truck-log/admin-accounts.cjs --migrate|--bootstrap|--recover|--verify. Never place passwords in arguments.');
  check(process.stdin.isTTY && process.stdout.isTTY,'Run in an interactive local terminal; redirected/piped passwords are not accepted.');
  const {loadEnv}=await import('./env.mjs');loadEnv();
  const needed=n=>{check(process.env[n],'Missing '+n);return process.env[n];};
  const config={host:needed('TRUCK_LOG_DATABASE_HOST'),port:Number(needed('TRUCK_LOG_DATABASE_PORT')),
    database:needed('TRUCK_LOG_DATABASE_NAME'),user:needed('TRUCK_LOG_DATABASE_USERNAME'),password:needed('TRUCK_LOG_DATABASE_PASSWORD'),connectionTimeoutMillis:10000};
  if(process.env.TRUCK_LOG_DATABASE_SSL==='true') config.ssl={rejectUnauthorized:true,...(process.env.TRUCK_LOG_DATABASE_CA_FILE?{ca:fs.readFileSync(process.env.TRUCK_LOG_DATABASE_CA_FILE,'utf8')}:{})};
  const operation=args[0].slice(2);
  console.log('TRUCK LOG ADMIN LOCAL MAINTENANCE — no Dana Apps connection.');
  console.log('Selected database: '+config.database+' on '+config.host+':'+config.port);
  console.log('Keep a verified database backup before migration. Do not record/transcribe this terminal while entering passwords.');
  const confirmation=await ask('Type '+operation.toUpperCase()+' TRUCK LOG ADMIN to proceed: ');
  check(confirmation===operation.toUpperCase()+' TRUCK LOG ADMIN','Canceled; no database operation.');
  const {Client}=require('pg');const client=new Client(config);await client.connect();
  try {
    await ensureTruckLog(client);
    if(operation==='verify'){await verifySchema(client);console.log('[PASS] Admin schema verified.');return;}
    if(operation==='migrate'){const result=await migrate(client);console.log('[PASS] Admin-only schema '+result+'. No account has been created.');return;}
    const values={username:await ask('Truck Log username: ')};
    if(operation==='bootstrap'){values.displayName=await ask('Display name: ');values.email=await ask('Email alias (optional): ');}
    values.password=await ask('Temporary password (hidden; 15–128 characters): ',true);
    const repeat=await ask('Confirm temporary password (hidden): ',true);
    check(values.password===repeat,'Passwords differ; no account change.');
    try {await setupAccount(client,operation,values);}finally{values.password='';}
    console.log('[PASS] Truck Log account prepared. Password is not displayed or saved in a report. Change it at first sign-in using the configured authorized Truck Log origin.');
    console.log('This utility does not enable HTTP login, change proxy/TLS configuration, or restart any service.');
  } finally {await client.end();}
}
module.exports={verifySchema,transaction,ensureTruckLog,migrate,setupAccount};
if(require.main===module) main().catch(error=>{
  const known=error?.name==='AdminFault' || (error instanceof Error && !error.code);
  console.error('[FAIL] '+(known?error.message:'Admin local maintenance failed. Database details and secret parameters were not printed.'));
  process.exitCode=1;
});
