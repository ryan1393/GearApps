import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// Applications consume this one root package and its complete compatibility CSS.
const vendor = path.join(root, 'vendor/dana-ui');
const staged = path.join(vendor, '.package-next');
fs.mkdirSync(vendor, { recursive: true });
fs.rmSync(staged, { recursive: true, force: true });
fs.cpSync(output, staged, { recursive: true });
fs.rmSync(path.join(vendor, 'package'), { recursive: true, force: true });
fs.renameSync(staged, path.join(vendor, 'package'));
for (const file of fs.readdirSync(vendor)) {
  if (file.endsWith('.tgz')) fs.rmSync(path.join(vendor, file));
}
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(output);
const sha = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
const lines = files.map(file => [path.relative(output, file).replaceAll('\\', '/'), file])
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([relative, file]) => `${sha(fs.readFileSync(file))}  ${relative}\n`).join('');
const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
const workspacePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(vendor, 'VENDOR_MANIFEST.json'), JSON.stringify({
  schemaVersion: 1, danaAppsVersion: workspacePackage.version, packageName: '@dana/ui',
  packageVersion: pkg.version, visualSource: 'Truck Log',
  dependency: 'file:vendor/dana-ui/package', sourceProject: 'libs/shared/dana-ui',
  vendoredTreeSha256: sha(lines),
  vendoredTreeHashAlgorithm: 'SHA-256 of sorted UTF-8 lines: uppercase file SHA-256, two spaces, relative POSIX path, newline',
}, null, 2) + '\n');
console.log(`[PASS] Dana UI ${pkg.version} built with root dependencies and synchronized to vendor/dana-ui/package.`);
