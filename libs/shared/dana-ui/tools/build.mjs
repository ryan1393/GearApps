import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, '../../..');
const output = path.join(root, 'dist/libs/shared/dana-ui');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const ngPackageRoot = path.join(root, 'node_modules/ng-packagr');
const ngPackageManifest = JSON.parse(fs.readFileSync(path.join(ngPackageRoot, 'package.json'), 'utf8'));
run([path.resolve(ngPackageRoot, ngPackageManifest.bin['ng-packagr']), '-p', path.join(project, 'ng-package.json'), '-c', path.join(project, 'tsconfig.lib.json')]);
run([path.join(project, 'tools/finalize-package.mjs')]);

console.log('[PASS] Dana UI built to dist/libs/shared/dana-ui. Applications compile the libs/shared/dana-ui source through the @dana/ui path alias.');
