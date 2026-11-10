import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildGearMergeManifest } from './generate-dana-apps-gear-merge-manifest.mjs';

test('release manifest is identical across Git checkout line endings and detects source changes', (t) => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'gear-manifest-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(temporaryRoot + path.sep)) throw new Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const files = {
    'package.json': JSON.stringify({ version: '70.3.0', scripts: { 'test:unit': 'node tests.mjs' } }, null, 2) + '\n',
    'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
    'nx.json': '{\n  "defaultBase": "main"\n}\n',
    'tsconfig.base.json': '{\n  "compilerOptions": {}\n}\n',
    'compose.yml': 'name: suite\nservices: {}\n',
    'apps/collector/project.json': JSON.stringify({ name: 'lapper-read', targets: { build: {} } }, null, 2) + '\n',
  };
  const write = (lineEnding) => {
    for (const [name, text] of Object.entries(files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text.replace(/\n/g, lineEnding));
    }
  };
  write('\n');
  const linux = buildGearMergeManifest(root);
  write('\r\n');
  assert.deepEqual(buildGearMergeManifest(root), linux);
  fs.writeFileSync(path.join(root, 'nx.json'), '{"defaultBase":"release"}\n');
  assert.notEqual(buildGearMergeManifest(root).rootHashes['nx.json'], linux.rootHashes['nx.json']);
});
