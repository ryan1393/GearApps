import { readFeatureSource, transpileTsModuleTree } from './source-contract-utils.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
import { schemaIncludes } from './migration-sql.mjs';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const must = (condition, message) => {
  if (!condition) throw new Error(`SAP document foundation contract: ${message}`);
};
const requireText = (source, marker, message) => must(source.includes(marker), `${message}: ${marker}`);

const requiredFiles = [
  'database/truck-log/migrations/0001_baseline.sql',
  'libs/truck-log/server/data-access/src/lib/entities/sap-document-type.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/sap-document-event.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/visit-document.entity.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage.service.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-documents.module.ts',
  'tools/truck-log/migrate.mjs',
  'docs/truck-log/SAP-DOCUMENT-FOUNDATION.md',
];
for (const relativePath of requiredFiles) {
  must(exists(relativePath), `missing required file ${relativePath}`);
}

for (const marker of [
  'CREATE TABLE IF NOT EXISTS sap_document_types',
  "'PACKING_SLIP'",
  `'["Packing List", "Packing Slip"]'`,
  "'Delivery Number'",
  "'^[0-9]{8}$'",
  "'GOODS_RECEIPT'",
  "'Goods Receipt Number'",
  "'GOODS_RECEIPT_UNVALIDATED_V1'",
  'source_capture_id VARCHAR(120)',
  'sha256 VARCHAR(64)',
  'ON DELETE SET NULL',
  'ux_visit_documents_agent_capture',
  'ux_visit_documents_authoritative_sap_type',
  "association_status IN ('ASSOCIATED', 'UNMATCHED', 'ORPHANED')",
  "NULLIF(BTRIM(source_agent_id), '') IS NOT NULL",
  "NULLIF(BTRIM(source_capture_id), '') IS NOT NULL",
  'CREATE TABLE IF NOT EXISTS sap_document_events',
  'trg_sap_document_events_append_only',
  'protect_sap_document_event_history',
]) {
  must(schemaIncludes(marker), `database schema marker missing: ${marker}`);
}

// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
for (const marker of [
  "document.sapDocumentTypeCode = PACKING_SLIP_DOCUMENT_TYPE",
  "document.validationStatus = 'REVIEW_REQUIRED'",
  "document.validationRuleVersion = 'LEGACY_PRE_STRICT_V1'",
  "document.reviewStatus = 'NEEDS_REVIEW'",
  "document.associationMethod = 'VISIT_CONTEXT'",
  "document.isAuthoritative = true",
  "createHash('sha256')",
  'SapDocumentEvent',
]) {
  requireText(service, marker, 'legacy Dock Board compatibility must remain review-safe and audited');
}

const sapModule = read('libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-documents.module.ts');
requireText(sapModule, 'SapDocumentStorageService', 'SAP module must expose storage service');
must(!sapModule.includes('controllers:'), 'Phase 1 must not expose an unauthenticated SAP upload controller');
for (const relativePath of [
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage.service.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-documents.module.ts',
]) {
  const source = read(relativePath);
  must(!/@(?:Controller|Post|Put|Patch|Delete)\b/.test(source), `${relativePath} must not add a public endpoint in Phase 1`);
}

const serverModule = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
requireText(serverModule, 'SapDocumentsModule', 'root server module must register SAP foundation');
requireText(serverModule, 'TRUCK_LOG_DATABASE_SYNCHRONIZE=true is not supported', 'migration-owned schema must reject unsafe TypeORM synchronization');
requireText(serverModule, 'synchronize: false', 'TypeORM synchronization must remain disabled');
const health = read('libs/truck-log/server/feature/health/src/lib/health.controller.ts');
for (const marker of ['sap_document_types', 'sap_document_events', 'sapDocumentStorage']) {
  requireText(health, marker, 'readiness must cover SAP schema/storage');
}

const dockerfile = read('docker/truck-log/server.Dockerfile');
requireText(dockerfile, 'COPY database/truck-log/migrations ./database/truck-log/migrations', 'server runtime must contain the migrations');
const serverEntrypoint = read('docker/truck-log/server-entrypoint.sh');
requireText(serverEntrypoint, 'node ./tools/truck-log/migrate.mjs', 'server entrypoint must apply migrations');
const compose = read('docker-compose.yml');
requireText(compose, 'TRUCK_LOG_DATABASE_SYNCHRONIZE: "false"', 'Compose must prohibit automatic TypeORM schema mutation');
must(
  /image:\s*truck-log-server:\$\{TRUCK_LOG_RELEASE:-\d+\.\d+\.\d+\}/.test(compose),
  'Compose server image must use the Truck Log release tag',
);

for (const relativePath of [
  'libs/truck-log/server/data-access/src/lib/entities/sap-document-type.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/sap-document-event.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/visit-document.entity.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage-paths.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-deletion.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage.service.ts',
  'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-documents.module.ts',
]) {
  const transpiled = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
    reportDiagnostics: true,
    fileName: relativePath,
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  must(
    errors.length === 0,
    `${relativePath} TypeScript syntax failed: ${errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')}`,
  );
}

const helperPath = 'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts';
const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-sap-storage-compile-'));
// The storage helper is split across sap-document-storage-paths/-file-deletion;
// compile the entry with its relative imports.
let compiledPath = null;
try {
  compiledPath = transpileTsModuleTree(ts, root, helperPath, compiledRoot);
} catch {
  compiledPath = null;
}
must(compiledPath !== null, 'storage helper must transpile without syntax errors');
const require = createRequire(import.meta.url);
const storage = require(compiledPath);

const validPdf = Buffer.from('%PDF-1.7\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF', 'latin1');
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-sap-storage-'));
const documentUuid = '11111111-1111-4111-8111-111111111111';
const stored = await storage.storeSapDocumentPdf(
  {
    buffer: validPdf,
    originalName: '../../Delivery:13246286.PDF',
    mimeType: 'application/pdf; charset=binary',
    capturedAt: new Date('2026-09-02T05:06:07.000Z'),
  },
  { storageRoot, maxBytes: 1024 * 1024, idFactory: () => documentUuid },
);
must(stored.fileName === 'Delivery_13246286.pdf', 'source filename must be sanitized and normalized to PDF');
must(stored.relativePath === `sap/2026/09/02/${documentUuid}.pdf`, 'storage path must be deterministic and date-partitioned');
must(stored.sha256 === createHash('sha256').update(validPdf).digest('hex'), 'storage SHA-256 must be server-computed');
must(fs.readFileSync(stored.absolutePath).equals(validPdf), 'stored PDF bytes must be exact');
if (process.platform !== 'win32') {
  must((fs.statSync(stored.absolutePath).mode & 0o777) === 0o600, 'stored PDF mode must be 0600');
}
must(
  !fs.readdirSync(path.dirname(stored.absolutePath)).some((name) => name.endsWith('.tmp') || name.endsWith('.claim')),
  'successful storage must not leave temporary/claim files',
);

const collisionPdf = Buffer.from('%PDF-1.7\ncollision payload\n%%EOF', 'latin1');
let collisionCode = null;
try {
  await storage.storeSapDocumentPdf(
    {
      buffer: collisionPdf,
      originalName: 'collision.pdf',
      mimeType: 'application/pdf',
      capturedAt: new Date('2026-09-02T05:06:07.000Z'),
    },
    { storageRoot, maxBytes: 1024 * 1024, idFactory: () => documentUuid },
  );
} catch (error) {
  collisionCode = error?.code;
}
must(collisionCode === 'STORAGE_PATH_COLLISION', 'UUID collision must fail explicitly');
must(fs.readFileSync(stored.absolutePath).equals(validPdf), 'UUID collision must never overwrite stored bytes');

for (const [label, action, expectedCode] of [
  ['empty PDF', () => storage.validateSapDocumentPdf({ buffer: Buffer.alloc(0), originalName: 'x.pdf' }, 100), 'EMPTY_FILE'],
  ['oversize PDF', () => storage.validateSapDocumentPdf({ buffer: validPdf, originalName: 'x.pdf' }, 2), 'FILE_TOO_LARGE'],
  ['bad MIME', () => storage.validateSapDocumentPdf({ buffer: validPdf, originalName: 'x.pdf', mimeType: 'text/html' }, 1000), 'INVALID_MIME_TYPE'],
  ['bad header', () => storage.validateSapDocumentPdf({ buffer: Buffer.from('not a PDF'), originalName: 'x.pdf' }, 1000), 'INVALID_PDF_HEADER'],
  ['path traversal', () => storage.resolveSapDocumentStoragePath(storageRoot, 'sap/../../escape.pdf'), 'INVALID_STORAGE_PATH'],
]) {
  let code = null;
  try {
    action();
  } catch (error) {
    code = error?.code;
  }
  must(code === expectedCode, `${label} must fail with ${expectedCode}; received ${code}`);
}

if (process.platform !== 'win32') {
  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-sap-symlink-root-'));
  const symlinkOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-sap-symlink-outside-'));
  fs.mkdirSync(path.join(symlinkRoot, 'sap'), { recursive: true });
  fs.symlinkSync(symlinkOutside, path.join(symlinkRoot, 'sap', '2026'), 'dir');
  let symlinkCode = null;
  try {
    await storage.storeSapDocumentPdf(
      {
        buffer: validPdf,
        originalName: 'escape.pdf',
        mimeType: 'application/pdf',
        capturedAt: new Date('2026-09-02T00:00:00.000Z'),
      },
      {
        storageRoot: symlinkRoot,
        maxBytes: 1024 * 1024,
        idFactory: () => '22222222-2222-4222-8222-222222222222',
      },
    );
  } catch (error) {
    symlinkCode = error?.code;
  }
  must(symlinkCode === 'INVALID_STORAGE_PATH', 'symlink escape must be rejected');
  fs.rmSync(symlinkRoot, { recursive: true, force: true });
  fs.rmSync(symlinkOutside, { recursive: true, force: true });
}

fs.rmSync(storageRoot, { recursive: true, force: true });
fs.rmSync(compiledRoot, { recursive: true, force: true });
console.log('[PASS] Generic SAP document model, review safety, audit, Docker migration, and atomic PDF storage contract passed.');

// Source-only regression: exercise the actual catalog-direction verifier without a database.
