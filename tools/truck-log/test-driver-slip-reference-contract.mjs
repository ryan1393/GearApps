import { readFeatureSource } from './source-contract-utils.mjs';
import fs from 'node:fs';

const servicePath = 'libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts';
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const source = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const slipSource = fs.readFileSync('libs/truck-log/server/feature/visits/src/lib/truck-visit-slip.renderer.ts', 'utf8');

const need = (condition, message) => {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

need(
  slipSource.includes('const visitReference = formatVisitReference(visit.id);'),
  'Driver slip creates a short human-readable visit reference from the permanent numeric visit ID',
);

need(
  slipSource.includes('<title>${esc(visitReference)} - Driver Slip</title>'),
  'Driver slip browser/print title uses the human-readable visit reference',
);

need(
  slipSource.includes('<div class="value">${esc(visitReference)}</div>'),
  'Top-right Visit ID uses the human-readable visit reference',
);

need(
  slipSource.includes('<span>Visit ID ${esc(visitReference)}</span>'),
  'Printed footer uses the same human-readable Visit ID',
);

need(source.includes('async slipHtml(id: number)'), 'slipHtml method exists');
const visibleLegacyUses = [
  '<title>${esc(visit.visitNumber)}',
  '<div class="value">${esc(visit.visitNumber)}</div>',
  '<span>Visit ID ${esc(visit.visitNumber)}</span>',
];
for (const marker of visibleLegacyUses) {
  need(!slipSource.includes(marker), `Driver-facing slip does not expose long internal visit number: ${marker}`);
}

need(
  source.includes('export function makeFolderKey(visitNumber: string'),
  'Internal visit number remains available for document-folder compatibility',
);

console.log('[PASS] Human-readable driver slip visit reference contract passed.');
