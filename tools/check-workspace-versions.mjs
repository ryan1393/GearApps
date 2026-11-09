import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const pkg = json('package.json');
const lock = json('package-lock.json');
assert.equal(pkg.packageManager, 'npm@11.9.0');
assert.equal(pkg.overrides.typescript, pkg.devDependencies.typescript);
assert.equal(readFileSync(resolve(root, '.nvmrc'), 'utf8').trim(), pkg.engines.node);
assert.equal(lock.version, pkg.version);
assert.equal(json('apps/lapper-api/package.json').version, pkg.version);
assert.equal(
  readFileSync(resolve(root, 'apps/lapper-read/Directory.Build.props'), 'utf8').match(
    /<Version>([^<]+)<\/Version>/,
  )?.[1],
  pkg.version,
);
for (const section of ['dependencies', 'devDependencies']) {
  assert.deepEqual(
    lock.packages[''][section],
    pkg[section],
    `Lockfile ${section} must match the root manifest`,
  );
  for (const [name, version] of Object.entries(pkg[section])) {
    if (version.startsWith('file:')) continue;
    assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Pin ${name} to an exact version`);
    assert.equal(
      lock.packages[`node_modules/${name}`]?.version,
      version,
      `${name} installed version`,
    );
  }
}
for (const [path, metadata] of Object.entries(lock.packages)) {
  for (const name of [
    '@angular/core',
    '@angular/common',
    '@angular/compiler',
    '@angular/forms',
    '@angular/router',
    '@nestjs/common',
    '@nestjs/core',
    'nx',
    'typescript',
    'typeorm',
    'jest',
  ]) {
    if (path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)) {
      const expected = pkg.dependencies[name] ?? pkg.devDependencies[name];
      assert.equal(metadata.version, expected, `Conflicting active version: ${path}`);
    }
  }
}
for (const path of [
  'manufacturing/package.json',
  'manufacturing/package-lock.json',
  'manufacturing/nx.json',
  'manufacturing/node_modules',
  'manufacturing/vendor/dana-ui/package',
  'libs/shared/dana-ui/package-lock.json',
]) {
  assert.equal(
    existsSync(resolve(root, path)),
    false,
    `Remove independent workspace artifact: ${path}`,
  );
}
const ui = json('libs/shared/dana-ui/package.json');
assert.equal(ui.version, '0.3.3');
assert.equal(pkg.devDependencies['@dana/ui'], 'file:vendor/dana-ui/package');
assert.equal(json('vendor/dana-ui/package/package.json').version, ui.version);
assert.equal(ui.devDependencies, undefined, 'Dana UI uses root build dependencies');
console.log(`GearApps ${pkg.version}: one lockfile, one framework stack, Dana UI ${ui.version}.`);
