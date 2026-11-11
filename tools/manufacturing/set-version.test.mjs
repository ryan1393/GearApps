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
    'libs/shared/domain/src/lib/app-version.ts',
    "export const MESHFORGE_VERSION = '1.2.3';\n",
  );
  put('apps/lapper-read-py/lapper_read/__init__.py', '__version__ = "1.2.3"\n');
  put('README.md', '# MeshForge 1.2.3\n');
  put(
    'compose.yml',
    ['meshforge-server', 'lapper-client', 'blade-tracking', 'cutter-builder', 'greenshed', 'lapper-read']
      .map((name) => `image: dana-apps-${name}:1.2.3`)
      .join('\n') + '\n',
  );
  put('docs/manufacturing/README.md', '# MeshForge 1.2.3\n');
  return {
    root,
    put,
    text: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    read: (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')),
  };
}
test('version ownership updates package and lock versions without changing dependencies', () => {
  const f = fixture();
  try {
    setReleaseVersion(f.root, '1.2.4');
    assert.equal(f.read('package.json').version, '1.2.4');
    assert.match(
      f.text('apps/lapper-read-py/lapper_read/__init__.py'),
      /__version__ = "1\.2\.4"/,
    );
    assert.equal(f.read('package.json').dependencies.sample, '1.2.3');
    assert.equal(f.read('package-lock.json').version, '1.2.4');
    assert.equal(f.read('package-lock.json').packages[''].version, '1.2.4');
    assert.equal(
      f.read('package-lock.json').packages['node_modules/sample'].version,
      '1.2.3',
    );
    assert.match(
      f.text('libs/shared/domain/src/lib/app-version.ts'),
      /MESHFORGE_VERSION = '1\.2\.4'/,
    );
    assert.equal(f.text('README.md'), '# MeshForge 1.2.4\n');
    assert.equal(f.text('docs/manufacturing/README.md'), '# MeshForge 1.2.4\n');
    assert.deepEqual(
      [
        ...f
          .text('compose.yml')
          .matchAll(/dana-apps-([a-z-]+):(\S+)/g),
      ].map(([, name, version]) => [name, version]),
      ['meshforge-server', 'lapper-client', 'blade-tracking', 'cutter-builder', 'greenshed', 'lapper-read'].map(
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
    f.put('docs/manufacturing/README.md', '# Missing release marker');
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
    f.put('apps/lapper-read-py/lapper_read/__init__.py', '\n');
    assert.throws(() => setReleaseVersion(f.root, '1.2.4'), /version marker/);
    assert.equal(f.read('package.json').version, '1.2.3');
    assert.match(
      f.text('libs/shared/domain/src/lib/app-version.ts'),
      /MESHFORGE_VERSION = '1\.2\.3'/,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
