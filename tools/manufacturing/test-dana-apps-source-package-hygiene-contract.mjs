import { contractPath } from './lib/contract-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readContract, workspaceRoot } from './lib/contract-paths.mjs';
import { packageFileAllowed } from '../../tools/package-release.mjs';

const wrapper = readContract('tools/manufacturing/package-dana-apps-source.ps1');
const policy = readContract('docs/manufacturing/DANA_APPS_SOURCE_PACKAGE_HYGIENE.md');
const runner = readContract('tools/manufacturing/run-all-tests.ps1');
const canonical = fs.readFileSync(
  contractPath(process.cwd(), path.join(workspaceRoot, 'tools/package-release.mjs')),
  'utf8',
);
for (const marker of [
  "Join-Path $PSScriptRoot '../..'",
  'tools/package-release.mjs',
  '--output-dir',
  '$LASTEXITCODE -ne 0',
]) {
  assert.ok(
    wrapper.includes(marker),
    `Legacy source-packaging entry point must delegate to root: ${marker}`,
  );
}
for (const file of [
  '.env',
  '.env.production',
  '.npmrc',
  'config/client.pem',
  'id_ed25519',
  'credentials.json',
  'service-account-production.json',
  'storage-state.json',
  'rxo-browser-state.json',
  'cookies.json',
  'config/secrets/token.json',
  'manufacturing/runtime-data/session.txt',
  'database.sqlite',
  '.git/config',
  'node_modules/a/index.js',
  'manufacturing/_archive/old-source.ts',
])
  assert.equal(packageFileAllowed(file), false, `Release must exclude ${file}`);
for (const file of [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.example',
]) {
  assert.equal(
    packageFileAllowed(file),
    true,
    `Documented template must remain available: ${file}`,
  );
}
assert.ok(
  canonical.includes('entry.isFile()'),
  'Archive traversal must accept regular files rather than following filesystem symlinks.',
);
assert.ok(
  canonical.includes('fs.renameSync(temporary, output)'),
  'Release output must be replaced only after a complete archive is written.',
);
assert.ok(
  policy.includes('npm run package:release') &&
    policy.includes('tools/package-release.mjs'),
  'Packaging policy must identify the canonical workspace packager.',
);
assert.ok(
  runner.includes('test-dana-apps-source-package-hygiene-contract.mjs'),
);
assert.ok(
  runner.includes(
    "Add-MasterResult 'Dana Apps source package hygiene contract' 'PASS'",
  ),
);
console.log(
  '[PASS] Root source packaging excludes credentials, sessions, local databases, caches and historical archives while preserving safe templates.',
);
