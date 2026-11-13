import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFeatureSource, transpileTsModuleTree } from './source-contract-utils.mjs';
const ts = createRequire(import.meta.url)('typescript');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
let checks = 0;
function must(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`[FAIL] ${message}`);
}
function hasAll(source, markers, message) {
  for (const marker of markers) must(source.includes(marker), `${message}: ${marker}`);
}

const storagePath = 'libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts';
// The storage helper is split into store/paths/deletion modules; check them together.
const storageSource = ['sap-document-file-storage.ts', 'sap-document-storage-paths.ts', 'sap-document-file-deletion.ts']
  .map((name) => read('libs/truck-log/server/infrastructure/sap-documents/src/lib/' + name)).join('\n');
const serviceSource = readFeatureSource(root, 'libs/truck-log/server/feature/rxo-documents/src/lib', ['.ts']);
// Print Agent downloads read RXO PDFs through the shared verified reader.
const driverPrintSource = readFeatureSource(
  root,
  'libs/truck-log/server/domain/driver-print/src/lib',
  ['.ts'],
) + fs.readFileSync(path.join(root, 'libs/truck-log/server/infrastructure/sap-documents/src/lib/verified-rxo-pdf-reader.ts'), 'utf8');
const healthSource = read('libs/truck-log/server/feature/health/src/lib/health.controller.ts');

const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-hardening-'));
// The storage helper is split across sap-document-storage-paths/-file-deletion;
// compile the entry with its relative imports.
let compiledPath = null;
try {
  compiledPath = transpileTsModuleTree(ts, root, storagePath, compiledRoot);
} catch {
  compiledPath = null;
}
must(compiledPath !== null, 'generalized immutable storage helper transpiles');
const require = createRequire(import.meta.url);
const storage = require(compiledPath);

const validPdf = Buffer.from('%PDF-1.7\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF', 'latin1');
const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';
const uuidC = '33333333-3333-4333-8333-333333333333';

async function expectInvalid(action, message) {
  let code = null;
  try {
    await action();
  } catch (error) {
    code = error?.code;
  }
  must(code === 'INVALID_STORAGE_PATH', `${message} rejects with INVALID_STORAGE_PATH`);
}

const normalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-delete-'));
const rxoStored = await storage.storeRxoDocumentPdf(
  {
    buffer: validPdf,
    originalName: 'materials.pdf',
    mimeType: 'application/pdf',
    capturedAt: new Date('2026-09-02T00:00:00.000Z'),
  },
  { storageRoot: normalRoot, maxBytes: 1024 * 1024, idFactory: () => uuidA },
);
if (process.platform === 'linux') {
  await storage.deleteStoredRxoDocumentPdf(normalRoot, rxoStored.relativePath);
  must(!fs.existsSync(rxoStored.absolutePath), 'valid RXO orphan path is deleted');
  await storage.deleteStoredRxoDocumentPdf(normalRoot, rxoStored.relativePath);
  must(true, 'missing RXO orphan deletion is idempotent');

  const procfsStored = await storage.storeRxoDocumentPdf(
    {
      buffer: validPdf,
      originalName: 'descriptor-check.pdf',
      mimeType: 'application/pdf',
      capturedAt: new Date('2026-09-02T00:00:00.000Z'),
    },
    { storageRoot: normalRoot, maxBytes: 1024 * 1024, idFactory: () => uuidC },
  );
  const fsPromises = require('node:fs/promises');
  const originalRealpath = fsPromises.realpath;
  fsPromises.realpath = async (candidate, ...args) => {
    if (/^\/proc\/self\/fd\/\d+$/.test(String(candidate))) {
      const error = new Error('Injected missing procfs descriptor');
      error.code = 'ENOENT';
      throw error;
    }
    return originalRealpath(candidate, ...args);
  };
  try {
    await expectInvalid(
      () => storage.deleteStoredRxoDocumentPdf(normalRoot, procfsStored.relativePath),
      'missing held procfs descriptor',
    );
  } finally {
    fsPromises.realpath = originalRealpath;
  }
  must(
    fs.existsSync(procfsStored.absolutePath),
    'procfs descriptor uncertainty fails closed without deleting the stored PDF',
  );
  await storage.deleteStoredRxoDocumentPdf(normalRoot, procfsStored.relativePath);
  must(!fs.existsSync(procfsStored.absolutePath), 'stored PDF remains deletable after procfs recovery');
} else {
  console.log(
    '[INFO] Native-host cleanup is fail-closed; descriptor-anchored delete and symlink adversary cases run in Linux/Docker validation.',
  );
  await expectInvalid(
    () => storage.deleteStoredRxoDocumentPdf(normalRoot, rxoStored.relativePath),
    'non-Linux RXO orphan cleanup',
  );
  must(
    fs.existsSync(rxoStored.absolutePath),
    'non-Linux RXO cleanup fails closed without deleting the stored PDF',
  );
}

const sapStored = await storage.storeSapDocumentPdf(
  {
    buffer: validPdf,
    originalName: 'capture.pdf',
    mimeType: 'application/pdf',
    capturedAt: new Date('2026-09-02T00:00:00.000Z'),
  },
  { storageRoot: normalRoot, maxBytes: 1024 * 1024, idFactory: () => uuidB },
);
if (process.platform === 'linux') {
  await storage.deleteStoredSapDocumentPdf(normalRoot, sapStored.relativePath);
  must(!fs.existsSync(sapStored.absolutePath), 'existing SAP cleanup wrapper remains functional');
} else {
  await expectInvalid(
    () => storage.deleteStoredSapDocumentPdf(normalRoot, sapStored.relativePath),
    'non-Linux SAP cleanup wrapper',
  );
  must(
    fs.existsSync(sapStored.absolutePath),
    'non-Linux SAP cleanup fails closed without deleting the stored PDF',
  );
}

const tempDirectory = path.join(normalRoot, 'rxo', '2026', '09', '02');
fs.mkdirSync(tempDirectory, { recursive: true });
const tempName = `.${uuidA}.pdf.${uuidB}.tmp`;
const tempRelativePath = `rxo/2026/09/02/${tempName}`;
fs.writeFileSync(path.join(tempDirectory, tempName), validPdf);
if (process.platform === 'linux') {
  await storage.deleteStoredRxoTemporaryPdf(normalRoot, tempRelativePath);
  must(!fs.existsSync(path.join(tempDirectory, tempName)), 'stale RXO temp uses contained deletion');
} else {
  await expectInvalid(
    () => storage.deleteStoredRxoTemporaryPdf(normalRoot, tempRelativePath),
    'non-Linux RXO temporary cleanup',
  );
  must(
    fs.existsSync(path.join(tempDirectory, tempName)),
    'non-Linux RXO temporary cleanup fails closed without deleting the file',
  );
}

if (process.platform === 'linux') {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-outside-'));
  const namespaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-ns-link-'));
  const outsideDay = path.join(outside, '2026', '09', '02');
  fs.mkdirSync(outsideDay, { recursive: true });
  fs.writeFileSync(path.join(outsideDay, tempName), validPdf);
  fs.symlinkSync(outside, path.join(namespaceRoot, 'rxo'), 'dir');
  await expectInvalid(
    () => storage.deleteStoredRxoTemporaryPdf(namespaceRoot, tempRelativePath),
    'RXO namespace symlink',
  );
  must(fs.existsSync(path.join(outsideDay, tempName)), 'namespace symlink target survives cleanup');

  const dateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-date-link-'));
  const canonicalDay = path.join(dateRoot, 'rxo', '2025', '09', '02');
  fs.mkdirSync(canonicalDay, { recursive: true });
  const aliasedTarget = path.join(canonicalDay, `${uuidA}.pdf`);
  fs.writeFileSync(aliasedTarget, validPdf);
  fs.symlinkSync('2025', path.join(dateRoot, 'rxo', '2026'), 'dir');
  await expectInvalid(
    () => storage.deleteStoredRxoDocumentPdf(
      dateRoot,
      `rxo/2026/09/02/${uuidA}.pdf`,
    ),
    'in-namespace date alias',
  );
  must(fs.existsSync(aliasedTarget), 'canonical file behind date alias survives cleanup');

  const leafRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-leaf-link-'));
  const leafDay = path.join(leafRoot, 'rxo', '2026', '09', '02');
  fs.mkdirSync(leafDay, { recursive: true });
  const outsideLeaf = path.join(outside, 'outside.pdf');
  fs.writeFileSync(outsideLeaf, validPdf);
  fs.symlinkSync(outsideLeaf, path.join(leafDay, `${uuidA}.pdf`));
  await expectInvalid(
    () => storage.deleteStoredRxoDocumentPdf(
      leafRoot,
      `rxo/2026/09/02/${uuidA}.pdf`,
    ),
    'RXO leaf symlink',
  );
  must(fs.existsSync(outsideLeaf), 'leaf symlink target survives cleanup');

  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(namespaceRoot, { recursive: true, force: true });
  fs.rmSync(dateRoot, { recursive: true, force: true });
  fs.rmSync(leafRoot, { recursive: true, force: true });
}

hasAll(
  storageSource,
  [
    'fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW',
    '`/proc/self/fd/${parentHandle.fd}`',
    'openedParent !== expectedParent',
    "process.platform !== 'linux'",
    'could not resolve its held parent directory descriptor',
    'deleteStoredRxoTemporaryPdf',
  ],
  'cleanup is anchored to an exact held parent directory descriptor',
);
hasAll(
  serviceSource,
  [
    "const ORPHAN_RECONCILIATION_CURSOR_KEY = 'rxo_orphan_reconciliation_cursor'",
    'pg_try_advisory_lock',
    'pg_advisory_unlock',
    'relative_path = ANY($1::text[])',
    'page.candidates[page.candidates.length - 1].relativePath',
    'this.storage.deleteRxoTemporaryPdf(candidate.relativePath)',
    'fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW',
  ],
  'reconciliation is single-owner, batched, descriptor-safe, and cursor-paged',
);
must(
  !serviceSource.includes('await unlink(absolutePath)'),
  'reconciliation no longer raw-unlinks temporary paths',
);
hasAll(
  driverPrintSource,
  [
    "realpath(resolve(this.storage.storageRoot(), 'rxo'))",
    'relative(root, namespaceRoot)',
    '`/proc/self/fd/${handle.fd}`',
    'openedPath !== canonicalFile',
    'relative(namespaceRoot, openedPath)',
  ],
  'Print Agent download is anchored to the exact opened immutable RXO file',
);
hasAll(
  healthSource,
  [
    'lstatSync(namespacePath)',
    'metadata.isSymbolicLink()',
    'canonicalPath !== expectedPath',
    'ck_visit_documents_print_agent_capture',
    'ck_visit_documents_validated_packing_slip',
    'relation_row.relname AS table_name',
    'table_relation.relname AS table_name',
    'index_row.indisunique = TRUE',
    "this.config\n        .get<string>('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET', '')",
  ],
  'readiness rejects aliases, binds catalog objects, and gates the claim-token secret',
);

fs.rmSync(normalRoot, { recursive: true, force: true });
fs.rmSync(compiledRoot, { recursive: true, force: true });
console.log(`[PASS] RXO storage hardening contract: ${checks} checks passed.`);
