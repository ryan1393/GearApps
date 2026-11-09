import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const angularRoot = path.resolve(process.env.DANA_TEST_ANGULAR_ROOT || '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-consumer-'));
try {
  const config = {
    compilerOptions: {
      target: 'ES2022', module: 'ES2022', moduleResolution: 'node',
      experimentalDecorators: true, strict: true, skipLibCheck: false,
      baseUrl: angularRoot, outDir: path.join(temp, 'output'),
      paths: { '@dana/ui': [path.resolve('../../../dist/libs/shared/dana-ui/index.d.ts')], '@angular/*': ['node_modules/@angular/*'] },
    },
    angularCompilerOptions: { strictTemplates: true },
    files: [path.resolve('tools/browser/angular-consumer.ts')],
  };
  const configPath = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath,
    [path.join(angularRoot, 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'), '-p', configPath],
    { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''));
  const version = JSON.parse(fs.readFileSync(path.join(angularRoot, 'node_modules/@angular/core/package.json'))).version;
  console.log(`[PASS] Strict AOT consuming templates compile against Angular ${version}.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
