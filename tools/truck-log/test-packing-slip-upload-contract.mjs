import { readFeatureSource, transpileTsModuleTree } from './source-contract-utils.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { schemaIncludes } from './migration-sql.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
};
const requireText = (source, marker, label) =>
  must(source.includes(marker), `${label}: ${marker}`);

const extractorPath = 'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-extractor.ts';
// The extractor is split into stream decoding, text recovery and ID selection modules.
const extractor = [
  extractorPath,
  'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-streams.ts',
  'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-text.ts',
].map(read).join('\n');
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const controller = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.controller.ts');
const moduleSource = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.module.ts');
const entity = read('libs/truck-log/server/data-access/src/lib/entities/visit-document.entity.ts');
const contracts = read('libs/truck-log/shared/contracts/src/index.ts');
const api = read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const board = read('libs/truck-log/web/feature/dock-board/src/lib/dock-board.component.ts');
const history = read('libs/truck-log/web/feature/history/src/lib/history.component.ts');
const styles = read('libs/truck-log/web/styles/src/styles/truck-log.css');
const packingCss = read('libs/truck-log/web/styles/src/styles/dock-board.css'); // layout only; Dana UI styles the packing-slip section

for (const marker of [
  'PackingSlipExtractionStatuses',
  'PDF_TEXT_LABEL',
  'Outbound Delivery',
  'Delivery Note',
  'AMBIGUOUS',
  'Truck Log will not guess an ID',
  'inflateSync',
  'ASCII85Decode',
  'pdfStreamFilters',
  'currentObjectDictionary',
  'indirectPdfObject',
  'pdfTextObjects',
  'beginbfchar',
]) {
  requireText(extractor, marker, 'PDF extractor marker');
}

for (const marker of [
  "@Post(':id/packing-slip')",
  'UploadPackingSlipDto',
  'this.service.addPackingSlip',
]) {
  requireText(controller, marker, 'Packing-slip endpoint');
}

for (const marker of [
  'async addPackingSlip(',
  "PACKING_SLIP_DOCUMENT_TYPE = 'PACKING_SLIP'",
  'Packing slips can only be uploaded while the truck is assigned to a dock.',
  'No packing-slip PDF attached; completion allowed',
  'Packing slip attached; SAP Document/Delivery ID pending review',
  'PACKING_SLIP_REPLACED',
  'PACKING_SLIP_UPLOADED',
  'packingSlip.extractedDocumentId',
  "relations: { documents: true }",
]) {
  requireText(service, marker, 'Server workflow marker');
}

must(
  service.includes('No packing-slip PDF attached; completion allowed') && !service.includes('Upload exactly one packing-slip PDF on the Dock Board before Dock Complete.'),
  'Dock Complete is allowed and audited when no packing slip is attached',
);
must(
  service.includes('Packing-slip record exists but PDF is unavailable; completion allowed'),
  'missing stored PDF is nonblocking and audited',
);
must(
  service.includes('Packing slip attached; SAP Document/Delivery ID pending review'),
  'SAP ID review does not block Dock Complete when the optional PDF is attached',
);
must(
  service.includes("notes: `Departed dock ${visit.dockCode}; ${packingSlipAudit}`"),
  'Dock Complete audit records the attached packing-slip state',
);
requireText(service, 'Packing slips must be uploaded from the Dock Board', 'Generic upload cannot bypass packing-slip verification');
requireText(moduleSource, 'PackingSlipPdfService', 'PDF extractor service is registered');

for (const marker of [
  'extractedDocumentId',
  'extractionStatus',
  'extractionMethod',
  'extractionMessage',
]) {
  requireText(entity, marker, 'VisitDocument entity field');
  requireText(contracts, marker, 'VisitDocument shared contract field');
}

for (const marker of [
  'ux_visit_documents_one_packing_slip',
  "WHERE document_type = 'PACKING_SLIP'",
  'extracted_document_id',
  'extraction_status',
]) {
  must(schemaIncludes(marker), `Database schema marker: ${marker}`);
}
must(!fs.existsSync(path.join(root, 'tools/truck-log/apply-packing-slip-upgrade.mjs')) &&
  !fs.existsSync(path.join(root, 'tools/truck-log/verify-packing-slip-upgrade.mjs')),
  'Retired packing-slip patch utilities are absent from the current release');


for (const marker of [
  'uploadPackingSlip(',
  '/packing-slip',
  'Packing slip',
  'SAP Document / Delivery ID',
  'Replace PDF',
  "'Upload PDF'",
  'Not attached (optional)',
  "a missing PDF doesn't block completion",
  'packingSlipReady',
]) {
  requireText(api + board, marker, 'Dock Board upload marker');
}
requireText(history, "d.documentType==='PACKING_SLIP'", 'Records page identifies packing slips');
requireText(styles, '@import "./dock-board.css";', 'Dock Board layout stylesheet is loaded');
requireText(packingCss, '.tl-dock-grid', 'Dock Board layout CSS marker');
// The packing-slip panel and its state badge are Dana UI card sections/badges toned by readiness.
for (const marker of [
  `<section class="dana-card-section tl-stack" [attr.data-tone]="packingSlipReady(visit) ? 'success' : (packingSlip(visit) ? 'warning' : null)">`,
  `<span class="dana-status-badge is-plain" [attr.data-tone]="packingSlipReady(visit) ? 'success' : (packingSlipAvailable(visit) ? 'warning' : 'neutral')">`,
]) {
  requireText(board, marker, 'Packing-slip Dana markup');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-packing-slip-'));
// Compile the extractor together with its relative imports.
const compiled = transpileTsModuleTree(ts, process.cwd(), extractorPath, tempDir);
const extractionModule = require(compiled);
const extract = extractionModule.extractPackingSlipMetadata;

const plainPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<< /Type /Page >>stream\nBT (Delivery Note 13246286) Tj ET\nendstream\n%%EOF',
  'latin1',
);
const plain = extract(plainPdf);
must(plain.status === 'DETECTED' && plain.documentId === '13246286', 'Text PDF detects labeled Delivery Note ID');
must(plain.pageCount === 1, 'PDF page count is recorded when available');

const compressedText = Buffer.from('BT (Outbound Delivery No. 87654321) Tj ET', 'latin1');
const compressedPdf = Buffer.concat([
  Buffer.from('%PDF-1.5\n1 0 obj<< /Type /Page /Filter /FlateDecode >>stream\n', 'latin1'),
  deflateSync(compressedText),
  Buffer.from('\nendstream\n%%EOF', 'latin1'),
]);
const compressed = extract(compressedPdf);
must(compressed.status === 'DETECTED' && compressed.documentId === '87654321', 'Flate-compressed PDF text detects Outbound Delivery ID');

function ascii85Encode(buffer) {
  const out = ['<~'];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const chunk = buffer.subarray(offset, Math.min(offset + 4, buffer.length));
    const padded = Buffer.alloc(4);
    chunk.copy(padded);
    const value = padded.readUInt32BE(0);
    if (chunk.length === 4 && value === 0) {
      out.push('z');
      continue;
    }
    const digits = new Array(5);
    let remaining = value;
    for (let index = 4; index >= 0; index -= 1) {
      digits[index] = remaining % 85;
      remaining = Math.floor(remaining / 85);
    }
    out.push(digits.slice(0, chunk.length + 1).map((digit) => String.fromCharCode(digit + 33)).join(''));
  }
  out.push('~>');
  return Buffer.from(out.join(''), 'ascii');
}

const sapStyleText = Buffer.from(
  'BT (Packing List) Tj (Delivery No.) Tj (13246286) Tj (Document Date) Tj (08/26/2026) Tj ET',
  'latin1',
);
const sapStyleEncoded = ascii85Encode(deflateSync(sapStyleText));
const sapStylePdf = Buffer.concat([
  Buffer.from('%PDF-1.5\n1 0 obj<< /Type /Page /Filter [ /ASCII85Decode /FlateDecode ] >>stream\n', 'latin1'),
  sapStyleEncoded,
  Buffer.from('\nendstream\n%%EOF', 'latin1'),
]);
const sapStyle = extract(sapStylePdf);
must(
  sapStyle.status === 'DETECTED' && sapStyle.documentId === '13246286',
  'ASCII85 + Flate searchable SAP-style PDF detects Delivery No. 13246286',
);

const indirectText = Buffer.from('BT (Packing List) Tj (Delivery No.) Tj (24681357) Tj ET', 'latin1');
const indirectCompressedPdf = Buffer.concat([
  Buffer.from('%PDF-1.3\n1 0 obj<< /Type /Page >>endobj\n2 0 obj<< /Filter 3 0 R >>stream\n', 'latin1'),
  deflateSync(indirectText),
  Buffer.from('\nendstream\nendobj\n3 0 obj\n[/FlateDecode]\nendobj\n%%EOF', 'latin1'),
]);
const indirectCompressed = extract(indirectCompressedPdf);
must(
  indirectCompressed.status === 'DETECTED' && indirectCompressed.documentId === '24681357',
  'Indirect PDF Filter object is resolved before searchable text extraction',
);

const sapNetweaverContent = Buffer.from(
  'q BI /W 1 /H 1 /BPC 1 /F [/A85 /Fl] ID A(garbage-that-must-not-swallow-text~> EI Q '
    + '0 g BT <5061636B696E67204C697374> Tj ET '
    + '0 g BT <44656C6976657279204E6F2E> Tj ET '
    + '0 g BT <3133323436323836> Tj ET',
  'latin1',
);
const sapNetweaverPdf = Buffer.concat([
  Buffer.from('%PDF-1.3\n15 0 obj<< /Type /Page >>endobj\n13 0 obj<< /Length 14 0 R >>stream\n', 'latin1'),
  sapNetweaverContent,
  Buffer.from(`\nendstream\nendobj\n14 0 obj\n${sapNetweaverContent.length}\nendobj\n%%EOF`, 'latin1'),
]);
const sapNetweaver = extract(sapNetweaverPdf);
must(
  sapNetweaver.status === 'DETECTED' && sapNetweaver.documentId === '13246286',
  'SAP NetWeaver inline-image content cannot swallow later Delivery No. hex text',
);

const unlabeled = extract(Buffer.from('%PDF-1.4\nstream\nBT (Packing List 12345678) Tj ET\nendstream', 'latin1'));
must(unlabeled.status === 'NOT_FOUND' && unlabeled.documentId === null, 'Unlabeled numbers are not guessed as SAP IDs');

const ambiguous = extract(Buffer.from('%PDF-1.4\nstream\nBT (Delivery No. 12345678 Document No. 87654321) Tj ET\nendstream', 'latin1'));
must(ambiguous.status === 'AMBIGUOUS' && ambiguous.documentId === null, 'Equal-strength multiple labeled IDs are rejected as ambiguous');

for (const relative of [
  extractorPath,
  'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-streams.ts',
  'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-text.ts',
  'libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf.service.ts',
  'libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts',
  'libs/truck-log/server/feature/visits/src/lib/truck-visits.controller.ts',
  'libs/truck-log/server/data-access/src/lib/entities/visit-document.entity.ts',
  'libs/truck-log/shared/contracts/src/index.ts',
  'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts',
  'libs/truck-log/web/feature/dock-board/src/lib/dock-board.component.ts',
  'libs/truck-log/web/feature/history/src/lib/history.component.ts',
]) {
  const source = read(relative);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
    reportDiagnostics: true,
    fileName: relative,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(
      `TypeScript syntax failed for ${relative}:\n${errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n')}`,
    );
  }
}

must(!board.includes('|| !packingSlip(visit)'), 'Dock Complete is not blocked by a missing packing-slip PDF');
must(board.includes('Not attached (optional)') && board.includes("The driver goes to the guard for Final Checkout. Any attached packing slip stays in Truck Log; a missing PDF doesn't block completion."), 'Dock Board explains the optional packing-slip workflow');
must(board.includes('Attached — SAP ID needs review') && board.includes('Packing slip attached — SAP ID pending review') && board.includes('[disabled]="busy || uploadingVisitId===visit.id" (click)="askComplete(visit)"'), 'SAP ID review stays non-blocking after the PDF is attached');
console.log('[PASS] Optional Dock Board packing-slip upload, SAP ID review, replacement, and audit contract passed.');
