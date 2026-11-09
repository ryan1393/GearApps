import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const all = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };

const critical = [
  'nx',
  '@nx/angular',
  '@nx/js',
  '@angular/core',
  '@angular/compiler-cli',
  '@angular-devkit/build-angular',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/typeorm',
  '@types/express',
  'typeorm',
  'pg',
  'typescript',
  'rxjs',
  'zone.js',
];

let failed = false;
for (const name of critical) {
  const manifest = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (!fs.existsSync(manifest)) {
    console.error(`[FAIL] Missing installed dependency: ${name}`);
    failed = true;
    continue;
  }
  const installed = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  console.log(`[OK] ${name} ${installed} (requested ${all[name] ?? 'transitive'})`);
}

const nxCmd = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'nx.cmd' : 'nx');
if (!fs.existsSync(nxCmd)) {
  console.error(`[FAIL] Nx executable missing: ${nxCmd}`);
  failed = true;
} else {
  console.log('[OK] Nx executable installed.');
}

if (failed) process.exit(1);
console.log('[PASS] Required Truck Log dependencies are installed.');
