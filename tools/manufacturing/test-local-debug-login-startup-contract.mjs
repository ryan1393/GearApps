import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const loginPath = contractPath(root, 'libs/manufacturing/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.ts');
const startPath = contractPath(root, 'tools/manufacturing/start-gear-apps.ps1');
const login = fs.readFileSync(contractPath(process.cwd(), loginPath), 'utf8');
const start = fs.readFileSync(contractPath(process.cwd(), startPath), 'utf8');

for (const marker of [
  "['localhost', '127.0.0.1'].includes(window.location.hostname)",
  "readonly localTestEmail = 'test@gearapps.local';",
  "readonly localAdminEmail = 'admin@gearapps.local';",
  'useLocalTestLogin(): void {',
  'useLocalAdminLogin(): void {',
  'email: this.localTestEmail,',
  'email: this.localAdminEmail,',
  'if (!this.showLocalTestLogin) return;',
]) if (!login.includes(marker)) throw new Error(`Missing local debug login marker: ${marker}`);

for (const forbidden of [
  'GearApps-E2E-Only-2026!',
  'GearApps-Admin-Only-2026!',
  'localTestPassword',
  'localAdminPassword',
  'password: this.localTestPassword',
  'password: this.localAdminPassword',
]) if (login.includes(forbidden)) throw new Error(`Frontend local debug login must not contain ${forbidden}`);

for (const methodName of ['useLocalTestLogin','useLocalAdminLogin']) {
  const startIndex = login.indexOf(`${methodName}(): void {`);
  const endIndex = login.indexOf('\n  }', startIndex);
  const block = startIndex >= 0 && endIndex >= 0 ? login.slice(startIndex, endIndex + 4) : '';
  if (!block || block.includes('password:') || block.includes('this.login()')) {
    throw new Error(`${methodName} must fill email only and must not auto-submit.`);
  }
}

for (const marker of [
  '& npx --no-install nx reset',
  'Nx reset could not clean .nx workspace data',
  'Continuing startup with the Nx daemon disabled',
  '$resetSucceeded = $false',
]) if (!start.includes(marker)) throw new Error(`Missing startup lock-hardening marker: ${marker}`);

if (start.includes('throw "Nx reset failed with exit code $LASTEXITCODE."')) throw new Error('Startup still hard-fails when nx reset returns non-zero.');
console.log('[PASS] V14 local debug login + Nx reset lock hardening contract passed.');
