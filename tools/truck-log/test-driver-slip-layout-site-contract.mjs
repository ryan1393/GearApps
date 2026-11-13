import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts');
const source = fs.readFileSync(file, 'utf8') + '\n' + fs.readFileSync(path.join(root, 'libs/truck-log/server/feature/visits/src/lib/truck-visit-slip.renderer.ts'), 'utf8');

function need(marker, message) {
  if (!source.includes(marker)) throw new Error(`${message}\nMissing marker: ${marker}`);
}

need("'plant_location_name'", 'Driver slip must read the database-backed plant_location_name setting.');
need("const plantLocationName = settings.get('plant_location_name')?.trim() || 'Fort Wayne';", 'Driver slip must have the Fort Wayne fallback.');
need('const danaPlantName = /^dana\\b/i.test(plantLocationName)', 'Driver slip must avoid duplicating the Dana prefix.');
need(': `Dana ${plantLocationName}`;', 'Driver slip must render Dana + plant name when needed.');

need('@page { size: Letter portrait; margin: 0.22in 0.32in; }', 'Printed slip must use the expanded safe Letter print area.');
need('min-height: 10.56in;', 'Printed slip must use nearly the full Letter page height.');
need('padding: 0.02in 0.04in 0.03in;', 'Printed slip must retain a small print-safe inset.');
need('.signoff-spacer { flex: 1 1 auto; min-height: 14px; }', 'Printed slip must let the signoff spacer consume remaining height.');
need('.print-meta { margin-top: 5px; padding: 5px 2px 0; }', 'Printed footer metadata must be inset from the clipping edge.');
need('.print-meta span:last-child { white-space: nowrap; }', 'Printed Visit Reference must remain intact at the bottom-right.');
need('<div class="signoff-spacer" aria-hidden="true"></div>', 'Driver slip template must include the flexible signoff spacer.');
need('Driver Phone', 'Driver Phone must remain on the professional slip.');
need('Visit ID', 'Human-readable Visit ID must remain on the professional slip.');

console.log('[PASS] Driver slip print-fit + database-backed plant identity contract passed.');
