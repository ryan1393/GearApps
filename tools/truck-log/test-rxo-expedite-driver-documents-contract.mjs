import fs from 'node:fs';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';
import { readSchemaSql } from './migration-sql.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let checks = 0;
function check(ok, label) {
  if (!ok) throw new Error(label);
  checks += 1;
  console.log(`[PASS] ${label}`);
}
function has(text, marker, label) {
  check(text.includes(marker), label);
}

const expedite = read('libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.component.ts');
// Browser PDF checks and upload idempotency are shared with RXO in web data-access.
const pdfUpload = read('libs/truck-log/web/data-access/src/lib/pdf-upload.ts');
const server = readFeatureSource(root, 'libs/truck-log/server/feature/rxo-expedite/src/lib', ['.ts']);
const documents = readFeatureSource(root, 'libs/truck-log/server/feature/rxo-documents/src/lib', ['.ts']);
const css = read('libs/truck-log/web/styles/src/styles/rxo.css');
const migration008 = readSchemaSql();

has(expedite, "const EXPEDITE_DOCUMENT_SITE_KEY = 'fort-wayne-expedite';", 'dedicated Expedite document namespace');
has(expedite, '<th>Driver documents</th>', 'Driver Documents visible in Expedite table');
has(expedite, 'beginExpediteDocumentUpload(row, expediteDriverDocumentFile)', 'Upload/Replace PDF action in row');
has(expedite, "'X-Truck-Log-Upload': 'browser-v1'", 'same passwordless browser upload guard marker');
has(expedite, "const idempotencyKey = this.uploadIdempotency.keyFor(uploadKey, file, newUploadIdempotencyKey);", 'one idempotency key per shipment and file, reused on retry');
has(expedite, "'X-Idempotency-Key': idempotencyKey", 'idempotent upload header');
has(pdfUpload, 'if (!this.key || this.fingerprint !== fingerprint)', 'retry of the same file reuses the pending key');
check(!expedite.includes("authorization:") && !expedite.includes("'Authorization'"), 'Expedite browser upload sends no bearer password/token');
has(expedite, "await pdfUploadValidationError(file, 'Expedite driver documents')", 'Expedite uses the shared browser PDF validation');
has(pdfUpload, 'const maxBytes = 25 * 1024 * 1024;', '25 MiB browser validation');
has(pdfUpload, "header !== '%PDF-' || !tail.includes('%%EOF')", 'browser PDF signature/end-marker validation');
has(server, "const EXPEDITE_DOCUMENT_SITE_KEY = 'fort-wayne-expedite';", 'server uses the same Expedite namespace');
has(server, 'withDriverDocumentState', 'Expedite list is enriched with active driver document state');
has(server, "document.document_type = 'RXO_DRIVER_DOCUMENT'", 'existing RXO driver-document model reused');
has(server, "document.source_kind = 'MATERIALS_UPLOAD'", 'existing immutable Materials-upload source reused');
has(documents, "identity.siteKey === 'fort-wayne-expedite'", 'document service explicitly recognizes Expedite ownership');
has(documents, 'FROM rxo_expedite_shipment_snapshots snapshot', 'Expedite upload validates against PostgreSQL mirror');
has(documents, "batch.status = 'COMPLETE'", 'Expedite upload accepts only a complete mirrored batch');
has(documents, 'snapshot.direction = $2', 'Expedite upload validates exact direction');
has(documents, '[identity.shipmentId, identity.direction]', 'Expedite upload binds shipment and direction exactly');
has(expedite, 'class="tl-rxo-document"', 'Expedite document status and button share the RXO document layout');
check(/\.tl-rxo-document\s*\{[^}]*flex-wrap:\s*wrap/.test(css), 'Expedite document cell wraps instead of widening the table');
has(migration008, 'ux_visit_documents_rxo_active', 'one active document per shipment tuple remains database-enforced');
has(migration008, 'enforce_rxo_driver_document_version_chain', 'replacement history remains database-enforced');

console.log(`[SUMMARY] ${checks} source contract checks passed.`);
