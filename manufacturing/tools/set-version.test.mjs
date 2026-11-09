import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setReleaseVersion } from './set-version.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-version-'));
  const put = (file, text) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  put(
    'package.json',
    JSON.stringify({ version: '1.2.3', dependencies: { sample: '1.2.3' } }),
  );
  put(
    'package-lock.json',
    JSON.stringify({
      version: '1.2.3',
      packages: {
        '': { version: '1.2.3' },
        'node_modules/sample': { version: '1.2.3' },
      },
    }),
  );
  put(
    'vendor/dana-ui/VENDOR_MANIFEST.json',
    JSON.stringify({ danaAppsVersion: '1.2.3', packageVersion: '0.3.0' }),
  );
  put(
    'libs/shared/domain/src/lib/app-version.ts',
    "export const GEAR_APPS_VERSION = '1.2.3';\n",
  );
  put(
    'apps/lapper-api/package.json',
    JSON.stringify({
      name: '@gearapps/lapper-api',
      private: true,
      version: '1.2.3',
    }),
  );
  put(
    'apps/lapper-read/Directory.Build.props',
    '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>\n',
  );
  put('README.md', '# GearApps 1.2.3\n');
  put(
    'manufacturing/compose.yml',
    ['gear-app-server', 'blade-tracking', 'cutter-builder', 'greenshed']
      .map((name) => `image: dana-apps-${name}:1.2.3`)
      .join('\n') + '\n',
  );
  put('manufacturing/README.md', '# Gear Apps 1.2.3\n');
  return {
    root,
    put,
    text: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    read: (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')),
  };
}
test('version ownership updates lock and vendor without changing dependencies', () => {
  const f = fixture();
  try {
    setReleaseVersion(f.root, '1.2.4');
    assert.equal(f.read('package.json').version, '1.2.4');
    assert.equal(f.read('apps/lapper-api/package.json').version, '1.2.4');
    assert.match(
      f.text('apps/lapper-read/Directory.Build.props'),
      /<Version>1\.2\.4<\/Version>/,
    );
    assert.equal(f.read('package.json').dependencies.sample, '1.2.3');
    assert.equal(f.read('package-lock.json').version, '1.2.4');
    assert.equal(f.read('package-lock.json').packages[''].version, '1.2.4');
    assert.equal(
      f.read('package-lock.json').packages['node_modules/sample'].version,
      '1.2.3',
    );
    assert.equal(
      f.read('vendor/dana-ui/VENDOR_MANIFEST.json').danaAppsVersion,
      '1.2.4',
    );
    assert.equal(
      f.read('vendor/dana-ui/VENDOR_MANIFEST.json').packageVersion,
      '0.3.0',
    );
    assert.match(
      f.text('libs/shared/domain/src/lib/app-version.ts'),
      /GEAR_APPS_VERSION = '1\.2\.4'/,
    );
    assert.equal(f.text('README.md'), '# GearApps 1.2.4\n');
    assert.equal(f.text('manufacturing/README.md'), '# Gear Apps 1.2.4\n');
    assert.deepEqual(
      [
        ...f
          .text('manufacturing/compose.yml')
          .matchAll(/dana-apps-([a-z-]+):(\S+)/g),
      ].map(([, name, version]) => [name, version]),
      ['gear-app-server', 'blade-tracking', 'cutter-builder', 'greenshed'].map(
        (name) => [name, '1.2.4'],
      ),
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('missing marker cannot leave a partially updated release', () => {
  const f = fixture();
  try {
    f.put('manufacturing/README.md', '# Missing release marker');
    assert.throws(() => setReleaseVersion(f.root, '1.2.4'), /version marker/);
    assert.equal(f.read('package.json').version, '1.2.3');
    assert.equal(f.read('package-lock.json').version, '1.2.3');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('invalid release version is rejected before accessing files', () =>
  assert.throws(() => setReleaseVersion('/nonexistent', 'invalid'), /usage/));

test('missing collector version marker cannot change the release partially', () => {
  const f = fixture();
  try {
    f.put('apps/lapper-read/Directory.Build.props', '<Project />\n');
    assert.throws(() => setReleaseVersion(f.root, '1.2.4'), /version marker/);
    assert.equal(f.read('package.json').version, '1.2.3');
    assert.equal(f.read('apps/lapper-api/package.json').version, '1.2.3');
    assert.match(
      f.text('libs/shared/domain/src/lib/app-version.ts'),
      /GEAR_APPS_VERSION = '1\.2\.3'/,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
