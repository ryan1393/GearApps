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
  // Manufacturing code lives in libs/manufacturing, tools/manufacturing, docs/manufacturing and commands/.
  'manufacturing',
  'libs/shared/dana-ui/package-lock.json',
  'vendor/dana-ui',
]) {
  assert.equal(
    existsSync(resolve(root, path)),
    false,
    `Remove independent workspace artifact: ${path}`,
  );
}
const ui = json('libs/shared/dana-ui/package.json');
assert.equal(ui.version, '0.3.3');
// Dana UI has one copy: the libs/shared/dana-ui source, resolved through the @dana/ui path alias.
assert.equal(pkg.dependencies?.['@dana/ui'] ?? pkg.devDependencies?.['@dana/ui'], undefined, 'Do not install a separate @dana/ui package');
assert.deepEqual(json('tsconfig.base.json').compilerOptions.paths['@dana/ui'], ['./libs/shared/dana-ui/src/index.ts']);
assert.equal(ui.devDependencies, undefined, 'Dana UI uses root build dependencies');
console.log(`GearApps ${pkg.version}: one lockfile, one framework stack, Dana UI ${ui.version}.`);
