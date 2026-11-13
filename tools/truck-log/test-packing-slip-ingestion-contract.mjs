import fs from 'node:fs';
import path from 'node:path';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';
const RELEASE = (await import('node:fs')).readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
let passed = 0;
function must(condition, message) {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  passed += 1;
}
function has(source, marker, message) {
  must(source.includes(marker), message);
}

const migration = readSchemaSql();
for (const marker of [
  'ck_visit_documents_print_agent_capture',
  'ck_visit_documents_validated_packing_slip',
  "source_kind <> 'PRINT_AGENT'",
  "extracted_document_id ~ '^[0-9]{8}$'",
  "validation_rule_version = 'PACKING_SLIP_V1'",
]) must(schemaIncludes(marker), `migration includes ${marker}`);
must(!schemaIncludes('DROP TABLE'), 'migration never drops a table');
must(!schemaIncludes('TRUNCATE'), 'migration never truncates data');

const dto = read('libs/truck-log/server/feature/print-agents/src/lib/dto/packing-slip-ingestion.dto.ts');
for (const marker of [
  'sourceCaptureId', "documentType: 'PACKING_SLIP'", 'sapDocumentId',
  "'PYPDF_TEXT'", "'PYMUPDF_TEXT'", "'OCR'", 'positiveMarkersFound',
  'identifierCandidates', 'confidence', 'route', 'sourceQueue', 'outputPrinter',
  'capturedAt', 'printStatus', 'printError', 'clientReportedSha256',
  'metadata exceeds the 64 KiB limit', 'unsupported fields',
  'more than five minutes in the future', '64 lowercase hexadecimal',
]) has(dto, marker, `metadata contract includes ${marker}`);

const controller = read('libs/truck-log/server/feature/print-agents/src/lib/print-agents.controller.ts');
for (const marker of [
  "@Post('documents/packing-slip')", "@PrintAgentScope('documents:upload')",
  '@UseGuards(PrintAgentAuthGuard)', "FileInterceptor('file'", 'files: 1',
  'fields: 1', 'fileSize: 25 * 1024 * 1024', 'fieldSize: 64 * 1024',
  "@Headers('x-idempotency-key')", "@Body('metadata')", '@UploadedFile()',
]) has(controller, marker, `controller boundary includes ${marker}`);

const service = read('libs/truck-log/server/feature/print-agents/src/lib/packing-slip-ingestion.service.ts');
for (const marker of [
  "new Set(['packing list', 'packing slip'])", "const DELIVERY_NUMBER_PATTERN = /^[0-9]{8}$/",
  'validCandidates.length === 1', 'reportedId === validCandidates[0]',
  'Multiple valid 8-digit Delivery Number', 'Truck Log did not guess',
  "endpoint: 'packing-slip'", "includes(Buffer.from('%%EOF'", 'clientReportedSha256 does not match',
  'pg_advisory_xact_lock', ':packing-slip:', ':idempotency:',
  "scopes @> '[\"documents:upload\"]'::jsonb", 'source_agent_id = $1 AND source_capture_id = $2',
  'different capture for this Print Agent', "source_kind, source_agent_id, source_capture_id",
  "'PRINT_AGENT_DOCUMENT_INGESTED'", "'NEEDS_REVIEW'", "'UNMATCHED'",
  "'UNMATCHED', NULL, NULL, NULL, NULL, FALSE", 'this.storage.deletePdf',
  'INSERT INTO print_agent_idempotency', 'UPDATE print_agents',
]) has(service, marker, `ingestion service includes ${marker}`);
must(service.indexOf('pg_advisory_xact_lock') < service.indexOf('FROM print_agent_idempotency'),
  'concurrent upload locks before idempotency lookup');
must(service.indexOf('FROM print_agent_idempotency') < service.indexOf('this.storage.storePdf'),
  'idempotent replay is resolved before writing another PDF');
must(service.indexOf('source_agent_id = $1 AND source_capture_id = $2') < service.indexOf('this.storage.storePdf'),
  'stable source capture is resolved before writing another PDF');
must(service.indexOf('INSERT INTO sap_document_events') < service.lastIndexOf('INSERT INTO print_agent_idempotency'),
  'audit event and response are committed in the same transaction');
must(!service.includes('truck_visit_id, $'), 'ingestion never accepts or guesses a Truck Log visit ID');
must(!service.includes('is_authoritative, TRUE'), 'unmatched ingestion never marks a document authoritative');

// The storage helper is split into store/paths/deletion modules; check them together.
const storage = ['sap-document-file-storage.ts', 'sap-document-storage-paths.ts', 'sap-document-file-deletion.ts']
  .map((name) => read('libs/truck-log/server/infrastructure/sap-documents/src/lib/' + name)).join('\n');
for (const marker of [
  'deleteStoredSapDocumentPdf',
  'resolveSapDocumentStoragePath',
  'deleteStoredImmutableDocumentFile',
  'fsConstants.O_NOFOLLOW',
  '`/proc/self/fd/${parentHandle.fd}/${parts[4]}`',
  "code !== 'ENOENT'",
]) {
  has(storage, marker, `rollback cleanup includes ${marker}`);
}

const provision = read('tools/truck-log/provision-print-agent.mjs');
has(provision, '["heartbeat", "documents:upload"]', 'new credentials retain the required heartbeat and upload scopes');
has(provision, '["print-jobs:poll", "documents:download", "print-jobs:report"]', 'new credentials receive the Driver Print Package scopes');
must(!provision.includes('credentials(key_id, agent_id, secret,'), 'credential provisioning still never stores a raw secret column');

const docker = read('docker/truck-log/server.Dockerfile');
for (const marker of [
  'COPY database/truck-log/migrations ./database/truck-log/migrations', `ARG TRUCK_LOG_RELEASE=${RELEASE}`,
]) has(docker, marker, `server image includes ${marker}`);

const packageSource = JSON.parse(read('package.json'));
for (const script of [
  'db:migrate', 'test:packing-slip-ingestion',
]) must(packageSource.scripts[script], `package exposes ${script}`);
must(packageSource.scripts['validate:all'].includes('test:packing-slip-ingestion'),
  'authoritative validation includes Phase 3 ingestion tests');

const rxo = read('apps/rxo-integration/src/rxo-fort-wayne-export.mjs');
const runtimeManifest = JSON.parse(read('apps/rxo-integration/RUNTIME-MANIFEST.json'));
must(rxo.length > 0 && runtimeManifest.release === RELEASE && runtimeManifest.files?.['apps/rxo-integration/src/rxo-fort-wayne-export.mjs']?.sha256,
  'RXO source and runtime manifest remain present');

console.log(`[PASS] Packing Slip ingestion Phase 3 contract: ${passed} checks passed.`);
