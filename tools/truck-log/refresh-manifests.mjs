// Regenerates every checksum manifest in the source tree.
//
//   node tools/truck-log/refresh-manifests.mjs          rewrite the manifests
//   node tools/truck-log/refresh-manifests.mjs --check  fail if any manifest is stale
//
// Manifests:
//   apps/rxo-integration/RUNTIME-MANIFEST.json  RXO exporter runtime files incl. libs/truck-log/rxo-shared (checked at API start)
//   MANIFEST-SHA256.txt                         every shipped file (checked with `sha256sum -c`)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

// Same exclusions as .gitignore / .dockerignore: build output, dependencies, runtime data, secrets.
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.nx', '.angular', 'coverage', 'tmp', '.runtime-logs', '.new-host-state', '.setup-backups']);
const EXCLUDED_FILES = new Set(['MANIFEST-SHA256.txt', '.env']);
const RUNTIME_DATA = [/^data\/documents\/(?!\.gitkeep$)/, /^data\/rxo\/(latest|previous|\.incoming-)/];

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) out.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name) && !RUNTIME_DATA.some((re) => re.test(rel)) && !rel.endsWith('.tmp.json')) {
      out.push(rel);
    }
  }
  return out;
}

const stale = [];
function write(relative, content) {
  const file = path.join(root, relative);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === content) return;
  if (check) stale.push(relative);
  else fs.writeFileSync(file, content);
}

// 1. RXO runtime manifest: every file the exporter image is built from.
const runtimePath = 'apps/rxo-integration/RUNTIME-MANIFEST.json';
const runtime = JSON.parse(fs.readFileSync(path.join(root, runtimePath), 'utf8'));
const rxoRoot = path.join(root, 'apps/rxo-integration');
const runtimeFiles = [
  ...walk(path.join(rxoRoot, 'src'), 'apps/rxo-integration/src').filter((f) => !/\.test\.mjs$/.test(f)),
  // The shared RXO modules are copied over the src/lib re-export shims in the image.
  ...walk(path.join(root, 'libs/truck-log/rxo-shared'), 'libs/truck-log/rxo-shared'),
  'apps/rxo-integration/Dockerfile',
  'apps/rxo-integration/Dockerfile.dockerignore',
  'apps/rxo-integration/package.json',
];
runtime.release = version;
runtime.files = Object.fromEntries(runtimeFiles.map((rel) => {
  const bytes = fs.readFileSync(path.join(root, rel));
  return [rel, { sha256: sha256(bytes), bytes: bytes.length }];
}));
// Digest of /app/src exactly as the exporter image lays it out (src/ with the shared
// modules copied over their shims). The API recomputes it inside the running container:
//   cd /app && find src -type f | LC_ALL=C sort | xargs sha256sum | sha256sum
const imageFiles = new Map();
for (const rel of walk(path.join(rxoRoot, 'src'), 'src')) imageFiles.set(rel, path.join(rxoRoot, rel));
for (const rel of walk(path.join(root, 'libs/truck-log/rxo-shared'), '')) imageFiles.set(`src/lib/${rel}`, path.join(root, 'libs/truck-log/rxo-shared', rel));
const imageListing = [...imageFiles.keys()].sort().map((rel) => `${sha256(fs.readFileSync(imageFiles.get(rel)))}  ${rel}\n`).join('');
runtime.imageSourceDigest = sha256(Buffer.from(imageListing));
write(runtimePath, JSON.stringify(runtime, null, 2) + '\n');

// 2. Whole-package manifest (computed after the runtime manifest is final).
const lines = walk(root).map((rel) => {
  const bytes = rel === runtimePath && !check ? Buffer.from(JSON.stringify(runtime, null, 2) + '\n') : fs.readFileSync(path.join(root, rel));
  return `${sha256(bytes)}  ${toPosix(rel)}`;
});
write('MANIFEST-SHA256.txt', lines.join('\n') + '\n');

if (check && stale.length) {
  console.error(`[FAIL] Stale manifest(s): ${stale.join(', ')}. Run: node tools/truck-log/refresh-manifests.mjs`);
  process.exit(1);
}
console.log(check ? '[PASS] Manifests are current.' : `[PASS] Manifests refreshed for Truck Log ${version}.`);
