import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';
import { schemaSource, schemaIncludes } from './migration-sql.mjs';
const ts = createRequire(import.meta.url)('typescript');

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');
const compact = (source) => source.replace(/\s+/g, ' ').trim();

function loadTypeScriptModule(relativePath) {
  const fileName = path.join(root, relativePath);
  const result = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(
      `[FAIL] could not compile ${relativePath}: ${errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('; ')}`,
    );
  }
  const moduleRecord = { exports: {} };
  const localRequire = createRequire(fileName);
  const evaluate = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    result.outputText,
  );
  evaluate(
    moduleRecord.exports,
    localRequire,
    moduleRecord,
    fileName,
    path.dirname(fileName),
  );
  return moduleRecord.exports;
}

let passed = 0;

function must(condition, message) {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  passed += 1;
}

function has(source, marker, message) {
  must(source.includes(marker), message);
}

function hasAll(source, markers, message) {
  must(markers.every((marker) => source.includes(marker)), message);
}

function ordered(source, markers, message) {
  let cursor = -1;
  for (const marker of markers) {
    cursor = source.indexOf(marker, cursor + 1);
    if (cursor === -1) {
      must(false, `${message} (missing or out of order: ${marker})`);
    }
  }
  must(true, message);
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  must(startIndex >= 0 && endIndex > startIndex, `source section exists: ${start}`);
  return source.slice(startIndex, endIndex);
}

const migration = schemaSource();
const migrationCompact = compact(String(migration));
const lockHelper = read(
  'libs/truck-log/server/domain/rxo/src/lib/rxo-document-lock.ts',
);
const rxoController = read(
  'libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.controller.ts',
);
// The RXO Documents service is split into query/upload/idempotency modules in the same lib.
const rxoService = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-documents/src/lib',
  ['.ts'],
);
const rxoDocumentsFeature = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-documents/src/lib',
  ['.ts'],
);
const driverController = read(
  'libs/truck-log/server/feature/driver-print/src/lib/driver-print.controller.ts',
);
// Print Agent downloads read RXO PDFs through the shared verified reader.
const driverService = readFeatureSource(
  root,
  'libs/truck-log/server/domain/driver-print/src/lib',
  ['.ts'],
) + read('libs/truck-log/server/infrastructure/sap-documents/src/lib/verified-rxo-pdf-reader.ts');
const claimTokenHelper = read(
  'libs/truck-log/server/domain/driver-print/src/lib/print-agent-claim-token.ts',
);
const printAgentController = read(
  'libs/truck-log/server/feature/print-agents/src/lib/print-agents.controller.ts',
);
// The guard's constant-time digest comparison lives in the shared data-access helper it imports.
const printAgentGuard = read(
  'libs/truck-log/server/auth/print-agent/src/lib/print-agent-auth.guard.ts',
) + read('libs/truck-log/server/data-access/src/lib/support/request-integrity.ts');
const printAgentProvision = read(
  'tools/truck-log/provision-print-agent.mjs',
);
const visitDto = read(
  'libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts',
);
const visitEntity = read(
  'libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts',
);
const visitService = readFeatureSource(
  root,
  'libs/truck-log/server/feature/visits/src/lib',
  ['.ts'],
);
const rxoIngestionService = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-ingestion/src/lib',
  ['.ts'],
);
const rxoAvailability = read(
  'libs/truck-log/server/domain/rxo/src/lib/rxo-load-availability.ts',
);
const checkIn = readFeatureSource(
  root,
  'libs/truck-log/web/feature/check-in/src/lib',
  ['.ts', '.html'],
);
const controlCenter = readFeatureSource(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib',
  ['.ts', '.html', '.css'],
) + read('libs/truck-log/web/data-access/src/lib/pdf-upload.ts'); // shared browser PDF checks
const history = read(
  'libs/truck-log/web/feature/history/src/lib/history.component.ts',
);
const webApi = read(
  'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts',
);
const storageService = read(
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage.service.ts',
);
// The storage helper is split into store/paths/deletion modules; check them together.
const storageFunctions = ['sap-document-file-storage.ts', 'sap-document-storage-paths.ts', 'sap-document-file-deletion.ts']
  .map((name) => read('libs/truck-log/server/infrastructure/sap-documents/src/lib/' + name)).join('\n');
const compose = read('docker-compose.yml');
const envExample = read('.env.example');

// The migration is additive and binds every RXO relationship to the complete,
// canonical tuple. Shipment/load number alone is never a safe association key.
must(!/\bDROP\s+TABLE\b/i.test(migration), 'migration never drops a table');
must(!/\bTRUNCATE\b/i.test(migration), 'migration never truncates business data');
hasAll(
  migration,
  [
    'rxo_site_key VARCHAR(80)',
    'rxo_shipment_id VARCHAR(120)',
    'rxo_direction VARCHAR(20)',
    'ck_truck_visits_rxo_tuple',
    "rxo_direction IN ('INBOUND', 'OUTBOUND')",
    'rxo_direction = direction',
    'rxo_site_key = LOWER(BTRIM(rxo_site_key))',
    'rxo_shipment_id = UPPER(BTRIM(rxo_shipment_id))',
  ],
  'database ownership uses a complete canonical site/shipment/direction tuple',
);
hasAll(
  visitService,
  [
    'RXO site, shipment, and direction must be supplied together.',
    'RXO shipment direction must match the truck visit direction.',
    'RXO shipment identity must exactly match the selected Load Number.',
    'rxoSelectionSql(rxoIdentity.siteKey)',
    'exactShipments.length !== 1',
    'Truck Log did not guess a visit association.',
  ],
  'visit creation validates one unambiguous exact RXO tuple and explicitly refuses guessing',
);
hasAll(
  rxoAvailability,
  [
    'FROM rxo_shipment_context',
    'WHERE site_key=$1 AND shipment_id=$2 AND direction=$3 LIMIT 2',
  ],
  'shared RXO selection helper binds the complete site/shipment/direction tuple and limits ambiguity detection to two rows',
);
must(
  !/FROM\s+rxo_shipment_context\s+WHERE\s+shipment_id\s*=\s*\$1/i.test(
    visitService,
  ),
  'visit association never queries RXO context by shipment identifier alone',
);
hasAll(
  rxoService,
  [
    'FROM rxo_shipment_context',
    'WHERE site_key = $1',
    'AND shipment_id = $2',
    'AND direction = $3',
    'rows.length !== 1',
  ],
  'Materials upload also proves one exact RXO tuple before accepting a document',
);

// One immutable active version is enforced in PostgreSQL, not merely by UI.
hasAll(
  migration,
  [
    'ux_visit_documents_rxo_version',
    'ux_visit_documents_rxo_active',
    "WHERE document_type = 'RXO_DRIVER_DOCUMENT'",
    "source_kind = 'MATERIALS_UPLOAD'",
    'rxo_is_active = TRUE',
    'enforce_rxo_driver_document_version_chain',
    'immediately prior superseded version for the same shipment',
    'protect_rxo_driver_document_immutable_fields',
    'RXO driver-document history cannot be deleted',
    'A superseded RXO driver-document version cannot become active again',
    'RXO driver-document supersession history is immutable once recorded',
    'BEFORE DELETE OR UPDATE ON visit_documents',
  ],
  'database enforces one active linear version chain and immutable superseded history',
);
for (const immutableField of [
  'file_name',
  'stored_file_name',
  'relative_path',
  'mime_type',
  'file_size_bytes',
  'sha256',
  'rxo_site_key',
  'rxo_shipment_id',
  'rxo_direction',
  'rxo_document_version',
  'uploaded_by_key_id',
  'created_at',
]) {
  has(
    migration,
    `OLD.${immutableField} IS DISTINCT FROM NEW.${immutableField}`,
    `immutable RXO history protects ${immutableField}`,
  );
}
hasAll(
  rxoService,
  [
    'SET rxo_is_active = FALSE',
    'superseded_at = $2',
    "active ? 'RXO_DOCUMENT_REPLACED' : 'RXO_DOCUMENT_UPLOADED'",
    "'RXO_DOCUMENT_SUPERSEDED'",
    'rxo_document_version',
    'supersedes_document_id',
  ],
  'replacement supersedes and audits the previous immutable version',
);

// Duplicate bytes and network retries are resolved before another immutable
// file or record is created.
// upload() locks and answers replays, then hands the transaction to the upload command.
const rxoUploadFlow = read('libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.service.ts')
  + read('libs/truck-log/server/feature/rxo-documents/src/lib/rxo-document-upload.command.ts');
ordered(
  rxoUploadFlow,
  [
    'rxoShipmentLockKey(identity)',
    'priorIdempotentResponse(',
    'if (active?.sha256 === pdfSha256)',
    'this.storage.storeRxoPdf(',
  ],
  'shipment lock, idempotent replay, and duplicate SHA checks precede file storage',
);
hasAll(
  rxoService,
  [
    'X-Idempotency-Key is required',
    "endpoint: 'rxo-driver-document-upload-v1'",
    'request_sha256 !== requestSha256',
    'already used with a different request',
    'INSERT INTO truck_log_access_idempotency',
  ],
  'Materials uploads have request-digest idempotency and reject key reuse with changed content',
);
has(
  migration,
  'ux_visit_documents_rxo_version',
  'concurrent duplicate versions have a database uniqueness backstop',
);

// Upload/replacement and check-in share exactly one shipment-scoped advisory
// lock, preventing the selected version from changing during freeze.
hasAll(
  lockHelper,
  [
    'rxoShipmentLockKey',
    'identity.siteKey',
    'identity.direction',
    'identity.shipmentId',
  ],
  'shared advisory-lock key contains the full exact RXO identity',
);
has(
  rxoService,
  'this.advisoryLock(manager, rxoShipmentLockKey(identity))',
  'document upload/replacement takes the shared RXO lock',
);
// Check-in's RXO steps live in visit-rxo-association.ts; create() calls them in order.
const visitCreateService = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts');
const visitRxoAssociation = read('libs/truck-log/server/feature/visits/src/lib/visit-rxo-association.ts');
has(
  visitRxoAssociation,
  'rxoShipmentLockKey(rxoIdentity)',
  'visit association/package creation takes the same shared RXO lock',
);
ordered(
  visitCreateService,
  [
    'await assertRxoShipmentSelectable(manager, input.rxoIdentity);',
    'const savedVisit = await visitRepository.save(',
    'await associateActiveRxoDocument(',
    'return savedVisit;',
  ],
  'check-in locks and validates the exact shipment before saving, then associates inside the same transaction',
);
ordered(
  visitRxoAssociation,
  [
    'rxoShipmentLockKey(rxoIdentity)',
    "AND document_type = 'RXO_DRIVER_DOCUMENT'",
    'driverPrint.createOriginalPackage(',
  ],
  'check-in locks the shipment before selecting and freezing the active document',
);

// Guard double-click/network retry protection is server-backed. The capability
// is retained only in the originating browser session and is not enumerable.
hasAll(
  visitDto,
  [
    "@IsUUID('4')",
    'clientRequestId?: string',
    'rxoSiteKey?: string',
    'rxoShipmentId?: string',
    'rxoDirection?: TruckDirection',
  ],
  'check-in accepts a bounded exact tuple and UUID client request key',
);
hasAll(
  migration,
  [
    'client_request_id UUID',
    'ux_truck_visits_client_request',
    'WHERE client_request_id IS NOT NULL',
    'ux_driver_print_packages_original_visit',
    "WHERE request_kind = 'ORIGINAL'",
  ],
  'database deduplicates guard check-in and the original package',
);
hasAll(
  visitService,
  [
    'truck-log:visit-create:${input.clientRequestId}',
    'where: { clientRequestId: input.clientRequestId }',
    'assertIdempotentVisitMatches',
    'already used for a different truck check-in request',
    'response.clientRequestId = null',
  ],
  'visit replay returns only the same normalized request and redacts its guard capability',
);
hasAll(
  visitEntity,
  [
    "name: 'client_request_id'",
    "type: 'uuid'",
    'select: false',
  ],
  'guard action capability is excluded from ordinary visit queries',
);
hasAll(
  checkIn,
  [
    'pendingCheckInRequestId',
    'pendingCheckInFingerprint',
    'this.pendingCheckInFingerprint !== requestFingerprint',
    'clientRequestId: this.pendingCheckInRequestId',
    'rememberGuardActionKey',
    'window.sessionStorage.setItem(`truckLog.guardAction.${visitId}`',
  ],
  'guard UI reuses one request UUID for an unchanged ambiguous retry and keeps it session-local',
);
hasAll(
  checkIn,
  [
    'this.rememberGuardActionKey(visit.id, guardActionKey)',
    'packageDiscoveryDeadline',
    'const RXO_RACE_PACKAGE_DISCOVERY_MS = 10 * 60 * 1000',
    'Date.now() + RXO_RACE_PACKAGE_DISCOVERY_MS',
    'this.refreshDriverPrintPackage(visit.id, true)',
  ],
  'concurrent post-commit upload retains the guard capability and is discovered without another guard action',
);
hasAll(
  checkIn,
  [
    'private packageContextGeneration = 0',
    'this.print.beginDriverPrintContext();',
    'generation = this.packageContextGeneration',
    'if (!this.isCurrentPrintContext(visitId, generation)) return',
    '() => this.refreshDriverPrintPackage(visitId, true, generation)',
    'packageId === this.lastPrintPackage?.packageId',
  ],
  'late package responses and timers are isolated to the exact current visit generation',
);
hasAll(
  rxoService,
  [
    'RXO_CHECK_IN_RACE_GRACE_MS',
    "status = 'DOCK_ASSIGNED'",
    'guard_check_out_at IS NULL',
    'eligible_for_initial_package',
    'originalPackages.length === 0 && automaticItems.length === 0 && canCreateRacePackage',
    'linkedVisits[0].manual_printing !== true',
  ],
  'late upload creates an automatic package only inside the active check-in race window',
);
for (const [source, surface] of [
  [rxoService, 'direct RXO document status'],
  [rxoIngestionService, 'RXO Control Center status'],
]) {
  hasAll(
    source,
    [
      "TRUCK_LOG_DRIVER_PRINT_AGENT_ID",
      "TRUCK_LOG_DRIVER_PRINT_ROUTE",
      "r->>'route'",
      "r->>'outputPrinter'",
      "driver_print_east_printer",
      "driver_print_west_printer",
    ],
    `${surface} reports agent readiness only for the exact server-owned route and printer`,
  );
}
const checkInErrorBlock = between(
  checkIn,
  'error: (e) => {',
  'private uploadQueue(',
);
must(
  !checkInErrorBlock.includes('clearPendingCheckInRequest()'),
  'ambiguous check-in failure does not rotate the client request UUID before retry',
);
hasAll(
  driverController,
  [
    "@Headers('x-idempotency-key')",
    "@Headers('x-guard-action-key')",
  ],
  'guard result/retry calls require idempotency and action-capability headers',
);
hasAll(
  driverService,
  [
    'assertGuardActionKey',
    'timingSafeEqual',
    'visit.client_request_id',
    'Valid guard action credentials are required.',
  ],
  'server validates the non-enumerable guard capability with constant-time comparison',
);

// The package freezes the exact document version. Dock and RXO items have
// independent rows, attempts, terminal results, and UI states.
hasAll(
  migration,
  [
    'frozen_document_id INTEGER',
    'protect_driver_print_package_snapshot',
    'Driver Print Package request and frozen document snapshot are immutable',
    'ux_driver_print_items_package_type UNIQUE (package_id, item_type)',
    "item_type IN ('DOCK_ASSIGNMENT', 'RXO_DOCUMENT')",
    "status IN ('PENDING_CONFIRMATION', 'QUEUED', 'LEASED', 'PRINTED', 'FAILED')",
    'RXO print item must reference the package frozen document version',
    'protect_driver_print_item_snapshot',
  ],
  'package and item rows freeze an exact document and separate the two print results',
);
// DriverPrintService routes automatic packages first, then delegates the legacy
// original package to driver-print-original-package.ts.
const originalPackage = between(
  read('libs/truck-log/server/domain/driver-print/src/lib/driver-print-original-package.ts'),
  'async createOriginalPackage(',
  '\n}\n',
);
const originalPackageCompact = compact(originalPackage);
hasAll(
  originalPackageCompact,
  [
    'frozenDocumentId',
    "'DOCK_ASSIGNMENT'",
    "'PENDING_CONFIRMATION'",
    "'RXO_DOCUMENT'",
    "availability.available ? 'QUEUED' : 'FAILED'",
    "eventType: 'DRIVER_PRINT_PACKAGE_REQUESTED'",
  ],
  'one original package atomically creates independently tracked Dock and RXO items',
);
hasAll(
  driverService,
  [
    "WHEN state.printed = state.total THEN 'COMPLETED'",
    "WHEN state.failed = state.total THEN 'FAILED'",
    "WHEN state.failed > 0 THEN 'PARTIAL_FAILURE'",
    "const eventType = desiredStatus === 'PRINTED'",
    "? 'DOCK_ASSIGNMENT_PRINTED'",
    ": 'DOCK_ASSIGNMENT_PRINT_FAILED'",
    "? 'RXO_DOCUMENT_PRINTED'",
    ": 'RXO_DOCUMENT_PRINT_FAILED'",
  ],
  'package outcome is derived from two independent item results and distinct audit events',
);
hasAll(
  checkIn,
  [
    'Dock Assignment printed — RXO document failed.',
    'RXO document printed — Dock Assignment failed.',
    'Dock Assignment and RXO document printed.',
    "dockPrintItem?.status === 'PENDING_CONFIRMATION'",
    "rxoPrintItem?.status === 'FAILED'",
  ],
  'guard UI clearly presents partial success and controls each item independently',
);

// Print outage never rolls back the saved visit. Queue/lease ambiguity becomes
// a visible failed item that requires an explicit RXO-only retry.
hasAll(
  driverService,
  [
    'The configured Driver Print Agent is unavailable.',
    'The configured Print Agent is offline.',
    'Print Agent lease expired after job delivery',
    'the physical print outcome is unknown',
    'Guard retry is required',
    "SET status = 'FAILED'",
    'retryRequired: true',
  ],
  'offline and ambiguous in-flight jobs become explicit retryable failures',
);
const scheduledReconciliation = between(
  read('libs/truck-log/server/domain/driver-print/src/lib/driver-print-reconciliation.ts'),
  'async runScheduledReconciliation(',
  'async scrubPersistedClaimTokens(',
);
hasAll(
  scheduledReconciliation,
  [
    'await this.agentOperations.expireLeases()',
    'await this.reconcileQueuedJobs()',
  ],
  'scheduled reconciliation expires abandoned leases without requiring another agent request',
);
must(
  scheduledReconciliation.indexOf('await this.agentOperations.expireLeases()')
    < scheduledReconciliation.indexOf('await this.reconcileQueuedJobs()'),
  'scheduled reconciliation expires ambiguous leases before evaluating queued jobs',
);
hasAll(
  checkIn,
  [
    "document.agentOnline === false ? 'Documents ready — Print Agent offline'",
    'The truck visit remains saved.',
    'Retry RXO Document',
  ],
  'guard sees agent outage and a visit-preserving retry path',
);
const retryRxo = between(read('libs/truck-log/server/domain/driver-print/src/lib/driver-print-guard-actions.ts'), 'async retryRxo(', 'async retryDock(');
hasAll(
  retryRxo,
  [
    "item.item_type = 'RXO_DOCUMENT'",
    "package.request_kind = 'ORIGINAL'",
    "row.status !== 'FAILED'",
    'Only a failed RXO document item can be retried.',
    "SET status = 'QUEUED'",
    "'RXO_DOCUMENT_PRINT_RETRIED'",
  ],
  'guard retry accepts only the failed RXO item from the original package',
);
must(
  !retryRxo.includes("item.item_type = 'DOCK_ASSIGNMENT'"),
  'RXO retry never selects or reprints the Dock Assignment item',
);

// Print-agent jobs require a scoped credential at every boundary, a short-lived
// hashed claim, exact server routing, immutable download verification, and an
// idempotent reported result. Merely creating/claiming a job is not success.
hasAll(
  printAgentController,
  [
    "@Post('jobs/claim')",
    "@PrintAgentScope('print-jobs:poll')",
    "@Header('Cache-Control', 'no-store')",
    "@Header('Pragma', 'no-cache')",
    "@Get('jobs/:itemId/document')",
    "@PrintAgentScope('documents:download')",
    "@Headers('x-print-claim-token')",
    "@Post('jobs/:itemId/result')",
    "@PrintAgentScope('print-jobs:report')",
    '@UseGuards(PrintAgentAuthGuard)',
  ],
  'claim, immutable download, and result endpoints are Print Agent authenticated and scoped',
);
hasAll(
  printAgentGuard,
  [
    "createHash('sha256')",
    'timingSafeEqual',
    'active: true',
    'credential.scopes.includes(requiredScope)',
  ],
  'Print Agent guard verifies a hash-only active scoped credential',
);
for (const scope of [
  'print-jobs:poll',
  'documents:download',
  'print-jobs:report',
]) {
  has(printAgentProvision, `"${scope}"`, `new/rotated agent credentials receive ${scope}`);
}
hasAll(
  `${driverService}\n${claimTokenHelper}`,
  [
    'FOR UPDATE OF item SKIP LOCKED',
    "createHmac('sha256', key)",
    'TRUCK_LOG_PRINT_JOB_CLAIM_V1',
    'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET',
    "SET status = 'LEASED', lease_token_sha256 = $2",
    'leaseExpiresAt',
    "downloadUrl: `/api/v1/print-agents/jobs/${job.item_id}/document`",
    'safeDigestEqual',
    "row.status !== 'LEASED'",
    "String(row.printer) !== input.printer.trim()",
    "if (input.success)",
    'INSERT INTO print_agent_idempotency',
  ],
  'agent claims one locked job, uses a hashed lease token, reports exact printer, and gets idempotent completion',
);
// DriverPrintAgentOperations delegates the claim to driver-print-agent-claim.ts.
const agentClaim = between(
  read('libs/truck-log/server/domain/driver-print/src/lib/driver-print-agent-claim.ts'),
  'async claimAgentJob(',
  '\n}\n',
);
hasAll(
  agentClaim,
  [
    'restoreAgentClaimResponse(',
    'deriveAgentClaimToken(',
    'agentClaimResponseForPersistence(body)',
    'JSON.stringify(persistedResponse)',
  ],
  'claim retries reconstruct a stable signed token while persistence receives only the redacted response',
);
ordered(
  agentClaim,
  [
    'UPDATE print_agent_credentials',
    `scopes @> '["print-jobs:poll"]'::jsonb`,
    'UPDATE print_agents',
    'SELECT request_sha256, response_body',
    'restoreAgentClaimResponse(',
  ],
  'claim replay revalidates the scoped credential and enabled agent inside the transaction before returning a token',
);
must(
  !agentClaim.includes('JSON.stringify(body)') &&
    !agentClaim.includes("randomBytes(32).toString('hex')"),
  'claim persistence never serializes a raw or unrecoverable random claim token',
);
hasAll(
  `${driverService}\n${claimTokenHelper}`,
  [
    'const { claimToken: _discardedClaimToken, ...persistedJob } = response.job',
    "SET response_body = stored.response_body #- '{job,claimToken}'",
    'scrubPersistedClaimTokens()',
  ],
  'application startup and reconciliation scrub any legacy plaintext claim token',
);
hasAll(
  migration,
  [
    'ck_print_agent_idempotency_no_claim_token',
  ],
  'database prevents plaintext claim tokens from being persisted',
);
hasAll(
  driverService,
  [
    'resolveRxoPath',
    'constants.O_NOFOLLOW',
    'openedStat.isFile()',
    'openedStat.size !== expectedSize',
    'pdfBuffer = await handle.readFile()',
    'Readable.from([pdfBuffer])',
    'Document SHA-256 does not match immutable metadata.',
  ],
  'agent download serves one no-follow buffer after confined type, size, and SHA-256 validation',
);
must(
  !/\bclaim_token\s+(?:VARCHAR|TEXT)/i.test(migration),
  'database stores only lease token SHA-256, never the raw claim token',
);

const printConfiguration = between(
  driverService,
  'driverPrintConfiguration(): DriverPrintConfiguration',
  'async agentAvailability(',
);
hasAll(
  printConfiguration,
  [
    "TRUCK_LOG_DRIVER_PRINT_AGENT_ID",
    "TRUCK_LOG_DRIVER_PRINT_ROUTE",
    "TRUCK_LOG_DRIVER_PRINT_PRINTER",
    "route.length <= 120",
    "!!this.claimTokenSecretHex()",
    "return { agentId, route, printer, valid",
  ],
  'server print identity/route metadata is bounded and requires the dedicated claim-signing secret',
);
hasAll(
  driverService,
  [
    "printer.length > 255",
    "An exact saved or frozen gate printer is required. No default-printer fallback is allowed.",
    "const key = guardGate === 'EAST' ? 'driver_print_east_printer' : 'driver_print_west_printer'",
  ],
  'gate-specific printer metadata is bounded and fails closed without a default-printer fallback',
);
hasAll(
  driverService,
  [
    'function boundedAuditActor(',
    'cleaned.slice(0, 120)',
    'const requestedBySnapshot = boundedAuditActor(requestedBy)',
    'const actorDisplayName = boundedAuditActor(actor.display_name)!',
  ],
  'valid 160-character credential display names are bounded for legacy 120-character package and visit-event actor snapshots',
);

// RXO PDFs cannot leak through the old enumerable visit-document endpoint.
hasAll(
  visitService,
  [
    "documentType?.trim().toUpperCase() === 'RXO_DRIVER_DOCUMENT'",
    'must be uploaded to the exact RXO shipment through the protected Materials workflow',
    "document.sourceKind === 'MATERIALS_UPLOAD'",
    "throw new NotFoundException('Document not found.')",
  ],
  'legacy upload and download paths reject protected Materials RXO documents',
);
hasAll(
  rxoController,
  [
    '@UseGuards(TruckLogAccessGuard)',
    'TruckLogAccessScopes.RXO_DOCUMENTS_WRITE',
    'TruckLogAccessScopes.RXO_DOCUMENTS_REPRINT',
    "response.setHeader('Cache-Control', 'no-store')",
    "response.setHeader('X-Content-Type-Options', 'nosniff')",
  ],
  'protected RXO download requires a scoped human credential and disables unsafe caching/sniffing',
);

// Reprint names the exact associated version, requires an authorized human,
// creates a new package/attempt, and appends (rather than mutates) audit history.
hasAll(
  driverController,
  [
    "@Post('driver-print/visits/:visitId/reprint-rxo')",
    '@UseGuards(TruckLogAccessGuard)',
    'TruckLogAccessScopes.RXO_DOCUMENTS_REPRINT',
    'request.truckLogPrincipal',
  ],
  'RXO reprint endpoint requires the dedicated human authorization scope',
);
const reprintRxo = between(read('libs/truck-log/server/domain/driver-print/src/lib/driver-print-reprint.ts'), 'async reprintRxo(', '\n}\n');
hasAll(
  reprintRxo,
  [
    'documentId: input.documentId',
    'requireRxoDocument(',
    "'REPRINT'",
    "eventType: 'RXO_DOCUMENT_REPRINTED'",
    "actorType: 'HUMAN'",
    'actorKeyId: principal.keyId',
    "scopes @> '[\"rxo-documents:reprint\"]'::jsonb",
    'expires_at <= NOW()',
    'INSERT INTO truck_log_access_idempotency',
  ],
  'authorized reprint revalidates the actor, expires stale idempotency, freezes a named version, and appends audit',
);
hasAll(
  migration,
  [
    "request_kind IN ('ORIGINAL', 'REPRINT')",
    "event_type IN (",
    "'RXO_DOCUMENT_REPRINTED'",
    'trg_driver_print_events_append_only',
    'driver_print_events is append-only',
  ],
  'reprints are separate packages/events and original history remains immutable',
);
hasAll(
  history,
  [
    'reprintRxoDriverDocument(',
    'documentId',
    'pendingReprintKey',
    'The exact RXO document version was queued as a new audited reprint.',
  ],
  'history UI requests an exact document version with stable retry idempotency',
);

// RXO document details remain conditional, while the current automatic Dock Assignment
// package can still be shown for an ordinary visit without inventing an RXO item.
has(
  checkIn,
  '*ngIf="selectedDriverDocument as document"',
  'Documents Ready callout is hidden when no RXO document exists',
);
has(
  checkIn,
  '*ngIf="print.lastPrintPackage && (print.rxoPrintItem || print.lastPrintPackage.automaticDockAssignment)"',
  'Driver Print Package controls require an RXO item or the current automatic Dock Assignment package',
);
hasAll(
  checkIn,
  [
    "const automaticPrinting = this.printMode === 'AUTOMATIC'",
    'autoPrintDockSlip: automaticPrinting',
    'const guardActionKey = request.clientRequestId',
    'Print manually in browser',
    "printLastSlip()",
    "window.open(this.api.slipUrl(this.lastVisitId), '_blank')",
    "else if (rxoSelection) this.refreshDriverPrintPackage(visit.id, true)",
  ],
  'check-in explicitly selects automatic or manual printing, retains the submitted key, and keeps browser slip printing available',
);
const visitAssociationBlock = between(
  visitRxoAssociation,
  'export async function associateActiveRxoDocument(',
  'RXO_DOCUMENT_ASSOCIATION_SKIPPED',
);
must(
  visitAssociationBlock.includes('if (activeDocument && activeDocument.truck_visit_id === null)')
    && visitAssociationBlock.includes('driverPrint.createOriginalPackage('),
  'an original Driver Print Package is created only when an active document is safely associated',
);

// PDF checks are content-based, bounded, and reject active/embedded features.
hasAll(
  rxoController,
  [
    'fileSize: MAX_RXO_PDF_BYTES',
    'files: 1',
    'fields: 0',
  ],
  'multipart boundary accepts one bounded file and no untrusted extra fields',
);
hasAll(
  rxoDocumentsFeature,
  [
    'export const MAX_RXO_PDF_BYTES = 25 * 1024 * 1024',
    "Buffer.from('%PDF-', 'ascii')",
    "Buffer.from('%%EOF', 'ascii')",
    'file.buffer.subarray(0, PDF_HEADER.length).equals(PDF_HEADER)',
    'hasTerminalPdfEof(file.buffer)',
    'ACTIVE_PDF_TOKEN_PATTERN.test',
    "createHash('sha256').update(file.buffer).digest('hex')",
  ],
  'server validates size, byte-zero PDF header, terminal EOF, active content, and SHA-256',
);
for (const disallowedPdfFeature of [
  'Encrypt',
  'JavaScript',
  'Launch',
  'EmbeddedFile',
  'OpenAction',
  'AA',
]) {
  has(
    rxoDocumentsFeature,
    disallowedPdfFeature,
    `server rejects disallowed PDF feature ${disallowedPdfFeature}`,
  );
}
hasAll(
  controlCenter,
  [
    'const maxBytes = 25 * 1024 * 1024',
    "header !== '%PDF-'",
    "!tail.includes('%%EOF')",
    "accept=\"application/pdf,.pdf\"",
  ],
  'Materials UI performs an early PDF/25 MB check while the server remains authoritative',
);

// SAP and RXO reuse one Docker-persistent immutable store but distinct source
// namespaces; Windows working folders are not the business record.
hasAll(
  storageService,
  [
    "this.config.get<string>('TRUCK_LOG_DOCUMENT_STORAGE_ROOT')",
    'storeSapDocumentPdf',
    'storeRxoDocumentPdf',
    'resolveRxoDocumentStoragePath',
  ],
  'RXO and SAP documents share the generalized controlled storage service',
);
hasAll(
  storageFunctions,
  [
    "const SAP_STORAGE_DIRECTORY = 'sap'",
    "const RXO_STORAGE_DIRECTORY = 'rxo'",
    'storeRxoDocumentPdf',
  ],
  'RXO Materials files retain a distinct immutable namespace from SAP capture files',
);
hasAll(
  rxoDocumentsFeature,
  [
    'ORPHAN_RECONCILIATION_GRACE_MS',
    'TEMPORARY_PDF_NAME_PATTERN',
    'candidate.mtimeMs > cutoff',
    'this.storage.deleteRxoTemporaryPdf(candidate.relativePath)',
    'this.storage.deleteRxoPdf(candidate.relativePath)',
  ],
  'aged crash-temporary and unreferenced final RXO files use a 24-hour safety grace',
);
hasAll(
  compose,
  [
    'TRUCK_LOG_DOCUMENT_STORAGE_ROOT: /data/truck-log-documents',
    'truck-log-documents:/data/truck-log-documents',
    'truck-log-documents:',
  ],
  'Docker API mounts the named persistent document volume at its configured storage root',
);
hasAll(
  envExample,
  [
    'TRUCK_LOG_DOCUMENT_STORAGE_ROOT=',
    'TRUCK_LOG_DRIVER_PRINT_AGENT_ID=',
    'TRUCK_LOG_DRIVER_PRINT_ROUTE=',
    'TRUCK_LOG_DRIVER_PRINT_PRINTER=',
    'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET=',
  ],
  'deployment example exposes persistent storage, exact print routing, and a dedicated claim-token secret',
);
has(read('SETUP-TRUCK-LOG.sh'), 'openssl rand -hex 32', 'Linux fresh setup generates a 256-bit print claim-token secret');
hasAll(
  webApi,
  [
    'uploadRxoDriverDocument(',
    'Authorization',
    'X-Idempotency-Key',
    'X-Guard-Action-Key',
    'reprintRxoDriverDocument(',
    '{ documentId }',
  ],
  'web API keeps upload/reprint authentication, idempotency, and guard capability explicit',
);

// Execute the exact pure helper used by DriverPrintService. This known-answer
// test catches accidental canonicalization or lease-context drift without a DB.
const claimTokenRuntime = loadTypeScriptModule(
  'libs/truck-log/server/domain/driver-print/src/lib/print-agent-claim-token.ts',
);
const claimTokenSecret =
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const claimContext = {
  agentId: 'truck-log-print-pc-01',
  idempotencyKey: 'claim:9ad9f1de-67cc-4eb5-862e-90fb18760534',
  requestSha256: 'a'.repeat(64),
  job: {
    itemId: '2f3995ce-5598-456a-80ba-5d424df815c4',
    packageId: 'fb8d7682-fdf1-4731-87d7-a47c47adff4d',
    attemptNumber: 2,
    route: 'FORT_WAYNE_GUARD',
    printer: '\\\\print01\\USFTWP_GUARD',
    fileSizeBytes: 123456,
    sha256: 'b'.repeat(64),
    leaseExpiresAt: '2026-09-02T12:34:56.000Z',
  },
};
const knownToken = claimTokenRuntime.derivePrintAgentClaimToken(
  claimTokenSecret,
  claimContext,
);
must(
  knownToken ===
    '9acd36fe76e92a8aa19d8a8345929e22b30f01af63acb8abd98001555e6b33b9',
  'claim-token HMAC matches the fixed known-answer vector',
);
must(
  /^[0-9a-f]{64}$/.test(knownToken),
  'claim-token derivation returns exactly 64 lowercase hexadecimal characters',
);
must(
  claimTokenRuntime.derivePrintAgentClaimToken(
    claimTokenSecret,
    structuredClone(claimContext),
  ) === knownToken,
  'the same immutable lease context deterministically returns the same claim token',
);

const changedClaimContexts = [
  ['agent ID', (value) => (value.agentId = 'truck-log-print-pc-02')],
  ['idempotency key', (value) => (value.idempotencyKey += '-retry')],
  ['request digest', (value) => (value.requestSha256 = 'c'.repeat(64))],
  ['item ID', (value) => (value.job.itemId = '1e3995ce-5598-456a-80ba-5d424df815c4')],
  ['package ID', (value) => (value.job.packageId = 'ab8d7682-fdf1-4731-87d7-a47c47adff4d')],
  ['attempt number', (value) => (value.job.attemptNumber += 1)],
  ['route', (value) => (value.job.route = 'FORT_WAYNE_GUARD_2')],
  ['printer', (value) => (value.job.printer = '\\\\print02\\USFTWP_GUARD')],
  ['file size', (value) => (value.job.fileSizeBytes += 1)],
  ['document digest', (value) => (value.job.sha256 = 'd'.repeat(64))],
  ['lease expiry', (value) => (value.job.leaseExpiresAt = '2026-09-02T12:35:56.000Z')],
];
for (const [label, mutate] of changedClaimContexts) {
  const changed = structuredClone(claimContext);
  mutate(changed);
  must(
    claimTokenRuntime.derivePrintAgentClaimToken(claimTokenSecret, changed) !==
      knownToken,
    `claim token changes when immutable ${label} changes`,
  );
}

for (const invalidSecret of [
  '',
  '00'.repeat(31),
  '00'.repeat(33),
  `${'00'.repeat(31)}zz`,
]) {
  let rejected = false;
  try {
    claimTokenRuntime.derivePrintAgentClaimToken(invalidSecret, claimContext);
  } catch (error) {
    rejected =
      error instanceof TypeError &&
      error.message.includes('exactly 64 hexadecimal characters');
  }
  must(rejected, 'invalid claim-token signing secret is rejected');
}

const responseWithClaimToken = {
  job: {
    ...claimContext.job,
    fileName: 'rxo-driver-paperwork.pdf',
    downloadUrl: `/api/v1/print-agents/jobs/${claimContext.job.itemId}/document`,
    claimToken: knownToken,
  },
};
const persistedClaimEnvelope =
  claimTokenRuntime.redactPrintAgentClaimResponseForPersistence(
    responseWithClaimToken,
  );
must(
  persistedClaimEnvelope.job &&
    !Object.prototype.hasOwnProperty.call(persistedClaimEnvelope.job, 'claimToken') &&
    !JSON.stringify(persistedClaimEnvelope).includes('claimToken') &&
    !JSON.stringify(persistedClaimEnvelope).includes(knownToken),
  'persisted idempotency envelope excludes the raw claim token and its value',
);
must(
  responseWithClaimToken.job.claimToken === knownToken,
  'persistence redaction does not mutate the API response returned to the agent',
);
must(
  claimTokenRuntime.redactPrintAgentClaimResponseForPersistence({ job: null })
    .job === null,
  'empty claim response persists as an empty idempotency envelope',
);


// Late Print Agent results (Guard Shack Print Agent 4.0.7 durable outbox): a
// result submitted within its lease but delivered after the lease monitor marked
// the print uncertain is recorded as reported, exactly once, on both paths.
const lateResult = loadTypeScriptModule(
  'libs/truck-log/server/domain/driver-print/src/lib/print-agent-late-result.ts',
);
{
  const MIN = 60_000;
  const leasedAt = new Date('2026-10-28T12:00:00.000Z');
  const leaseExpiresAt = new Date('2026-10-28T12:05:00.000Z');
  const within = (offsetMin) =>
    lateResult.resultSubmittedWithinLease({
      leasedAt,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      submittedAtMs: leasedAt.getTime() + offsetMin * MIN,
      skewMs: 5 * MIN,
    });
  must(within(3), 'late result: submitted inside the lease is in time');
  must(within(-5) && within(10), 'late result: lease window includes five minutes of clock skew on both ends');
  must(!within(-5.01) && !within(10.01), 'late result: outside lease +/- skew is out of time');
  must(
    !lateResult.resultSubmittedWithinLease({ leasedAt: null, leaseExpiresAt, submittedAtMs: leasedAt.getTime(), skewMs: 5 * MIN }),
    'late result: a cleared lease (guard retry) is never in time',
  );
  const decide = (status, extra = {}) =>
    lateResult.decideAgentResult({ status, leaseExpired: false, inTime: true, expiredByMonitor: false, success: true, ...extra });
  const cases = [
    [decide('LEASED'), 'RECORD', 'active lease records the reported outcome'],
    [decide('LEASED', { leaseExpired: true }), 'RECORD', 'expired lease + in-time result records the reported outcome'],
    [decide('LEASED', { leaseExpired: true, inTime: false }), 'EXPIRE_UNCERTAIN', 'expired lease + out-of-time result stays FAILED uncertain'],
    [decide('FAILED', { expiredByMonitor: true }), 'REPLACE_MONITOR_FAILURE', 'in-time late success after monitor expiry -> PRINTED'],
    [decide('FAILED', { expiredByMonitor: true, success: false }), 'REPLACE_MONITOR_FAILURE', 'in-time late failure replaces the monitor error with the agent error'],
    [decide('FAILED', { expiredByMonitor: true, inTime: false }), 'CONFLICT_FINAL', 'out-of-time success after monitor expiry stays FAILED'],
    [decide('FAILED', { expiredByMonitor: true, inTime: false, success: false }), 'REPLAY_FINAL', 'out-of-time failure after monitor expiry keeps the uncertain FAILED'],
    [decide('FAILED'), 'CONFLICT_FINAL', 'a FAILED written by a human or the agent is never overwritten'],
    [decide('FAILED', { success: false }), 'REPLAY_FINAL', 'matching FAILED replays the final state'],
    [decide('PRINTED', { success: false, expiredByMonitor: true }), 'CONFLICT_FINAL', 'PRINTED is never downgraded'],
    [decide('PRINTED'), 'REPLAY_FINAL', 'matching PRINTED replays the final state'],
    [decide('QUEUED'), 'NOT_LEASED', 'a re-queued (guard retried) item is not leased'],
  ];
  for (const [actual, expected, message] of cases) must(actual === expected, `late result decision: ${message} (${actual})`);
  must(
    /lease monitor had marked the print outcome uncertain/.test(lateResult.lateResultNote(leasedAt, 'x')),
    'late result audit note says the result arrived after the lease monitor marked it uncertain',
  );
}
const lateLib = 'libs/truck-log/server/domain/driver-print/src/lib/';
const autoJobsSource = read(`${lateLib}automatic-driver-print-agent-jobs.ts`);
const autoStoreSource = read(`${lateLib}automatic-driver-print.store.ts`);
const legacyOpsSource = read(`${lateLib}driver-print-agent.operations.ts`);
const legacyResultsSource = read(`${lateLib}driver-print-agent-results.ts`);
const autoReport = between(autoJobsSource, 'async reportIfOwned(', '\n}\n');
ordered(
  autoReport,
  ['pg_advisory_xact_lock', 'SELECT request_sha256', 'FOR UPDATE OF j', 'this.checkClaim(r, agent, input.claimToken)', 'decideAgentResult(', 'replaceMonitorFailure(', 'INSERT INTO print_agent_idempotency'],
  'automatic result: lock, replay, row lock and claim check happen before the late-result decision',
);
hasAll(autoReport, ['skewMs: MAX_CLOCK_SKEW_MS', 'resultSubmittedWithinLease(', 'this.store.expiredByMonitor(m, r)', "'A different final print result is already recorded.'"],
  'automatic result uses the shared lease window and the monitor marker');
hasAll(
  compact(between(autoStoreSource, 'async replaceMonitorFailure(', 'private async recordOutcome(')),
  [
    "WHERE id=$1 AND status='FAILED' AND last_error=$5 AND attempt_count=$6 RETURNING id",
    "status='FAILED' AND result_key IS NULL AND error_message=$6 RETURNING id",
    'oneUpdated(u, r.id)',
    "'_LATE_RESULT'",
    'lateResultNote(',
  ],
  'automatic late result replaces only the monitor FAILED with guarded single-row UPDATEs and a _LATE_RESULT audit event',
);
hasAll(between(autoStoreSource, 'async expiredByMonitor(', 'async replaceMonitorFailure('),
  ['r.last_error !== UNCERTAIN', 'result_key', 'FOR UPDATE', "rows[0].result_key === null"],
  'automatic monitor marker is UNCERTAIN with no agent result_key');
has(between(autoStoreSource, 'async expire(m: EntityManager)', 'async audit('), "'TRUCK_LOG_LEASE_MONITOR', null", 'lease monitor still writes FAILED with result_key NULL');
ordered(
  between(legacyOpsSource, 'async recordAgentResult(', 'async expireLeases()'),
  ['await this.expireLeases()', 'pg_advisory_xact_lock', 'FOR UPDATE OF item', 'safeDigestEqual(suppliedTokenSha256', 'decideAgentResult(', 'this.results.record('],
  'legacy result: expiry, lock, replay, row lock and claim check happen before the late-result decision',
);
hasAll(legacyOpsSource, ["'REPLACES_MONITOR_FAILURE'", "'AFTER_EXPIRY'", 'skewMs: MAX_CLOCK_SKEW_MS', 'this.results.expiredByMonitor(manager, row)'],
  'legacy result records late in-time results and replaces only monitor failures');
hasAll(
  compact(legacyResultsSource),
  [
    "status = 'FAILED' AND last_error = $7",
    "status = 'FAILED' AND details->>'outcomeAmbiguous' = 'true' AND NOT (details ? 'resultIdempotencyKey')",
    'if (item.length !== 1)',
    'if (attempt.length !== 1)',
    'lateResult: true',
    "'RXO_DOCUMENT_PRINTED_LATE_RESULT'",
    "'RXO_DOCUMENT_PRINT_FAILED_LATE_RESULT'",
    'UPDATE visit_documents',
    'GREATEST(last_successful_print_at, $2)',
    'insertAgentIdempotency(',
    "THEN $4::timestamptz ELSE NULL END",
  ],
  'legacy late result uses guarded single-row UPDATEs, updates document/agent state and writes a _LATE_RESULT visit event',
);
const lateMigration = fs.readFileSync(path.join(root, 'database/truck-log/migrations/0003_late_print_agent_results.sql'), 'utf8');
const helperUncertain = /UNCERTAIN =\s*'([^']+)'/.exec(read(`${lateLib}automatic-driver-print.helpers.ts`))?.[1];
const typesExpired = /EXPIRED_LEASE_ERROR =\s*'([^']+)'/.exec(read(`${lateLib}driver-print.types.ts`))?.[1];
must(helperUncertain && lateMigration.split(`'${helperUncertain}'`).length === 3, 'migration 0003 matches the automatic UNCERTAIN marker text exactly');
must(typesExpired && lateMigration.includes(`'${typesExpired}'`), 'migration 0003 matches EXPIRED_LEASE_ERROR exactly');
hasAll(
  lateMigration,
  [
    'CREATE OR REPLACE FUNCTION public.protect_automatic_print_job()',
    'CREATE OR REPLACE FUNCTION public.protect_automatic_print_attempt()',
    'CREATE OR REPLACE FUNCTION public.enforce_driver_print_attempt_transition()',
    "a.status='FAILED' AND a.result_key IS NULL",
    'OLD.result_key IS NULL AND NEW.result_key IS NOT NULL',
    "NOT (OLD.details ? 'resultIdempotencyKey')",
    "NEW.details->>'lateResult' = 'true'",
    "RAISE EXCEPTION 'Completed driver print attempts are immutable'",
  ],
  'history triggers allow only the one-time replacement of a lease-monitor failure',
);
must(!/\bDROP\s+TRIGGER\b/i.test(lateMigration), 'migration 0003 keeps every history trigger');
// Guard retry wins: both retry paths clear the lease token, so the old claim no longer matches.
has(compact(read(`${lateLib}automatic-driver-print-requests.ts`)), "lease_token_sha256=NULL,leased_at=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND status='FAILED'",
  'automatic guard retry clears the lease token before a late result can arrive');
has(compact(between(read(`${lateLib}driver-print-guard-actions.ts`), 'async retryRxo(', 'async retryDock(')), 'assigned_agent_id = $4, lease_token_sha256 = NULL',
  'legacy guard retry clears the lease token before a late result can arrive');

must(
  schemaIncludes('load_number VARCHAR(120) NOT NULL') && schemaIncludes('trg_truck_visits_scheduled_source'),
  'truck_visits.load_number is 120 characters and the scheduled-source trigger is in place',
);
must(
  !schemaIncludes('DROP FUNCTION enforce_truck_visit_scheduled_source'),
  'migrations never remove the scheduled-source enforcement function',
);

console.log(
  `[PASS] RXO driver-document and Driver Print Package contract: ${passed} checks passed.`,
);
