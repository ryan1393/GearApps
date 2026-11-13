import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (s) => fs.readFileSync(path.join(ROOT,s),'utf8');
const exists = (s) => fs.existsSync(path.join(ROOT,s));
const must = (s) => assert.ok(exists(s), `Missing supported workflow source: ${s}`);
const checks = [
 'SETUP-TRUCK-LOG.sh','SETUP-TRUCK-LOG.cmd',
 'SETUP-TRUCK-LOG-ADMIN.sh','SETUP-TRUCK-LOG-ADMIN.cmd',
 'VERIFY-RXO-WEB-SETUP.sh','docs/truck-log/RXO-WEB-CREDENTIAL-SETUP.md',
 'tools/truck-log/admin-accounts.cjs','tools/truck-log/admin-auth-core.cjs',
 'database/truck-log/migrations/0001_baseline.sql',
 'apps/rxo-expedite/src/lib/credentials.mjs',
 'apps/rxo-integration/src/lib/rxo-auth.mjs',
 'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.controller.ts',
 'libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.controller.ts',
 'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.html',
 'libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.component.ts',
 'libs/truck-log/server/feature/driver-print',
 'libs/truck-log/server/feature/visits',
 'libs/truck-log/server/feature/rxo-documents',
 'libs/truck-log/server/feature/scheduled-loads',
 'libs/truck-log/web/feature/check-in',
 'libs/truck-log/web/feature/tv-display',
 'libs/truck-log/web/feature/admin',
 'libs/truck-log/web/feature/rxo-control-center',
 'libs/truck-log/web/feature/rxo-expedite-control-center',
];
checks.forEach(must);
const docker = source('docker/truck-log/server.Dockerfile');
const copied = docker.split('\n').filter((line) => line.startsWith('COPY ')).join('\n');
for(const f of ['tools/truck-log/admin-accounts.cjs','tools/truck-log/admin-auth-core.cjs','tools/truck-log/migrate.mjs','database/truck-log/migrations'])
  assert.ok(copied.includes(`${f} `), `Admin setup missing from runtime Docker image: ${f}`);
const entrypoint = source('docker/truck-log/server-entrypoint.sh');
assert.ok(!entrypoint.includes('admin-accounts.cjs'), 'Privileged admin setup must never run implicitly');
const compose = source('docker-compose.yml');
for(const name of ['truck-log-postgres','truck-log-server','truck-log-web','rxo-export','rxo-browser','rxo-expedite-scheduler','rxo-expedite'])
  assert.match(compose,new RegExp(`\\n  ${name}:`), `Missing Docker service ${name}`);
for(const vol of ['truck-log-postgres-data','truck-log-documents','truck-log-rxo-import','truck-log-rxo-data','truck-log-rxo-state','truck-log-rxo-credentials','truck-log-rxo-expedite-data','truck-log-rxo-expedite-state'])
  assert.ok(compose.includes(`${vol}:`),`Missing persistent Docker volume ${vol}`);
assert.match(entrypoint, /node \.\/tools\/truck-log\/migrate\.mjs/, 'Server entrypoint applies database migrations before starting');
assert.ok(entrypoint.indexOf('migrate.mjs') < entrypoint.indexOf('exec node'), 'Migrations run before the API starts');
assert.match(source('SETUP-TRUCK-LOG-ADMIN.sh'),/truck_log_compose exec truck-log-server/);
assert.match(source('SETUP-TRUCK-LOG-ADMIN.sh'),/--bootstrap/);
assert.match(source('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.controller.ts'),/@Put\('credentials'\)/);
assert.match(source('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.controller.ts'),/@Put\('credentials'\)/);
const creds = await import(pathToFileURL(path.join(ROOT,'apps/rxo-expedite/src/lib/credentials.mjs')).href);
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'truck-log-rxo-web-audit-'));
try {
  const standardUser = path.join(temp,'rxo_username');
  const standardPass = path.join(temp,'rxo_password');
  fs.writeFileSync(standardUser,'standard-user',{mode:0o600});
  fs.writeFileSync(standardPass,'standard-secret',{mode:0o600});
  assert.deepEqual(creds.credentialStatus(temp),{username:'',usernameConfigured:false,passwordConfigured:false,configured:false});
  const first=creds.saveCredentials({username:'expedite-user',password:'expedite-secret'},temp);
  assert.equal(first.configured,true);
  assert.equal(first.passwordUpdated,true);
  assert.equal(creds.readCredentials(temp).password,'expedite-secret');
  const second=creds.saveCredentials({username:'expedite-updated'},temp);
  assert.equal(second.passwordUpdated,false);
  assert.equal(creds.readCredentials(temp).username,'expedite-updated');
  assert.equal(creds.readCredentials(temp).password,'expedite-secret');
  assert.equal(fs.readFileSync(standardUser,'utf8'),'standard-user','Expedite must never overwrite Standard RXO');
  assert.equal(fs.readFileSync(standardPass,'utf8'),'standard-secret','Expedite must never overwrite Standard RXO');
  const pointer=JSON.parse(fs.readFileSync(path.join(temp,'rxo_expedite_current.json'),'utf8'));
  assert.match(pointer.generation,/^[a-f0-9-]{36}$/);
  const secretDir=path.join(temp,'rxo_expedite_versions',pointer.generation);
  for (const f of ['rxo_expedite_username','rxo_expedite_password'])
    assert.equal(fs.statSync(path.join(secretDir,f)).mode&0o777,0o600);
  const exposed=JSON.stringify(creds.credentialStatus(temp));
  assert.ok(!exposed.includes('expedite-secret'));
  console.log('[PASS] Separate Standard / Expedite storage, updates, permissions and redacted status');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log(`[PASS] RXO web provision/feature contracts (${checks.length} required source paths); no Docker/HTTP/real RXO invoked`);
