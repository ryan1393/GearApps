import fs from 'node:fs';
const RELEASE = (await import('node:fs')).readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

const read = (path) => fs.readFileSync(path, 'utf8');
let checks = 0;
function must(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
}

const serverDocker = read('docker/truck-log/server.Dockerfile');
const serverEntrypoint = read('docker/truck-log/server-entrypoint.sh');
const webDocker = read('docker/truck-log/web.Dockerfile');
const compose = read('docker-compose.yml');
const health = read('libs/truck-log/server/feature/health/src/lib/health.controller.ts');
const setup = read('tools/truck-log/setup-docker.ps1');
const packageSource = JSON.parse(read('package.json'));

must(serverDocker.includes('COPY database/truck-log/migrations ./database/truck-log/migrations'), 'server runtime contains the migrations');
must(serverDocker.includes('tools/truck-log/migrate.mjs'), 'server runtime contains the migration runner');
must(serverEntrypoint.indexOf('node ./tools/truck-log/migrate.mjs') >= 0
  && serverEntrypoint.indexOf('node ./tools/truck-log/migrate.mjs') < serverEntrypoint.indexOf('exec node'), 'server applies migrations before starting the API');

must(
  compose.includes('condition: service_healthy'),
  'web startup waits for server readiness',
);
must(
  compose.includes('start_period: 180s'),
  'server health allows the controlled migration chain to complete before retries count',
);

for (const marker of [
  "const RELEASE_VERSION = process.env.TRUCK_LOG_RELEASE || TRUCK_LOG_VERSION",
  'truck_log_access_credentials',
  'truck_log_access_idempotency',
  'driver_print_packages',
  'driver_print_items',
  'driver_print_attempts',
  'driver_print_events',
  'ck_truck_log_access_credentials_scopes',
  'ck_print_agent_idempotency_no_claim_token',
  'ck_visit_documents_print_agent_capture',
  'ck_visit_documents_validated_packing_slip',
  'ck_visit_documents_materials_upload',
  'ux_visit_documents_rxo_active',
  'ux_driver_print_packages_original_visit',
  'trg_truck_visits_rxo_identity',
  'trg_visit_documents_rxo_immutable',
  'trg_driver_print_events_append_only',
  "namespace_row.nspname = 'public'",
  'index_row.indisvalid = TRUE',
  "trigger_row.tgenabled <> 'D'",
  "const rxoStorageRoot = resolve(storageRoot, 'rxo')",
  "rxoDocumentStorage: 'ready'",
  "accessCredentials: 'ready'",
  "rxoDriverDocuments: 'ready'",
  "driverPrintPackages: 'ready'",
  'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET',
]) {
  must(health.includes(marker), `readiness contract contains ${marker}`);
}

must(
  packageSource.scripts['test:rxo-storage-hardening'] ===
    'node tools/truck-log/test-rxo-storage-hardening-contract.mjs',
  'package exposes the executable RXO storage hardening contract',
);
must(
  packageSource.scripts['validate:all'].includes('test:rxo-storage-hardening'),
  'authoritative validation includes RXO storage hardening',
);
must(
  [
    'RandomNumberGenerator]::Create()',
    'Duplicate .env key:',
    "'^[0-9a-fA-F]{64}$'",
    'Generated Print Agent claim-token signing secret in .env.',
  ].every((marker) => setup.includes(marker)),
  'fresh setup generates once and validates the required claim-token secret',
);
must(
  !/Write-Host[^\r\n]*\$ClaimSecret(?:\s|$)/.test(setup),
  'fresh setup never displays the claim-token secret value',
);

console.log(`[PASS] Truck Log release plumbing contract: ${checks} checks passed.`);
