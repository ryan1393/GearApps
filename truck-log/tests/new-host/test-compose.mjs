import assert from 'node:assert/strict';
import fs from 'node:fs';
const RELEASE = (await import('node:fs')).readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
// This test intentionally uses only Node core libraries, no Docker Engine required.
const root = process.cwd();
const read=(n)=>fs.readFileSync(n,'utf8');
const compose=read('docker-compose.yml');
const env=read('.env.example');
const setup=read('SETUP-TRUCK-LOG.sh');
const composeWin=read('tools/truck-log/compose-common.ps1');
// Exporter container lookup lives in the control service's Docker runtime.
const rxoweb=read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.service.ts')+read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control-runtime.ts');
const cleaner=read('apps/rxo-integration/start-integrated.ps1');
const manifest=JSON.parse(read('RELEASE-MANIFEST.json'));
assert.match(compose,/^name: truck-log$/m);
assert.match(compose,/\$\{TRUCK_LOG_API_PORT:-3334\}:3334/);
assert.match(compose,/\$\{TRUCK_LOG_WEB_PORT:-4300\}:80/);
assert.match(compose,/127\.0\.0\.1:\$\{TRUCK_LOG_RXO_BROWSER_PORT:-6080\}:6080/);
for(const [k,v] of [['TRUCK_LOG_API_PORT','3334'],['TRUCK_LOG_WEB_PORT','4300']])assert.match(env,new RegExp(`^${k}=${v}$`,'m'));
for(const n of ['postgres','server','web','rxo-export','rxo-browser','rxo-expedite-scheduler'])
 assert.match(compose,new RegExp(`container_name: truck-log-${n}\\n`));
for(const n of manifest.persistentVolumes){
 assert.ok(n.startsWith('truck-log-'));assert.ok(compose.includes(n+':'));assert.ok(compose.includes('name: '+n));
}
assert.match(compose,/TRUCK_LOG_DOCKER_PROJECT: "truck-log"/);
assert.match(rxoweb,/label=com\.docker\.compose\.project=/);
assert.match(cleaner,/label=com\.docker\.compose\.project=truck-log/);
assert.match(composeWin,/docker compose -p truck-log @CommandArgs/);
assert.match(read('tools/truck-log/compose-common.sh'),/docker compose -p truck-log "\$@"/);
// Regression: the API's read-only Expedite helper must run THIS isolated
// deployment's image and volumes. The scheduler can be healthy while the API
// status endpoint fails if this image tag drifts from Compose.
// The Expedite API's Docker image/volume boundary lives in rxo-expedite-docker.ts.
const expediteApi = read('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite-docker.ts');
assert.ok(compose.includes(`image: truck-log-rxo-expedite:\${TRUCK_LOG_RELEASE:-${RELEASE}}`));
assert.ok(expediteApi.includes("const IMAGE = `truck-log-rxo-expedite:${process.env.TRUCK_LOG_RELEASE || '"+RELEASE+"'}`;"));
assert.match(expediteApi, /const DATA_VOLUME = 'truck-log-rxo-expedite-data';/);
assert.match(expediteApi, /TRUCK_LOG_RXO_DOCKER_CREDENTIAL_VOLUME', 'truck-log-rxo-credentials'/);
const expediteApiTests = read('tools/truck-log/expedite/api-test.cjs');
for (const value of [
  `truck-log-rxo-expedite:${RELEASE}`,
  'truck-log-rxo-expedite-data:/app/data:ro',
  'truck-log-rxo-credentials:/run/secrets:ro',
]) assert.ok(expediteApiTests.includes(value), `Expedite test is not aligned with ${value}`);

assert.equal(manifest.deployment.webPortDefault,4300);
assert.equal(manifest.deployment.apiPortDefault,3334);
assert.equal(manifest.docker.project,'truck-log');
assert.match(compose,/  truck-log:\n    name: truck-log\n    driver: bridge/m);
assert.ok(!/\bexternal:\s*true\b/.test(compose));
// The root docker-compose.yml is the only Compose file; the RXO scripts use it.
assert.ok(!fs.existsSync('apps/rxo-integration/docker-compose.yml'),'nested RXO compose file must not return');
assert.match(read('apps/rxo-integration/remote-docker.ps1'),/compose-common\.ps1/);
assert.match(read('apps/rxo-integration/start.ps1'),/Invoke-RxoCompose -CommandArgs @\('up', '-d', '--build', 'rxo-export'\)/);
assert.ok(!/docker\s+(?:network|volume)\s+create/i.test(setup));
assert.ok(!/docker\s+(?:network|volume)\s+create/i.test(read('tools/truck-log/setup-docker.ps1')));
assert.equal(manifest.docker.network,'truck-log');
const nginx = read('docker/truck-log/nginx.conf');
assert.match(nginx,/resolver\s+127\.0\.0\.11\s+valid=10s\s+ipv6=off;/,'Nginx must use Docker DNS for runtime API lookup');
assert.match(nginx,/set\s+\$truck_log_api_backend\s+truck-log-server:3334;/,'Nginx must point to the isolated API container');
assert.match(nginx,/proxy_pass\s+http:\/\/\$truck_log_api_backend;/,'Nginx must defer resolving the upstream until an API request');
assert.ok(!nginx.includes('proxy_pass http://truck-log-server:3334;'),'Old static upstream causes web restart loops');
assert.match(compose,/^  truck-log-server:\n/m,'nginx reaches the API by its Compose service name truck-log-server');
// Expedite login changes follow the administrator sign-in origin unless a dedicated origin is set.
const expediteService=read('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.service.ts');
assert.match(expediteService,/const raw = dedicated \|\| this\.config\.get<string>\('TRUCK_LOG_ADMIN_ORIGIN', ''\);/);
assert.match(expediteService,/\(!dedicated && this\.config\.get<string>\('TRUCK_LOG_ADMIN_TRANSPORT', 'https'\) === 'internal-http'\)/);
assert.match(read('libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.controller.ts'),/@TruckLogAdminWrites\(\)\n@Controller\('rxo\/expedite'\)/,'Expedite changes still require an administrator');
assert.ok(!fs.existsSync('.env'));
console.log('[PASS] Compose contracts (ports/project/volumes/credential and container boundaries).');
