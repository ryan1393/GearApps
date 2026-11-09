import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(contractPath(process.cwd(), p), 'utf8');
const exists = (p) => fs.existsSync(contractPath(process.cwd(), p));
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const packageJson = JSON.parse(read('package.json'));
const baseline = read('DANA_MASTER_UI_BASELINE.md');
const readiness = read('DANA_APPS_GEAR_PREMERGE_READINESS.md');
const runner = read('tools/run-all-tests.ps1');
const sharedStyles = read('vendor/dana-ui/package/styles/gear-apps.css');
const gearStyles = read('vendor/dana-ui/package/styles/gear-compat-features.css');

must(packageJson.scripts?.['test:gear-apps'], 'package.json is missing authoritative test:gear-apps script.');

for (const p of [
  'apps/blade-tracking/project.json',
  'apps/cutter-builder/project.json',
  'apps/greenshed/project.json',
  'apps/server/project.json',
  'vendor/dana-ui/package/index.d.ts',
  'vendor/dana-ui/package/styles/gear-apps.css',
  'vendor/dana-ui/package/styles/gear-compat-features.css',
  'tools/test-dana-master-ui-freeze-contract.mjs',
  'tools/test-dana-apps-premerge-contract.mjs',
]) {
  must(exists(p), `Gear pre-merge required path missing: ${p}`);
}

const serverProject = JSON.parse(read('apps/server/project.json'));
must(
  serverProject.name === 'gear-app-server' || read('apps/server/project.json').includes('"gear-app-server"'),
  'apps/server must remain the Gear backend Nx project (gear-app-server) during pre-merge.'
);

for (const project of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const cfg = JSON.parse(read(`apps/${project}/project.json`));
  const styles = cfg?.targets?.build?.options?.styles ?? [];
  const dana = 'libs/shared/dana-ui/src/styles/gear-compat.css';
  const gear = 'libs/shared/dana-ui/src/styles/gear-compat-features.css';
  const danaAt = styles.indexOf(dana);
  const gearAt = styles.indexOf(gear);
  must(danaAt >= 0, `${project} does not load Dana shared UI`);
  must(gearAt >= 0, `${project} does not load Gear domain UI`);
  must(danaAt < gearAt, `${project} must load Dana shared UI before Gear domain UI`);
}

for (const name of [
  'blade-dashboard.css',
  'cutter-builder.css',
  'greenshed-running-machines.css',
  'inventory-core.css',
  'inventory-relations.css',
  'scrap-blades.css',
]) {
  must(!sharedStyles.includes(name), `Dana shared UI reabsorbed Gear workflow CSS ${name}`);
  must(gearStyles.includes(name), `Gear domain UI is missing ${name}`);
}

for (const marker of [
  'Dana Apps Master UI Baseline',
  '`libs/shared/ui-tailwind` owns reusable Dana presentation',
  '`libs/gear/ui` owns Gear-specific workflow presentation',
]) {
  must(baseline.includes(marker), `Dana master UI baseline missing ${marker}`);
}

for (const marker of [
  'Gear Apps V69.3.0R1 marks the Gear side as ready',
  '`apps/server` (Nx project name remains `gear-app-server` for now)',
  '`npm run test:gear-apps` remains the authoritative Gear regression gate',
  'Gear database/schema/data remain separate from Truck Log',
  'The future monorepo may contain Truck Log paths',
]) {
  must(readiness.includes(marker), `Gear pre-merge readiness document missing ${marker}`);
}

for (const test of [
  'test-dana-master-ui-freeze-contract.mjs',
  'test-dana-apps-gear-premerge-readiness-contract.mjs',
]) {
  must(runner.includes(test), `Authoritative Gear runner missing ${test}`);
}


must(
  runner.includes('test-dana-apps-premerge-contract.mjs'),
  'Authoritative Gear runner is missing the canonical Dana Apps pre-merge contract.'
);

must(
  runner.includes("Add-MasterResult 'Dana Apps Gear pre-merge readiness contract' 'PASS'"),
  'Authoritative Gear runner does not record Gear pre-merge readiness PASS status.'
);

console.log(
  '[PASS] Dana Apps Gear pre-merge readiness contract: Gear apps/backend, master UI ownership, domain style layering, and authoritative Gear regression entry point are protected for the future Truck Log merge.'
);
