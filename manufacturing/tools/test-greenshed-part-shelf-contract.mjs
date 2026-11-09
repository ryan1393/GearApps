import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const shelf = read('libs/shared/util-constants/src/lib/shelf-location.constants.ts');
const greenshedService = read('libs/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts');
const greenshedPull = read('libs/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.ts');
const greenshedPullHtml = read('libs/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.html');
const locationService = read('libs/server/feat-location/src/lib/server-feat-location.service.ts');
const locationTrayService = read('libs/server/feat-location-tray/src/lib/server-feat-location-tray.service.ts');
const locationDto = read('libs/server/data-access/src/lib/dtos/blade-tracking/locations/create-location.dto.ts');
const adminHtml = read('libs/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html');
const seed = read('tools/data-import/seed-trays-containers-mock-data.mjs');
const fixtures = read('tools/test-data/ensure-workflow-test-fixtures.mjs');
const workflow = read('tools/test-full-workflow.ps1');
const master = read('tools/run-all-tests.ps1');
const shelfTest = read('tools/test-shelf-location-conventions.ps1');
const ensureShelves = read('tools/ensure-summary-shelf-locations.ps1');
const migration = read('tools/data-import/migrate-summary-shelf-tags.mjs');

for (const marker of [
  "export type SummaryShelfPartType = 'RING' | 'PINION';",
  "return `${partType === 'RING' ? 'GSR' : 'GSP'}-${summary}`;",
  "prefix: 'GSR-'",
  "partTypeCode: 'RING'",
  "prefix: 'GSP-'",
  "partTypeCode: 'PINION'",
  'shelf tags require a RING or PINION part type',
]) {
  if (!shelf.includes(marker)) throw new Error(`Shared shelf convention missing ${marker}`);
}
if (shelf.includes("prefix: 'G',\n      kind: 'GREENSHED'")) {
  throw new Error('Generic G<summary> must not remain a current Green Shed parser definition.');
}

for (const marker of [
  'build.summary.number,\n          build.part_type.code,',
  'GSR-<summary> for RING or GSP-<summary> for PINION',
]) {
  if (!greenshedService.includes(marker)) throw new Error(`Green Shed backend missing ${marker}`);
}
if (!(/buildSummaryShelfTag\(\s*['"]GREENSHED['"]\s*,\s*this\.build\.summary_number\s*,\s*this\.build\.part_type_code\s*,?\s*\)/).test(greenshedPull)) {
  throw new Error('Green Shed pull UI must calculate the expected shelf from Summary + Part Type.');
}
if (!greenshedPullHtml.includes('GSR- + Summary for RING or GSP- + Summary for PINION')) {
  throw new Error('Green Shed pull UI must explain the dashed part-specific scanner convention.');
}

for (const marker of [
  'CutterBladeRequirementOrmEntity',
  'assertSummaryShelfReferences',
  'partType.code = :partTypeCode',
  'Green Shed cutter shelves must use GSR-<summary> for RING or GSP-<summary> for PINION',
]) {
  if (!locationService.includes(marker)) throw new Error(`Location backend missing ${marker}`);
}
if (!locationTrayService.includes("location.department === 'GREENSHED'")) {
  throw new Error('Generic tray movement must reject all Green Shed cutter shelves.');
}

for (const marker of [
  'GSR-<summary>/GSP-<summary> for Green Shed',
]) {
  if (!locationDto.includes(marker)) throw new Error(`Location DTO documentation missing ${marker}`);
}
if (!adminHtml.includes('GSR-') || !adminHtml.includes('shelf.partTypeCode')) {
  throw new Error('Admin Locations must expose the GSR-/GSP- part-type convention.');
}

for (const marker of [
  "requirement.part_type_code === 'RING' ? 'GSR-' : 'GSP-'",
  "locationSerial.startsWith('GSR-')",
  "locationSerial.startsWith('GSP-')",
  'legacy/invalid Green Shed shelf tag',
]) {
  if (!seed.includes(marker)) throw new Error(`Mock seed missing ${marker}`);
}
if (!fixtures.includes("requirement.part_type_code === 'RING' ? 'GSR-' : 'GSP-'")) {
  throw new Error('E2E fixture creation must create the dashed part-specific Green Shed shelf.');
}
if (!workflow.includes("ValidateSet('GSR','GSP','CGDR','CGDP','CGFR','CGFP')") || !workflow.includes('return "$Prefix-$(Normalize-Summary $SummaryNumber)"')) {
  throw new Error('Full workflow must generate dashed Summary shelf tags.');
}
if (!master.includes('Resolve-PartTypeCodeFromPart') || !master.includes('PartTypeCode  = $workflowPartTypeCode')) {
  throw new Error('Master workflow runner must pass the resolved RING/PINION Part Type into the shelf convention test.');
}
for (const tool of [shelfTest, ensureShelves]) {
  if (!tool.includes("ValidateSet('RING','PINION')") || !tool.includes('CGD$cuttergrindPart-$summary') || !tool.includes('CGF$cuttergrindPart-$summary')) {
    throw new Error('Shelf helper/test must require RING or PINION and generate dashed Summary shelf tags.');
  }
}
for (const marker of [
  '`GSR-${summary}`',
  '`GSP-${summary}`',
  '`CGDR-${summary}`',
  '`CGDP-${summary}`',
  '`CGFR-${summary}`',
  '`CGFP-${summary}`',
  'No merge was attempted',
  'Re-run with --apply to apply only SAFE rows',
]) {
  if (!migration.includes(marker)) throw new Error(`Summary shelf migration missing ${marker}`);
}

console.log('[PASS] Green Shed part-specific shelf contract passed: RING uses GSR-<summary>, PINION uses GSP-<summary>, and all Summary shelf tags use the prefix-summary dash.');
