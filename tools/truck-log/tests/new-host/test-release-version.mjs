// One version for the whole product. VERSION is the single source of truth;
// every other place that states the release must match it exactly.
//
// To release a new version: edit VERSION, update the copies this test lists,
// then run `node tools/truck-log/refresh-manifests.mjs`.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));
let checks = 0;
const must = (ok, message) => {
  checks++;
  if (!ok) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

const version = read('VERSION').trim();
must(/^\d+\.\d+\.\d+$/.test(version), `VERSION is SemVer (${version})`);

// npm manifests
for (const p of ['package.json', 'apps/rxo-integration/package.json', 'apps/rxo-expedite/package.json']) {
  must(json(p).version === version, `${p} version is ${version}`);
}
const lock = json('package-lock.json');
must(lock.version === version && lock.packages?.['']?.version === version, `package-lock.json root is ${version}`);

// Code constants and fallbacks
must(read('libs/truck-log/shared/contracts/src/index.ts').includes(`export const TRUCK_LOG_VERSION = '${version}';`),
  'shared TRUCK_LOG_VERSION constant matches');
for (const p of [
  'apps/rxo-integration/src/rxo-scheduler.mjs',
  'apps/rxo-integration/src/lib/rxo-export-config.mjs',
  'apps/rxo-integration/src/lib/rxo-export-login.mjs',
  'apps/rxo-expedite/src/scheduler.mjs',
  'apps/rxo-expedite/src/cli.mjs',
  'apps/rxo-expedite/src/lib/acquisition.mjs',
]) {
  const s = read(p);
  const fallbacks = [...s.matchAll(/TRUCK_LOG_RELEASE\s*\|\|\s*'([^']+)'/g)].map((m) => m[1]);
  must(fallbacks.length > 0 && fallbacks.every((v) => v === version), `${p} release fallback is ${version}`);
}

// Docker
const compose = read('docker-compose.yml');
const composeDefaults = [...compose.matchAll(/\$\{TRUCK_LOG_RELEASE:-([^}]+)\}/g)].map((m) => m[1]);
must(composeDefaults.length >= 14 && composeDefaults.every((v) => v === version), `docker-compose.yml release defaults are ${version}`);
for (const p of ['docker/truck-log/server.Dockerfile', 'docker/truck-log/web.Dockerfile', 'apps/rxo-integration/Dockerfile', 'apps/rxo-expedite/Dockerfile']) {
  const s = read(p);
  const args = [...s.matchAll(/ARG TRUCK_LOG_RELEASE=(\S+)/g)].map((m) => m[1]);
  must(args.length > 0 && args.every((v) => v === version), `${p} build arg defaults to ${version}`);
  must(s.includes('com.dana.truck-log.release="${TRUCK_LOG_RELEASE}"') && s.includes('org.opencontainers.image.version="${TRUCK_LOG_RELEASE}"'),
    `${p} labels the image with the release`);
}
must(read('.env.example').includes(`TRUCK_LOG_RELEASE=${version}\n`), `.env.example release is ${version}`);

// Setup reads VERSION instead of pinning a literal
must(read('SETUP-TRUCK-LOG.sh').includes(`set_env TRUCK_LOG_RELEASE "$(tr -d '[:space:]' < VERSION)"`), 'Linux setup takes the release from VERSION');
must(read('tools/truck-log/setup-docker.ps1').includes("'TRUCK_LOG_RELEASE' ((Get-Content -LiteralPath (Join-Path $Root 'VERSION') -Raw).Trim())"),
  'Windows setup takes the release from VERSION');

// Release manifests
const release = json('RELEASE-MANIFEST.json');
must(release.release === version && release.releaseId === `truck-log-${version}` && release.docker?.imageTag === version
  && release.docker?.containerReleaseLabel === version, `RELEASE-MANIFEST.json is ${version}`);
must(json('apps/rxo-integration/RUNTIME-MANIFEST.json').release === version, `RXO RUNTIME-MANIFEST.json is ${version}`);

// No stale release labels anywhere in the tree. Protocol tags (admin session
// format, RXO auth-state format) are versioned separately as "v1"/"1".
const stalePatterns = [
  /\bTruck[ -]Log[ -]v?0\.1\b/i,
  /TRUCK_LOG_RELEASE\s*\|\|\s*'0\.1'/,
  /TRUCK_LOG_RELEASE:-0\.1\}/,
  /truck-log-admin(-login)?-0\.1/,
  /truck-log-nxdev/,
  /\bnxdev\b/,
];
const hits = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.nx', '.angular'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) { scan(full); continue; }
    if (!entry.isFile() || /\.(png|ico|xlsx|pdf|zip)$/i.test(entry.name)) continue;
    if (['package-lock.json', 'MANIFEST-SHA256.txt'].includes(entry.name) || rel === 'tests/new-host/test-release-version.mjs') continue;
    const text = fs.readFileSync(full, 'utf8');
    // README/CHANGELOG name the old 0.1 test installs only to explain how to remove them.
    const docsAboutOldInstalls = ['README.md', 'CHANGELOG.md'].includes(rel);
    for (const pattern of stalePatterns) {
      if (docsAboutOldInstalls && /nxdev/.test(String(pattern))) continue;
      if (pattern.test(text)) hits.push(`${rel} (${pattern})`);
    }
  }
}
scan(root);
must(hits.length === 0, `no stale release labels in the tree${hits.length ? ':\n  ' + hits.join('\n  ') : ''}`);

console.log(`[PASS] Truck Log ${version} release-version contract: ${checks} checks passed.`);
