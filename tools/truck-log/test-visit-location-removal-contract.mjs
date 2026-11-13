import fs from 'node:fs';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const need = (ok, message) => {
  if (!ok) throw new Error(message);
  console.log(`[OK] ${message}`);
};

const files = {
  checkIn: 'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts',
  form: 'libs/truck-log/web/domain/src/lib/check-in-form.ts',
  dto: 'libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts',
  entity: 'libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts',
  service: 'libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts',
  contracts: 'libs/truck-log/shared/contracts/src/index.ts',
  schema: 'database/truck-log/migrations/0001_baseline.sql',
};
for (const rel of Object.values(files)) need(fs.existsSync(path.join(root, rel)), `${rel} exists`);

const src = Object.fromEntries(Object.entries(files).map(([key, rel]) => [key, read(rel)]));
src.checkIn = readFeatureSource(root, 'libs/truck-log/web/feature/check-in/src/lib', ['.ts', '.html']);
const standaloneLocationName = /\blocationName\b/;

for (const key of ['checkIn', 'form', 'dto', 'entity', 'service', 'contracts']) {
  need(!standaloneLocationName.test(src[key]), `${files[key]} has no obsolete visit locationName field`);
}
need(!src.checkIn.includes('Location / Area'), 'Check-In has no Location / Area control');
need(!src.entity.includes('location_name'), 'TypeORM entity has no obsolete location_name column');
need(!/\blocation_name\b/.test(src.schema), 'bootstrap schema has no obsolete location_name column or trigger check');
need(src.checkIn.includes('{{requiredComplete}} of 10 required items complete'), 'Check-In required progress remains 10 / 10');
need(src.checkIn.includes('<h2>Guard Notes</h2><span class="dana-field-tag">Optional</span>'), 'Optional guard notes remain available');
need(src.checkIn.includes('Guard Notes'), 'Guard Notes remain visible and optional');
need(src.checkIn.includes('plantLocationName'), 'Check-In still uses configured plant location for direction-driven Origin/Destination');
need(src.service.includes('plantLocationName'), 'Server still canonicalizes the configured plant-side Origin/Destination');
need(src.contracts.includes('plantLocationName'), 'Shared check-in config still exposes plantLocationName');
need(src.schema.includes('plant_location_name'), 'app_settings.plant_location_name remains in the schema');
need(/\borigin_location_id\b/.test(src.schema) || /\borigin_name\b/.test(src.schema), 'Origin routing remains in the visit schema');
need(/\bdestination_location_id\b/.test(src.schema) || /\bdestination_name\b/.test(src.schema), 'Destination routing remains in the visit schema');

console.log('[PASS] Obsolete Truck Visit Location / Area field is completely removed from active application/schema contracts.');
