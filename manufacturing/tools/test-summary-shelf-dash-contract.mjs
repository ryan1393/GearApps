import fs from 'node:fs';
const read = (path) => fs.readFileSync(path, 'utf8');
const shelf = read('libs/shared/util-constants/src/lib/shelf-location.constants.ts');
const seed = read('tools/data-import/seed-trays-containers-mock-data.mjs');
const fixtures = read('tools/test-data/ensure-workflow-test-fixtures.mjs');
const workflow = read('tools/test-full-workflow.ps1');
const shelfTest = read('tools/test-shelf-location-conventions.ps1');
const ensureShelves = read('tools/ensure-summary-shelf-locations.ps1');
const adminHtml = read('libs/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html');
const migration = read('tools/data-import/migrate-summary-shelf-tags.mjs');

// Green Shed shelves are per-summary (GSR-/GSP-<summary>). Cuttergrind shelves became
// numbered (CGDR-001 ...) and are parsed by parseCuttergrindNumberedShelfTag.
const currentTags = ['GSR-', 'GSP-'];
for (const prefix of currentTags) if (!shelf.includes(`prefix: '${prefix}'`)) throw new Error(`Shared parser missing ${prefix}`);
if (!shelf.includes('export function parseCuttergrindNumberedShelfTag') || !shelf.includes('(CGDR|CGDP|CGFR|CGFP)-(\\d{3})')) throw new Error('Shared parser missing numbered Cuttergrind shelves');
for (const marker of [
  "return `${partType === 'RING' ? 'GSR' : 'GSP'}-${summary}`;",
  "return `${partType === 'RING' ? 'CGDR' : 'CGDP'}-${summary}`;",
  "return `${partType === 'RING' ? 'CGFR' : 'CGFP'}-${summary}`;",
]) if (!shelf.includes(marker)) throw new Error(`Shared builder missing ${marker}`);
for (const forbidden of ["prefix: 'CGD-'", "prefix: 'CGF-'"]) if (shelf.includes(forbidden)) throw new Error(`Generic Cuttergrind parser prefix remains: ${forbidden}`);

for (const marker of ["cuttergrindPartLetter", "^CGD[RP]-", "^CGF[RP]-", "locationSerial.startsWith('CGDR-')", "locationSerial.startsWith('CGFR-')"]) {
  if (!seed.includes(marker)) throw new Error(`Mock seed missing ${marker}`);
}
for (const marker of ["CGD${requirement.part_type_code === 'RING' ? 'R' : 'P'}-", "CGF${requirement.part_type_code === 'RING' ? 'R' : 'P'}-"]) if (!fixtures.includes(marker)) throw new Error(`Workflow fixture missing ${marker}`);
if (!workflow.includes("ValidateSet('GSR','GSP','CGDR','CGDP','CGFR','CGFP')")) throw new Error('Full workflow does not enforce part-specific Cuttergrind prefixes.');
for (const tool of [shelfTest, ensureShelves]) if (!tool.includes('CGD$cuttergrindPart-$summary') || !tool.includes('CGF$cuttergrindPart-$summary')) throw new Error('Shelf helper/test missing part-specific Cuttergrind tags.');
if (!adminHtml.includes('CGRR-001')) throw new Error('Admin examples missing numbered Cuttergrind shelf tags.');
for (const marker of ['CGD-${summary}', 'CGF-${summary}', 'CGD${summary}', 'CGF${summary}', 'CGDR-${summary}', 'CGDP-${summary}', 'CGFR-${summary}', 'CGFP-${summary}']) if (!migration.includes(marker)) throw new Error(`Migration must understand ${marker}`);
console.log('[PASS] Summary shelf dash contract passed: GSR-/GSP-/CGDR-/CGDP-/CGFR-/CGFP- are canonical and generic CGD-/CGF- are migration-only.');
