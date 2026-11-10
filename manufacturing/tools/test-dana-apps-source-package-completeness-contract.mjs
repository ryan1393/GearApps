import { contractPath } from './lib/contract-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readContract, workspaceRoot } from './lib/contract-paths.mjs';
import { packageFileAllowed } from '../../tools/package-release.mjs';

const routes = readContract(
  'libs/frontend/feature-cutter-builder/src/lib/cutter-builder.routes.ts',
);
const runner = readContract('tools/run-all-tests.ps1');
assert.ok(
  routes.includes('./pages/build/cutter-build.component'),
  'Cutter Builder must retain its build route.',
);
for (const file of [
  'package.json',
  'package-lock.json',
  'nx.json',
  'apps/lapper-client/src/main.ts',
  'apps/lapper-read/Directory.Build.props',
  'apps/lapper-read/project.json',
  'apps/lapper-read/LapperRead/Program.cs',
  'apps/lapper-read/LapperReadLibrary/BusinessLogic/Fanuc.cs',
  'apps/lapper-read/LapperRead.Tests/ApiTests.cs',
  'apps/blade-tracking/project.json',
  'apps/cutter-builder/project.json',
  'apps/greenshed/project.json',
  'apps/server/src/main.ts',
  'manufacturing/libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts',
  'manufacturing/libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html',
  'libs/shared/dana-ui/src/index.ts',
  'vendor/dana-ui/package/index.d.ts',
]) {
  assert.ok(
    fs.existsSync(contractPath(process.cwd(), path.join(workspaceRoot, file))),
    `Live release source missing: ${file}`,
  );
  assert.equal(
    packageFileAllowed(file),
    true,
    `Release policy omitted live source: ${file}`,
  );
}
for (const generated of [
  'dist/apps/server/main.js',
  'manufacturing/node_modules/a/index.js',
]) {
  assert.equal(
    packageFileAllowed(generated),
    false,
    `Generated output must be excluded: ${generated}`,
  );
}
assert.ok(
  runner.includes('test-dana-apps-source-package-completeness-contract.mjs'),
);
assert.ok(
  runner.includes(
    "Add-MasterResult 'Dana Apps source package completeness contract' 'PASS'",
  ),
);
console.log(
  '[PASS] Unified release preserves every app group, one dependency authority, shared UI and legitimate nested build-page source.',
);
