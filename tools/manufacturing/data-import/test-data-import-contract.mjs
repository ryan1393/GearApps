import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => fs.readFileSync(contractPath(root, p), 'utf8').replace(/^\uFEFF/, '');
const json = (p) => JSON.parse(read(p));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const pkg = json('package.json');
const orchestrator = read('tools/manufacturing/data-import/import-all-fresh.ps1');
const history = read('tools/manufacturing/cutter-history/import-cutter-history-DYNAMIC-FAST-AUDITED.mjs');
const baseImporter = read('tools/manufacturing/base-data/import-base-data.mjs');

const supplements = {
  summary_additions: json('tools/manufacturing/base-data/data/summary_additions.json'),
  cutter_blade_requirements: json('tools/manufacturing/base-data/data/cutter_blade_requirements.json'),
  cutter_body_definitions: json('tools/manufacturing/base-data/data/cutter_body_definitions.json'),
  cutter_bodies: json('tools/manufacturing/base-data/data/cutter_bodies.json'),
};

assert(supplements.summary_additions.length === 15, 'Expected 15 summary additions');
assert(supplements.cutter_blade_requirements.length === 216, 'Expected 216 blade requirements');
assert(supplements.cutter_body_definitions.length === 6, 'Expected 6 cutter-body definitions');
assert(supplements.cutter_bodies.length === 120, 'Expected 120 cutter-body reference mappings');

for (const name of [
  'summary_additions.json',
  'cutter_blade_requirements.json',
  'cutter_body_definitions.json',
  'cutter_bodies.json',
]) {
  assert(orchestrator.includes(name), `All-data orchestrator does not merge ${name}`);
}

assert(
  orchestrator.includes('export-base-data-FRESH-SAFE.ps1'),
  'All-data orchestrator does not fresh-export SQL Server base data',
);
assert(
  orchestrator.includes('export-cutter-history-FRESH-SAFE.ps1'),
  'All-data orchestrator does not fresh-export SQL Server cutter history',
);
assert(
  orchestrator.indexOf('& node $BaseImporter $BaseFresh') <
    orchestrator.indexOf('& node $HistoryImporter $HistoryFresh --apply'),
  'Base/reference import must occur before cutter-history apply',
);
assert(
  orchestrator.includes("if (-not $Apply)"),
  'All-data import must have safe preflight mode',
);

assert(
  !history.includes("DELETE FROM cutter_bodies"),
  'History refresh must preserve physical cutter-body records',
);
assert(
  history.includes('isLegacyBodyPlaceholder') &&
    history.includes('LEGACY-UNKNOWN-'),
  'History importer must isolate legacy placeholder cutter-body values instead of merging them as one physical cutter',
);
assert(
  history.includes('missing_or_placeholder_body_assigned_synthetic') &&
    !history.includes("reason: 'missing Cutter_Body_ID',\n    });\n    continue;"),
  'History importer must preserve builds with missing cutter-body IDs using synthetic MF identities instead of skipping them',
);
assert(
  history.includes('cutter-history-legacy-orphans.json') &&
    history.includes('archiveLegacyOrphan') &&
    !history.includes('cutter_legacy_orphan_records'),
  'Unmappable legacy detail rows must be archived to a file beside the import report rather than silently discarded',
);

assert(
  history.includes("'CENTRAL_LOG_DUPLICATE'") &&
    history.includes('Timestamp-only repeat inserts archived'),
  'Duplicate Central Log rows for one logical check must archive extras instead of creating duplicate work',
);
assert(
  !history.includes("Date: clean(get(log, ['Date']))") ||
    history.includes('const logTimestamp'),
  'Central-log duplicate identity must not treat timestamp-only repeat inserts as distinct operations',
);
assert(
  history.includes('exact_duplicate_central_logs_collapsed') &&
    history.includes('logBusinessFingerprint') &&
    history.includes('conflicting duplicate central-log rows'),
  'Exact duplicate central logs must be collapsed safely while conflicting duplicates remain fatal',
);
assert(
  history.includes('Archive-only by design') &&
    history.includes('Do NOT create cutter_builds, cutter_events'),
  'Orphan BUILD rows without an exact CB relationship must be archive-only with no target logs/events',
);
assert(
  history.includes('dana_serial_number') && history.includes('mf_serial_number'),
  'History importer must understand Dana + MF cutter-body identifiers',
);
assert(
  history.includes('knownBodyCanonicalByIdentifier'),
  'History importer must canonicalize MF and Dana to one physical cutter before increment/open-build logic',
);
assert(
  history.includes("mf_serial_number: src.body") &&
    history.includes("dana_serial_number: null"),
  'Unknown legacy cutters must be created MF-only; Dana must not be invented',
);
assert(
  !history.includes("'serial_number'"),
  'History importer still contains legacy cutter-body serial_number column',
);

assert(
  baseImporter.includes('cutter_blade_requirements.json') &&
    baseImporter.includes('cutter_body_definitions.json') &&
    baseImporter.includes('cutter_bodies.json'),
  'Base importer is missing Excel-derived reference datasets',
);


const requirementSummaryKeys = new Set(
  supplements.cutter_blade_requirements.map(
    (row) => `${String(row.Summary).trim()}\u0000${String(row.Summary_Rev ?? '').trim()}`,
  ),
);
assert(
  requirementSummaryKeys.size === 108,
  `Expected 108 unique Summary+Revision keys in blade requirements; found ${requirementSummaryKeys.size}`,
);
assert(
  requirementSummaryKeys.has('30135\u0000'),
  'Regression guard: Summary 30135 from the blade-requirement workbook is missing',
);


const packagedSummaries = json('tools/manufacturing/base-data/data/summaries.json');
const summary30135 = packagedSummaries.filter(
  (row) => String(row.Summary ?? '').trim() === '30135',
);
assert(
  summary30135.length === 1 &&
    String(summary30135[0].Summary_Rev ?? '').trim() === 'B',
  'Regression fixture expected SQL snapshot Summary 30135 revision B',
);
assert(
  baseImporter.includes('resolveBladeRequirementSummaryIds') &&
    baseImporter.includes('for (const summaryId of summaryIds)') &&
    baseImporter.includes('return matches.rows.map((r) => r.id);'),
  'Base importer must apply a blank-revision Excel requirement to every enabled revision of that Summary (same blade count across revisions, confirmed 2026-10-27)',
);
assert(
  baseImporter.includes('existingByNumber.rows.length >= 1') &&
    baseImporter.includes('summary_additions.json contains a blank Summary'),
  'Supplemental missing-summary import must reuse a newly available fresh SQL revision instead of creating a duplicate blank revision',
);


// Every blade-requirement Summary in the packaged regression snapshot must be
// either represented by exactly one SQL revision or be one of the supplemental
// summary additions. This specifically guards blank-revision mismatch bugs.
const packagedSummaryRevisions = new Map();
for (const row of packagedSummaries) {
  const number = String(row.Summary ?? '').trim();
  if (!number) continue;
  if (!packagedSummaryRevisions.has(number)) packagedSummaryRevisions.set(number, new Set());
  packagedSummaryRevisions.get(number).add(String(row.Summary_Rev ?? '').trim());
}
const supplementalSummaryNumbers = new Set(
  supplements.summary_additions.map((row) => String(row.Summary ?? '').trim()),
);
for (const key of requirementSummaryKeys) {
  const [number] = key.split('\u0000');
  const revisions = packagedSummaryRevisions.get(number);
  assert(
    (revisions && revisions.size === 1) || supplementalSummaryNumbers.has(number),
    `Blade requirement Summary ${number} is neither uniquely represented by SQL data nor present in summary_additions`,
  );
}
console.log('[PASS] Every blade-requirement Summary is either present once in the SQL regression snapshot or explicitly supplemental.');
// Master scope comes from summaries.json + summary_additions.json (checked above). A blade
// requirement row must never create a Summary; one outside master data is skipped and reported.
assert(
  !baseImporter.includes('bladeRequirementSummaryKeys') &&
    baseImporter.includes("reason: 'Summary is not in master data; requirement not created'"),
  'Base importer must not create Summaries from blade-requirement rows',
);

for (const script of [
  'import:all-fresh',
  'import:all-fresh:apply',
  'export:base:fresh',
  'export:cutter-history:fresh',
]) {
  assert(pkg.scripts?.[script], `package.json missing ${script}`);
}

const manifest = json('tools/manufacturing/api-route-manifest.json');
const routes = Array.isArray(manifest) ? manifest : manifest.routes;
assert(routes.length === 119, `Expected 119 API routes; found ${routes.length}`);

console.log('[PASS] Fresh all-data import contract validated.');
console.log({
  summary_additions: supplements.summary_additions.length,
  cutter_blade_requirements: supplements.cutter_blade_requirements.length,
  cutter_body_definitions: supplements.cutter_body_definitions.length,
  cutter_bodies: supplements.cutter_bodies.length,
  api_routes: routes.length,
});

const routeProbe = read('tools/manufacturing/test-all-api-routes.ps1');
assert(
  routeProbe.includes('Count -ne 119') &&
    !routeProbe.includes('Count -ne 103'),
  'Runtime API route probe is not synchronized to the 119-route manifest',
);
