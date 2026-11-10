import { contractPath } from './lib/contract-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readContract, workspaceRoot } from './lib/contract-paths.mjs';

const command = readContract('PACKAGE-DANA-APPS-SOURCE.cmd');
const runner = readContract('tools/run-all-tests.ps1');
assert.ok(
  command.includes('package-gear-for-dana-apps.ps1'),
  'Existing Windows handoff launcher must stay connected.',
);
for (const file of [
  'tools/package-gear-for-dana-apps.ps1',
  'tools/package-dana-apps-source.ps1',
]) {
  const script = readContract(file);
  for (const marker of [
    "Join-Path $PSScriptRoot '../..'",
    'tools/package-release.mjs',
    '--output-dir',
    '$LASTEXITCODE -ne 0',
    'Push-Location $WorkspaceRoot',
    'Pop-Location',
  ]) {
    assert.ok(
      script.includes(marker),
      `${file} must delegate complete workspace packaging and propagate failure: ${marker}`,
    );
  }
  assert.ok(
    !script.includes("Join-Path $Root 'package.json'"),
    `${file} must not require the removed nested manifest.`,
  );
}
const canonical = fs.readFileSync(
  contractPath(process.cwd(), path.join(workspaceRoot, 'tools/package-release.mjs')),
  'utf8',
);
assert.ok(
  canonical.includes('GearApps-${pkg.version}.zip'),
  'Release archive identity must follow the single root release version.',
);
assert.ok(
  canonical.includes("'--output-dir'"),
  'Root packager must support the compatibility wrappers output directory.',
);
assert.ok(
  canonical.includes('process.argv[1]') &&
    canonical.includes('fileURLToPath(import.meta.url)'),
  'Importing packaging policy must not create an archive.',
);
const pkg = JSON.parse(readContract('package.json'));
assert.ok(
  pkg.scripts['package:release']?.includes('tools/package-release.mjs'),
  'The release command must use the canonical root packager.',
);
assert.ok(
  readContract('DANA_APPS_GEAR_HANDOFF_PACKAGE.md').includes(
    'npm run package:release',
  ),
);
assert.ok(runner.includes('test-dana-apps-gear-handoff-package-contract.mjs'));
assert.ok(
  runner.includes(
    "Add-MasterResult 'Dana Apps Gear handoff package contract' 'PASS'",
  ),
);
console.log(
  '[PASS] Historical handoff entry points package the complete workspace through one versioned root release tool.',
);
