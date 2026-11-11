import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(contractPath(process.cwd(), path), 'utf8');
const dto = read('libs/manufacturing/server/feat-cutter-build/src/lib/cutter-build.dto.ts');
const backend = read('libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.service.ts');
const api = read('libs/manufacturing/frontend/data-access-cutter-builder/src/lib/cutter-builder-api.service.ts');
const teardownTs = read('libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.ts');
const teardownHtml = read('libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.html');
const inventoryHtml = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const trayContentsHtml = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html');
const shelf = read('libs/manufacturing/shared/util-constants/src/lib/shelf-location.constants.ts');
const migration = read('tools/manufacturing/data-import/migrate-summary-shelf-tags.mjs');

for (const forbidden of ['CGER-', 'CGEP-', 'CUTTERGRIND_EMPTY']) {
  if ([shelf, backend, teardownTs, teardownHtml].some((text) => text.includes(forbidden))) {
    throw new Error(`Empty-tray location convention must not exist: ${forbidden}`);
  }
}

for (const marker of [
  '@ApiPropertyOptional({',
  'shelf_location_serial_number?: string | null;',
]) if (!dto.includes(marker)) throw new Error(`Teardown DTO missing optional-shelf marker: ${marker}`);

for (const marker of [
  '// The complete set has been consumed by Cutter Builder. The physical tray',
  'is empty and immediately reusable.',
  'if (returnedBladeCount > 0) {',
  'Scan the required dull shelf ${expectedDullShelfPrefix}-<shelf><layer><bin>',
  'tray.summary_id = null;',
  'tray.part_type_id = null;',
  'tray.current_stage_id = emptyStage.id;',
  'await locationTrayRepo.update(',
  'if (returnedBladeCount > 0 && shelfLocation) {',
  'shelf_location_serial_number: shelfLocation?.serial_number ?? null,',
  'tray_available_for_use: returnedBladeCount === 0,',
]) if (!backend.includes(marker)) throw new Error(`Teardown backend missing empty-tray availability marker: ${marker}`);

for (const marker of [
  'shelfLocationSerial?: string | null;',
  'shelf_location_serial_number: input.shelfLocationSerial?.trim() || null,',
  'tray_available_for_use: boolean;',
]) if (!api.includes(marker)) throw new Error(`Cutter Builder API missing optional-shelf/availability marker: ${marker}`);

for (const marker of [
  'get requiresDullShelf(): boolean',
  'return this.returnedBladeCount > 0;',
  '(this.requiresDullShelf && !this.shelfLocation)',
  "shelfLocationSerial: this.requiresDullShelf ? this.shelfLocation?.serial_number ?? null : null",
  'Available / Ready to Use with no location required',
]) if (!teardownTs.includes(marker)) throw new Error(`Teardown UI logic missing marker: ${marker}`);

for (const marker of [
  '*ngIf="requiresDullShelf; else noShelfRequired"',
  'No Location Required',
  'Available / Ready to Use',
  'Empty — Available / Ready to Use; no location required',
  'the teardown tray stays EMPTY with 0 blades and no active location assignment',
]) if (!teardownHtml.includes(marker)) throw new Error(`Teardown UI missing empty-tray availability marker: ${marker}`);

for (const marker of ['obsolete empty-tray shelf', 'EMPTY/0-blade trays require no location', '`CGER-${summary}`', '`CGEP-${summary}`']) {
  if (!migration.includes(marker)) throw new Error(`Summary-shelf migration must report obsolete empty-shelf rows safely: ${marker}`);
}

for (const text of [inventoryHtml, trayContentsHtml]) {
  if (!text.includes('Available / Ready to Use')) throw new Error('Blade Tracking tray UI must identify unlocated EMPTY trays as Available / Ready to Use.');
}

console.log('[PASS] Empty tray availability contract passed: zero-blade EMPTY trays require no location; teardown assigns Summary + Part Type and a CGDR-/CGDP- dull shelf only when blades are actually returned.');
