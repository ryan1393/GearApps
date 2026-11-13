// The archive gate must remain independent of installation; installed checks may read Dana UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(pkg.scripts['validate:archive'], /test-release-package\.mjs/);
assert.match(pkg.scripts['validate:archive'], /refresh-manifests\.mjs --check/);
assert.doesNotMatch(pkg.scripts['validate:release'], /test-release-package\.mjs/);
assert.match(pkg.scripts['validate:release'], /validate-source\.mjs/);
const setup = fs.readFileSync('tools/truck-log/setup-truck-log.ps1', 'utf8');
assert.ok(setup.indexOf('npm ci --') < setup.indexOf('node tools\\truck-log\\validate-source.mjs'),
  'development setup installs Dana UI before dependent source validation');
console.log('[PASS] Release checks distinguish clean archive hygiene from installed source validation.');
