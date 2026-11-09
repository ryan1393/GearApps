import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = process.cwd();
const source = path.join(root, 'apps', 'rxo-integration');
const output = path.join(root, 'dist', 'apps', 'rxo-integration');
const release = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

if (!fs.existsSync(source)) throw new Error('apps/rxo-integration is missing.');
if (fs.existsSync(path.join(source, 'docker-compose.yml'))) throw new Error('apps/rxo-integration/docker-compose.yml must not exist; the root docker-compose.yml is the only Compose file.');

/** Walk the application deterministically so Nx build output preserves src/ and ops files. */
function walk(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...walk(path.join(dir, entry.name), rel));
      continue;
    }
    if (!entry.isFile()) continue;
    if (['project.json', '.gitignore'].includes(rel)) continue;
    files.push(rel);
  }
  return files;
}

const sourceFiles = walk(source);

for (const rel of [
  'package.json',
  'Dockerfile',
  'src/rxo-fort-wayne-export.mjs',
  'src/rxo-scheduler.mjs',
  'src/lib/rxo-auth.mjs',
  'src/lib/rxo-export-publication.mjs',
  'src/lib/rxo-filter-input.mjs',
  'src/lib/rxo-filter-selection.mjs',
  'remote-docker.ps1',
  'RUNTIME-MANIFEST.json',
]) {
  if (!sourceFiles.includes(rel)) throw new Error(`RXO build input missing: ${rel}`);
}

for (const rel of sourceFiles.filter((name) => name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(source, rel)], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Node syntax check failed: ${rel}`);
}

fs.rmSync(output, { recursive: true, force: true });
for (const rel of sourceFiles) {
  const from = path.join(source, rel);
  const to = path.join(output, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
// The image copies libs/truck-log/rxo-shared over the src/lib re-export shims; mirror that here.
const sharedRoot = path.join(root, 'libs', 'truck-log', 'rxo-shared');
for (const name of fs.readdirSync(sharedRoot).filter((file) => file.endsWith('.mjs')).sort()) {
  fs.copyFileSync(path.join(sharedRoot, name), path.join(output, 'src', 'lib', name));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const manifest = {
  project: 'rxo-integration',
  release,
  builtAt: new Date().toISOString(),
  files: sourceFiles.map((rel) => ({
    file: rel,
    sha256: sha256(path.join(output, rel)),
    bytes: fs.statSync(path.join(output, rel)).size,
  })),
};

fs.writeFileSync(path.join(output, 'nx-build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[PASS] Built rxo-integration release ${release} at ${path.relative(root, output)}`);
