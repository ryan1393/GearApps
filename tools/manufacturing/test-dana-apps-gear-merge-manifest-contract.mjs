import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { buildGearMergeManifest, stableStringify } from './generate-dana-apps-gear-merge-manifest.mjs';

const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const manifestPath = 'docs/manufacturing/DANA_APPS_GEAR_MERGE_MANIFEST.json';
must(fs.existsSync(contractPath(process.cwd(), manifestPath)), 'docs/manufacturing/DANA_APPS_GEAR_MERGE_MANIFEST.json is missing.');

const expected = buildGearMergeManifest(process.cwd());
const actual = JSON.parse(fs.readFileSync(contractPath(process.cwd(), manifestPath), 'utf8'));

must(
  stableStringify(actual) === stableStringify(expected),
  'Gear merge manifest is stale. Regenerate it with node tools/manufacturing/generate-dana-apps-gear-merge-manifest.mjs.'
);

must(actual.schemaVersion === 1, 'Gear merge manifest schemaVersion must remain 1.');
must(actual.baseline === 'Dana Apps V70.0.0', 'Dana Apps merge manifest baseline is not V70.0.0.');
must(
  typeof actual.authoritativeTest === 'string' && actual.authoritativeTest.length > 0,
  'Gear merge manifest is missing the authoritative test:meshforge command.'
);
must(
  actual.sourcePackager === 'tools/package-release.mjs',
  'Gear merge manifest is missing the maintained safe source packager.'
);
must(
  actual.masterUiBaseline === 'docs/manufacturing/DANA_MASTER_UI_BASELINE.md',
  'Gear merge manifest is missing the Dana master UI baseline.'
);
must(
  actual.gearPreMergeReadiness === 'docs/manufacturing/DANA_APPS_GEAR_PREMERGE_READINESS.md',
  'Gear merge manifest is missing Gear pre-merge readiness documentation.'
);
must(
  actual.sourcePackageHygiene === 'docs/manufacturing/DANA_APPS_SOURCE_PACKAGE_HYGIENE.md',
  'Gear merge manifest is missing source-package hygiene documentation.'
);

const names = new Set(actual.projects.map((p) => p.name).filter(Boolean));
for (const name of ['lapper-client', 'lapper-read', 'blade-tracking', 'cutter-builder', 'greenshed', 'meshforge-server']) {
  must(names.has(name), `Gear merge manifest is missing runtime project ${name}`);
}
must(
  actual.runtimeProjects.every((p) => !p.missing),
  'One or more protected Gear runtime projects are missing.'
);
must(
  actual.runtimeProjects
    .filter((p) => ['blade-tracking', 'cutter-builder', 'greenshed'].includes(p.name))
    .every((p) => p.hasBuildTarget),
  'Every Gear frontend runtime project must retain a build target.'
);
must(
  actual.rootHashes['package-lock.json'],
  'Gear merge manifest must record package-lock.json SHA-256.'
);
must(
  Array.isArray(actual.projects) && actual.projects.length > 0,
  'Gear merge manifest project inventory is empty.'
);

const duplicateNames = [...names].filter(
  (name) => actual.projects.filter((p) => p.name === name).length > 1
);
must(
  duplicateNames.length === 0,
  `Gear merge manifest contains duplicate Nx project names: ${duplicateNames.join(', ')}`
);

console.log(
  `[PASS] Dana Apps Gear merge manifest contract: ${actual.projects.length} Nx projects inventoried, protected Gear runtime identities present, root/config hashes captured, and manifest matches the live workspace.`
);

must(actual.workspace === 'single-root', 'Manifest must describe the single repository workspace');
