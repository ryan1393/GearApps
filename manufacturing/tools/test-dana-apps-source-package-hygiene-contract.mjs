import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const packager = read('tools/package-dana-apps-source.ps1');
const policy = read('DANA_APPS_SOURCE_PACKAGE_HYGIENE.md');
const runner = read('tools/run-all-tests.ps1');

for (const marker of [
  'DAP-',
  '$ExcludedRootDirectories',
  '$ExcludedRootPaths',
  "'node_modules'",
  "'.nx'",
  "'.git'",
  "'_patch_backups'",
  "'_archive'",
  "'/XJ'",
  "'.env.example'",
  "'.env.sample'",
  "'.env.template'",
  "if ($name -eq '.env')",
  "if ($name -eq '.npmrc')",
  'rxo-browser-state',
  'storage-state',
  'auth-state',
  "'.pem'",
  "'.key'",
  "'.pfx'",
  "'.p12'",
  "'.sqlite'",
  'Test-BlockedPackageFile',
  'Get-StagedPackageFiles',
  'Staging audit could not enumerate a copied path',
  '$remainingBlocked',
  'Compress-Archive',
]) {
  must(packager.includes(marker), `Safe source packager missing ${marker}`);
}

must(
  !packager.includes("Compress-Archive -Path $Root"),
  'Safe source packager must never compress the working repository directly.'
);
must(
  packager.includes('Compress-Archive -LiteralPath $StageProject'),
  'Safe source packager must compress only the audited staging tree.'
);
must(
  packager.includes("Get-ChildItem -LiteralPath $StageProject -Recurse -Force -File -ErrorAction Stop"),
  'Staging audit must fail closed when a remaining staged path cannot be enumerated.'
);
must(
  packager.includes('$global:LASTEXITCODE = 0'),
  'Safe packager must normalize accepted Robocopy success codes so callers do not receive a stale non-zero native exit code.'
);
must(
  !packager.includes(') + $ExcludedDirectories + @('),
  'Safe packager must not use bare-name Robocopy /XD exclusions that can remove legitimate nested source directories.'
);
must(
  packager.includes(') + $ExcludedRootPaths + @('),
  'Safe packager must pass absolute root-only exclusion paths to Robocopy /XD.'
);
must(
  packager.includes('Assert-StagedSourceCompleteness'),
  'Safe packager must compare live and staged source inventory before ZIP creation.'
);

for (const marker of [
  'Dana Apps Source Package Hygiene',
  'short temporary path',
  '`_archive`',
  'junctions',
  'The release rule applies to packaged source artifacts',
  '.env.example',
  'RXO/browser/auth/cookie state JSON files',
]) {
  must(policy.includes(marker), `Source-package hygiene policy missing ${marker}`);
}

must(
  runner.includes('test-dana-apps-source-package-hygiene-contract.mjs'),
  'Authoritative Gear runner does not include source-package hygiene contract.'
);
must(
  runner.includes("Add-MasterResult 'Dana Apps source package hygiene contract' 'PASS'"),
  'Authoritative Gear runner does not record source-package hygiene PASS status.'
);

console.log(
  '[PASS] Dana Apps source package hygiene contract: short staging path, root-only exclusions, nested source preservation, _archive/junction exclusion, sensitive-file filtering, fail-closed staging audit, and staged ZIP creation are enforced.'
);
