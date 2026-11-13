/** Frozen-install regression checks: validate required lock entries without pinning a historical dependency layout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const clone = value => structuredClone(value);
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = read('package.json'), lock = read('package-lock.json');
const dockerfiles = ['server', 'web'].map(name => fs.readFileSync(path.join(root, `docker/truck-log/${name}.Dockerfile`), 'utf8'));
function resolveEntry(packages, location, name) {
  for (let parent = location; ; parent = path.posix.dirname(parent)) {
    const candidate = (parent === '.' || !parent ? '' : parent + '/') + 'node_modules/' + name;
    if (packages[candidate]) return candidate;
    if (parent === '.' || !parent) return null;
  }
}
export function validateBuildInputs(pkg, tree, files) {
  assert.equal(tree.lockfileVersion, 3, 'Expected complete lockfile v3');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(tree.packages[''][field] ?? {}, pkg[field] ?? {}, `${field} manifest/lock mismatch`);
  }
  for (const [location, entry] of Object.entries(tree.packages)) {
    if (!location || entry.link) continue;
    assert.match(entry.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/, `Missing package integrity: ${location}`);
    assert.match(entry.resolved ?? '', /^(https:\/\/registry\.npmjs\.org\/|file:vendor\/dana-ui\/)/, `Unexpected package origin: ${location}`);
    for (const name of Object.keys(entry.dependencies ?? {})) {
      if (entry.optionalDependencies?.[name]) continue;
      assert.ok(resolveEntry(tree.packages, location, name), `Missing dependency lock entry: ${location} -> ${name}`);
    }
  }
  for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
    assert.ok(tree.packages['node_modules/' + name], `Missing direct lock entry: ${name}`);
  }
  const nx = tree.packages['node_modules/nx'];
  assert.equal(nx.bin.nx, 'dist/bin/nx.js');
  for (const file of files) {
    assert(file.includes(`node ./node_modules/nx/${nx.bin.nx}`), 'Dockerfile must invoke locked Nx bin');
    assert(!file.includes('node_modules/nx/bin/nx.js'), 'Obsolete Nx CLI path');
    assert(file.includes('COPY package.json package-lock.json ./'), 'Require both package files at Docker COPY');
    assert.match(file, /RUN npm ci --/, 'Keep frozen npm ci installation');
    assert(!/npm (?:install|update)|--legacy-peer-deps|--package-lock=false/.test(file), 'Do not mask dependency drift');
  }
  return true;
}
let passed = 0;
function test(name, run) { run(); passed++; console.log('[PASS] ' + name); }
test('Actual package pair and complete dependency lock closure', () => validateBuildInputs(manifest, lock, dockerfiles));
test('Reject missing direct dependency', () => { const tree = clone(lock); delete tree.packages['node_modules/nx']; assert.throws(() => validateBuildInputs(manifest, tree, dockerfiles), /Missing .*lock entry/); });
test('Reject missing transitive dependency', () => {
  const tree = clone(lock);
  const location = Object.keys(tree.packages).find(name => name.includes('/node_modules/'));
  assert.ok(location, 'fixture needs a nested package'); delete tree.packages[location];
  // Removing every copy prevents normal hoisting from satisfying this fixture.
  const name = location.split('/node_modules/').at(-1);
  for (const key of Object.keys(tree.packages)) if (key === 'node_modules/' + name || key.endsWith('/node_modules/' + name)) delete tree.packages[key];
  assert.throws(() => validateBuildInputs(manifest, tree, dockerfiles), /Missing .*lock entry/);
});
test('Reject manifest/lock direct dependency drift', () => { const pkg = clone(manifest); pkg.dependencies.pg = '0.0.0'; assert.throws(() => validateBuildInputs(pkg, lock, dockerfiles), /manifest\/lock/); });
test('Reject unsigned package entry', () => { const tree = clone(lock); delete tree.packages['node_modules/nx'].integrity; assert.throws(() => validateBuildInputs(manifest, tree, dockerfiles), /integrity/); });
for (let index = 0; index < 2; index++) test('Reject obsolete Nx path in ' + ['server', 'web'][index], () => {
  const files = [...dockerfiles]; files[index] = files[index].replaceAll('nx/dist/bin/nx.js', 'nx/bin/nx.js');
  assert.throws(() => validateBuildInputs(manifest, lock, files), /locked Nx bin/);
});
test('Reject wildcard-only package COPY', () => { const files = dockerfiles.map(file => file.replaceAll('COPY package.json package-lock.json ./', 'COPY package*.json ./')); assert.throws(() => validateBuildInputs(manifest, lock, files), /COPY/); });
console.log(`[PASS] Build-input regression: ${passed} cases; no network or installed dependencies required.`);
