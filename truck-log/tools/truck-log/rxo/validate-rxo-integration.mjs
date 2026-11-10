import { currentRuntime } from './current-runtime-contract.mjs';
import { readExporterSource, readSchedulerSource } from './runtime-sources.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'apps', 'rxo-integration');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const json = rel => JSON.parse(read(rel));

for (const relative of [
  'project.json','package.json','Dockerfile','Dockerfile.dockerignore','RUNTIME-MANIFEST.json',
  'src/rxo-scheduler.mjs','src/rxo-fort-wayne-export.mjs','src/lib/rxo-export-config.mjs','src/lib/rxo-export-browser.mjs','src/lib/rxo-export-download.mjs','src/lib/rxo-export-dataset.mjs','src/lib/rxo-export-batch.mjs','src/lib/rxo-export-login.mjs','src/lib/rxo-export-date-filter.mjs','src/lib/rxo-export-merge.mjs','src/lib/rxo-filter-options.mjs','src/lib/rxo-scheduler-support.mjs','src/lib/rxo-export-runtime.mjs','src/lib/rxo-export-data.mjs','src/lib/rxo-export-publication.mjs','src/lib/rxo-filter-common.mjs','src/lib/rxo-filter-input.mjs','src/lib/rxo-filter-selection.mjs','src/lib/rxo-filter-panel.mjs','src/lib/rxo-filter-readiness.mjs','src/lib/rxo-filter-ui.mjs','src/lib/rxo-overlay-ui.mjs','src/rxo-filter-test.mjs','src/playwright-preflight.mjs',
  'remote-docker.ps1','test-production-export.ps1','start-integrated.ps1','status-integrated.ps1',
  'sync-latest-to-truck-log.ps1','README.md','src/lib/rxo-auth.mjs'
]) {
  if (!fs.existsSync(path.join(appRoot, relative))) throw new Error(`Missing RXO integration file: ${relative}`);
}

if (fs.existsSync(path.join(appRoot, 'docker-compose.yml'))) throw new Error('apps/rxo-integration/docker-compose.yml must not exist; RXO uses the root docker-compose.yml.');
// remote-docker.ps1 implements Invoke-RxoCompose (root file, -p truck-log, Compose v2 via compose-common.ps1).
for (const script of fs.readdirSync(appRoot).filter(name => /\.(ps1|cmd)$/i.test(name) && name !== 'remote-docker.ps1')) {
  const text = read(script);
  if (/^\s*&?\s*docker-compose\s/im.test(text) || /cmd\.exe[^\n]*docker-compose/i.test(text)) throw new Error(`${script} must use the root compose through Invoke-RxoCompose/rxo-compose-control, not a direct docker-compose call.`);
}
const project = json('project.json');
if (project.name !== 'rxo-integration' || project.sourceRoot !== 'apps/rxo-integration/src') throw new Error('RXO Nx project/sourceRoot contract is incorrect.');
for (const target of ['build','validate','test-production','verify-latest','start','status','sync-latest']) {
  if (!project.targets?.[target]) throw new Error(`rxo-integration is missing Nx target: ${target}`);
}
const pkg = json('package.json');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (pkg.version !== version || pkg.scripts?.start !== 'node src/rxo-scheduler.mjs') throw new Error('RXO package release/start contract is incorrect.');
const exporter = readExporterSource(root);
for (const marker of ['12808','DANA_USA_FORT_WAYNE_IN','10000',"'Origin'","'OUTBOUND'","'Destination'","'INBOUND'"]) {
  if (!exporter.includes(marker)) throw new Error(`RXO exporter marker missing: ${marker}`);
}
const scheduler = readSchedulerSource(root);
for (const marker of ['scheduler-status.json','scheduler-recovery.log','schedulerHeartbeatAt','maxScanDurationMinutes','noProgressTimeoutMinutes','STALL_DETECTED','RECOVERING','RETRYING','NEEDS_REVIEW',"[EXPORTER, '--once']"]) {
  if (!scheduler.includes(marker)) throw new Error(`RXO scheduler marker missing: ${marker}`);
}
if (!scheduler.includes("process.env.TRUCK_LOG_RELEASE || '1.0.5'")) throw new Error('RXO scheduler release fallback does not match VERSION.');
const dockerfile = read('Dockerfile');
for (const marker of ['TRUCK_LOG_RELEASE=' + version,'COPY apps/rxo-integration/src ./src','COPY libs/truck-log/rxo-shared/ ./src/lib/','CMD ["node", "src/rxo-scheduler.mjs"]','RXO_MAX_SCAN_DURATION_MINUTES=30','RXO_NO_PROGRESS_TIMEOUT_MINUTES=15']) {
  if (!dockerfile.includes(marker)) throw new Error(`RXO Dockerfile marker missing: ${marker}`);
}
currentRuntime(root);
console.log('[PASS] Truck Log RXO current-runtime contract.');
