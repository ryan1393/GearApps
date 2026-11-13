import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSchemaSql } from '../../../../tools/truck-log/migration-sql.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const requiredFiles = [
  'SETUP-TRUCK-LOG.cmd',
  'SETUP-TRUCK-LOG.sh',
  'START-TRUCK-LOG.cmd',
  'START-TRUCK-LOG.sh',
  'STOP-TRUCK-LOG.cmd',
  'STOP-TRUCK-LOG.sh',
  'STATUS-TRUCK-LOG.cmd',
  'STATUS-TRUCK-LOG.sh',
  'LOGS-TRUCK-LOG.cmd',
  'LOGS-TRUCK-LOG.sh',
  'IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd',
  'IMPORT-TRUCK-LOG-REFERENCE-CSV.sh',
  'SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd',
  'SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.sh',
  'CLEAR-TRUCK-LOG-DATA.cmd',
  'CLEAR-TRUCK-LOG-DATA.sh',
  'LOAD-MOCK-DATA.cmd',
  'LOAD-MOCK-DATA.sh',
  'RESET-MOCK-DATA.cmd',
  'RESET-MOCK-DATA.sh',
  'CLEAR-MOCK-DATA.cmd',
  'CLEAR-MOCK-DATA.sh',
  'MOCK-DATA-STATUS.cmd',
  'MOCK-DATA-STATUS.sh',
  'BOOTSTRAP-RXO-BROWSER.cmd',
  'BOOTSTRAP-RXO-BROWSER.sh',
  'COLLECT-RXO-DIAGNOSTICS.cmd',
  'COLLECT-RXO-DIAGNOSTICS.sh',
  'RUN-TRUCK-LOG-FULL-LIVE-SCAN.cmd',
  'RUN-TRUCK-LOG-FULL-LIVE-SCAN.sh',
  'tools/truck-log/run-reference-tool-in-docker.cmd',
  'tools/truck-log/run-reference-tool-in-docker.sh',
  'tools/truck-log/compose-common.ps1',
  'tools/truck-log/compose-common.sh',
  'tools/truck-log/compose-control.ps1',
  'tools/truck-log/compose-control.sh',
  'SETUP-RXO-INTEGRATION-CREDENTIALS.cmd',
  'SETUP-RXO-INTEGRATION-CREDENTIALS.sh',
  'SETUP-RXO-EXPEDITE-CREDENTIALS.cmd',
  'SETUP-RXO-EXPEDITE-CREDENTIALS.sh',
  'docker/truck-log/server-entrypoint.sh',
  'RELEASE-MANIFEST.json',
  'VERSION',
  'docs/truck-log/VERSIONING.md',
  'docs/truck-log/ARCHITECTURE.md',
  'docs/truck-log/DEPLOYMENT.md',
];
for (const rel of requiredFiles) assert.ok(exists(rel), `Missing release file: ${rel}`);

assert.ok(!exists('.env'), 'A live .env file must not be shipped in the clean source package.');
assert.ok(!exists('node_modules'), 'node_modules must not be shipped in the clean source package.');
const shippedDocuments = fs.readdirSync(path.join(root, 'data', 'documents')).filter((name) => name !== '.gitkeep');
assert.deepEqual(shippedDocuments, [], 'Generated/runtime documents must not ship in the release package.');
assert.ok(!exists('CLEANUP-REPORT.md'), 'Internal cleanup report must not ship in the product release.');
assert.ok(!exists('reference-data-import/reference-data.csv'), 'A working reference-data.csv must not ship with sample people/carriers.');
for (const rel of ['.nx', '.runtime-logs', '.new-host-state', '_patch_backups']) {
  assert.ok(!exists(rel), `Generated/runtime directory must not be shipped: ${rel}`);
}

for (const rel of [
  'apps/rxo-integration/rxo-export.mjs',
  'apps/rxo-integration/test-once.ps1',
  'apps/rxo-integration/TEST-RXO-LEGACY-EXPORT.cmd',
  'tools/truck-log/apply-reference-data-upgrade.mjs',
  'tools/truck-log/rollback-reference-data-compatibility.mjs',
  'tools/truck-log/apply-rxo-ingestion-upgrade.mjs',
  'tools/truck-log/rollback-rxo-ingestion-upgrade.mjs',
  'tools/truck-log/apply-packing-slip-upgrade.mjs',
  'tools/truck-log/verify-packing-slip-upgrade.mjs',
  'docs/truck-log/reference-import-final',
  'tools/truck-log/reference-import',
  'tools/truck-log/new-host/setup.mjs',
  'tools/truck-log/bootstrap-database.mjs',
  'tools/truck-log/ensure-database.mjs',
  'tools/truck-log/verify-database.mjs',
]) {
  assert.ok(!exists(rel), `Retired patch/legacy artifact must not be shipped: ${rel}`);
}

const compose = read('docker-compose.yml');
const volumes = [
  'truck-log-postgres-data',
  'truck-log-documents',
  'truck-log-rxo-import',
  'truck-log-rxo-data',
  'truck-log-rxo-state',
  'truck-log-rxo-credentials',
  'truck-log-rxo-expedite-data',
  'truck-log-rxo-expedite-state',
];
for (const volume of volumes) assert.match(compose, new RegExp(`\\b${volume}:`), `Compose missing volume ${volume}`);
for (const service of ['truck-log-postgres', 'truck-log-server', 'truck-log-web', 'rxo-export', 'rxo-expedite-scheduler']) {
  assert.match(compose, new RegExp(`^  ${service}:`, 'm'), `Compose missing service ${service}`);
}
assert.match(compose, /TRUCK_LOG_ADMIN_ORIGIN:\s*"\$\{TRUCK_LOG_PUBLIC_ORIGIN:-http:\/\/localhost:4300\}"/,
  'Admin origin must remain portable through TRUCK_LOG_PUBLIC_ORIGIN.');

const setupPs = read('tools/truck-log/setup-docker.ps1');
const setupSh = read('SETUP-TRUCK-LOG.sh');
for (const setup of [setupPs, setupSh]) {
  assert.ok(!/docker\s+(?:volume\s+create|network\s+create)/i.test(setup),
    'Installers must rely on Compose resource provisioning, not manual Docker create calls.');
}
for (const setup of [setupPs, setupSh]) {
  assert.ok(setup.includes('TRUCK_LOG_DATABASE_SYNCHRONIZE'), 'Setup must force database synchronization off.');
  assert.ok(!/docker\s+(?:volume\s+rm|system\s+prune)|compose\s+down\s+-v/i.test(setup), 'Normal setup must not delete persistent Docker data.');
}
const composePs = read('tools/truck-log/compose-common.ps1');
const composeSh = read('tools/truck-log/compose-common.sh');
assert.match(composePs, /Docker Compose v2\+/, 'Windows compose resolver must require Compose v2+.');
assert.match(composeSh, /Docker Compose v2\+/, 'Linux compose resolver must require Compose v2+.');

const entrypoint = read('docker/truck-log/server-entrypoint.sh');
assert.ok(entrypoint.includes('node ./tools/truck-log/migrate.mjs'), 'Server entrypoint applies database migrations');

const serverDockerfile = read('docker/truck-log/server.Dockerfile');
assert.ok(serverDockerfile.includes('ENTRYPOINT ["./docker/truck-log/server-entrypoint.sh"]'), 'Server image must use centralized migration entrypoint.');
assert.ok(serverDockerfile.includes('COPY database/truck-log/migrations ./database/truck-log/migrations'), 'Server image must contain the migrations.');
assert.ok(serverDockerfile.includes('tools/truck-log/migrate.mjs'), 'Server image must contain the migration runner.');
assert.ok(serverDockerfile.includes('COPY tools/truck-log/reference-csv ./tools/truck-log/reference-csv'), 'Server image must contain Docker-safe reference-data runtime tools.');
assert.ok(serverDockerfile.includes('tools/truck-log/sap-document-reset-safety.mjs'), 'Server image must contain the reset safety dependency used by the clear tool.');

const referenceDockerCmd = read('tools/truck-log/run-reference-tool-in-docker.cmd');
const referenceDockerSh = read('tools/truck-log/run-reference-tool-in-docker.sh');
for (const runner of [referenceDockerCmd, referenceDockerSh]) {
  assert.match(runner, /truck-log-server/, 'Reference-data Docker runner must execute inside the Truck Log server container.');
  assert.match(runner, /import-reference-data-csv\.mjs/, 'Reference-data Docker runner must support CSV import.');
  assert.match(runner, /sync-authoritative-docks\.mjs/, 'Reference-data Docker runner must support authoritative dock sync.');
  assert.match(runner, /clear-truck-log-data\.mjs/, 'Reference-data Docker runner must support controlled data clear.');
}
for (const rel of ['IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd','SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd','CLEAR-TRUCK-LOG-DATA.cmd']) {
  const text = read(rel);
  assert.ok(!/(^|[ @])node(?:\.exe)?\s+/im.test(text), `${rel} must not require host Node.js for Docker runtime operations.`);
  assert.match(text, /run-reference-tool-in-docker\.cmd/i, `${rel} must delegate to the Docker-safe reference runner.`);
}
for (const rel of ['IMPORT-TRUCK-LOG-REFERENCE-CSV.sh','SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.sh','CLEAR-TRUCK-LOG-DATA.sh']) {
  const text = read(rel);
  assert.match(text, /run-reference-tool-in-docker\.sh/, `${rel} must delegate to the Docker-safe reference runner.`);
}
assert.ok(!referenceDockerCmd.includes('clear-truck-log-data.mjs --yes'), 'Windows Docker runner must not bypass the clear tool confirmation.');
assert.ok(!referenceDockerSh.includes('clear-truck-log-data.mjs --yes'), 'Linux Docker runner must not bypass the clear tool confirmation.');
assert.match(read('tools/truck-log/reference-csv/clear-truck-log-data.mjs'), /Type CLEAR to permanently clear/, 'Database clear tool must require explicit destructive confirmation after its rollback-only preflight.');

for (const rel of ['LOAD-MOCK-DATA.cmd','RESET-MOCK-DATA.cmd','CLEAR-MOCK-DATA.cmd','MOCK-DATA-STATUS.cmd']) {
  const text = read(rel);
  assert.ok(!/(^|[ @])node(?:\.exe)?\s+/im.test(text), `${rel} must not require host Node.js for Docker runtime operations.`);
}
for (const rel of ['LOAD-MOCK-DATA.sh','RESET-MOCK-DATA.sh','CLEAR-MOCK-DATA.sh','MOCK-DATA-STATUS.sh']) {
  const text = read(rel);
  assert.match(text, /run-mock-data-in-docker\.sh/, `${rel} must delegate to the Docker-safe mock-data runner.`);
}

const devSetup = read('tools/truck-log/setup-truck-log.ps1');
for (const project of ['truck-log', 'truck-log-server', 'truck-log-shared-contracts', 'rxo-integration', 'rxo-expedite']) {
  assert.ok(devSetup.includes(`'${project}'`), `Development setup must verify Nx project ${project}.`);
}
assert.ok(devSetup.includes('npm run build') && devSetup.includes('npm run typecheck:workspace'), 'Development setup must build and type-check the complete Nx workspace.');
assert.ok(!/ensure-database|bootstrap-database|CREATE DATABASE/i.test(devSetup), 'Development workspace setup must not mutate a database.');
const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.scripts['setup:development'], 'powershell -NoProfile -ExecutionPolicy Bypass -File ./tools/truck-log/setup-truck-log.ps1');
assert.equal(packageJson.scripts['start:development'], 'powershell -NoProfile -ExecutionPolicy Bypass -File ./tools/truck-log/start-truck-log.ps1');
assert.ok(!('setup:truck-log' in packageJson.scripts) && !('start:truck-log' in packageJson.scripts), 'Ambiguous old development script names must not return.');

const envExample = read('.env.example');
assert.match(envExample, /TRUCK_LOG_DATABASE_PASSWORD=CHANGE_ME/, 'Template DB password must be non-working placeholder.');
assert.match(envExample, /TRUCK_LOG_DATABASE_SYNCHRONIZE=false/, 'Template must disable TypeORM synchronization.');

const release = JSON.parse(read('RELEASE-MANIFEST.json'));
const VERSION = read('VERSION').trim();
assert.equal(release.release, VERSION);
assert.equal(release.releaseId, `truck-log-${VERSION}`);
assert.equal(release.docker.project, 'truck-log');
assert.equal(release.docker.network, 'truck-log');
assert.equal(release.docker.networkKey, 'truck-log');
assert.equal(release.docker.imageTag, VERSION);
assert.deepEqual(release.persistentVolumes, volumes);
assert.deepEqual(release.databaseMigrations, fs.readdirSync(path.join(root, 'database/truck-log/migrations')).sort());
assert.equal(release.secretsIncluded, false);
assert.equal(release.runtimeDataIncluded, false);
assert.equal(release.historicalPatchBackupsIncluded, false);
assert.equal(release.historicalPromotionRecordsIncluded, false);
assert.equal(release.hostRequirements.hostNodeRequiredForCoreDockerRuntime, false);
assert.equal(release.operationalUtilities.referenceDataRunsInsideServerContainer, true);
assert.equal(release.operationalUtilities.referenceDataImport.windows, 'IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd');
assert.equal(release.operationalUtilities.referenceDataImport.linux, 'IMPORT-TRUCK-LOG-REFERENCE-CSV.sh');
assert.deepEqual(release.operationalUtilities.mockData.windows, ['LOAD-MOCK-DATA.cmd','RESET-MOCK-DATA.cmd','CLEAR-MOCK-DATA.cmd','MOCK-DATA-STATUS.cmd']);
assert.deepEqual(release.operationalUtilities.mockData.linux, ['./LOAD-MOCK-DATA.sh','./RESET-MOCK-DATA.sh','./CLEAR-MOCK-DATA.sh','./MOCK-DATA-STATUS.sh']);
assert.equal(release.operationalUtilities.mockData.runsInsideServerContainer, true);
assert.equal(release.operationalUtilities.rxoCredentials.standard.windows, 'SETUP-RXO-INTEGRATION-CREDENTIALS.cmd');
assert.equal(release.operationalUtilities.rxoCredentials.standard.linux, 'SETUP-RXO-INTEGRATION-CREDENTIALS.sh');
assert.equal(release.operationalUtilities.rxoCredentials.expedite.windows, 'SETUP-RXO-EXPEDITE-CREDENTIALS.cmd');
assert.equal(release.operationalUtilities.rxoCredentials.expedite.linux, 'SETUP-RXO-EXPEDITE-CREDENTIALS.sh');
assert.equal(release.operationalUtilities.optionalDiagnostics.requiresNode20, true);
assert.equal(release.operationalUtilities.optionalDiagnostics.browserBootstrap.linux, 'BOOTSTRAP-RXO-BROWSER.sh');
assert.equal(release.operationalUtilities.optionalDiagnostics.rxoDiagnostics.linux, 'COLLECT-RXO-DIAGNOSTICS.sh');
assert.equal(release.operationalUtilities.optionalDiagnostics.fullLiveScan.linux, 'RUN-TRUCK-LOG-FULL-LIVE-SCAN.sh');
assert.equal(release.freshDatabaseSeed.siteName, 'Dana Fort Wayne Plant');
assert.deepEqual(release.freshDatabaseSeed.dockCodes, ['7','25','28','41','49','52','61','62','68']);
const baseMigration = readSchemaSql();
assert.match(baseMigration, /'site_name', 'Dana Fort Wayne Plant'/, 'Fresh database must seed the Fort Wayne site identity.');
for (const code of release.freshDatabaseSeed.dockCodes) assert.match(baseMigration, new RegExp(`\\(\\d+, '${code}',`), `Fresh database missing dock ${code}.`);

const forbiddenSuffixes = [/\.ts\.txt$/i, /\.v\d+r\d+.*-tmp-/i, /\.bak(?:-|$)/i];
const forbiddenDirs = new Set(['node_modules', '.nx', '.runtime-logs', '.new-host-state', '_patch_backups']);
const problems = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (forbiddenDirs.has(entry.name)) { problems.push(path.relative(root, path.join(dir, entry.name))); continue; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && forbiddenSuffixes.some((pattern) => pattern.test(entry.name))) problems.push(path.relative(root, full));
  }
}
walk(root);
assert.deepEqual(problems, [], `Stale backup/temp files remain: ${problems.join(', ')}`);


assert.equal(JSON.parse(read('package.json')).version, VERSION);
assert.match(compose, /^name:\s+truck-log$/m, 'Compose project name must be uniquely truck-log.');
for (const image of ['truck-log-server','truck-log-web','truck-log-rxo-export','truck-log-rxo-browser','truck-log-rxo-expedite']) {
  assert.match(compose, compose.includes(`image: ${image}:\${TRUCK_LOG_RELEASE:-${VERSION}}`) ? /./ : /^$/, `Compose image ${image} must use release ${VERSION}`);
}

console.log(`[PASS] Truck Log ${VERSION} release-package contract: ${requiredFiles.length} required files, ${volumes.length} volumes, ${release.databaseMigrations.length} migrations.`);
