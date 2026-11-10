// The manufacturing applications and Lapper share one toolchain and install.
import fs from 'node:fs';
import path from 'node:path';
import { contractPath, workspaceRoot, readContract } from './lib/contract-paths.mjs';
const root = workspaceRoot;
const read = readContract;
const json = file => JSON.parse(read(file));
const must = (ok, message) => { if (!ok) throw new Error(message); };
const canonicalRecord = (value) => Object.fromEntries(Object.entries(value ?? {}).sort(([a],[b]) => a.localeCompare(b)));
const pkg = json('package.json');
const lock = json('package-lock.json');
must(pkg.name === '@gearapps/source', 'One root package must own GearApps and Lapper');
must(pkg.packageManager === 'npm@11.9.0', 'The root npm toolchain must be 11.9.0');
must(pkg.engines?.node === '24.22.1', 'The root Node toolchain must be 24.22.1');
must(lock.name === pkg.name && lock.packages?.['']?.name === pkg.name, 'Lockfile root identity must match the unified package');
for (const kind of ['dependencies','devDependencies']) must(JSON.stringify(canonicalRecord(pkg[kind])) === JSON.stringify(canonicalRecord(lock.packages?.['']?.[kind])), `${kind} differ between the single package and lock`);
for (const file of ['package.json','package-lock.json','nx.json','jest.preset.js','.eslintrc.json']) must(!fs.existsSync(path.join(root,'manufacturing',file)), `Detached manufacturing toolchain file remains: ${file}`);
must(!fs.existsSync(path.join(root,'manufacturing','node_modules')), 'Manufacturing must use root node_modules');
must(!fs.existsSync(path.join(root,'vendor')), 'Dana UI must have one source copy (libs/shared/dana-ui); do not restore a vendored output');
const nx = json('nx.json');
must(!nx.nxCloudAccessToken, 'Do not embed an Nx Cloud access token');
const ignored = fs.existsSync(contractPath(process.cwd(), path.join(workspaceRoot,'.nxignore'))) ? fs.readFileSync(contractPath(process.cwd(), path.join(workspaceRoot,'.nxignore')),'utf8') : '';
must(!/^\s*manufacturing\/(?:\*\*)?\s*$/m.test(ignored), 'Manufacturing projects must participate in the root graph');
const aliases = json('tsconfig.base.json').compilerOptions?.paths ?? {};
must(Object.keys(aliases).some(name => name.startsWith('@gearapps/manufacturing/')), 'Manufacturing source aliases must be rooted in the unified tsconfig');
must(Object.keys(aliases).every(name => !name.startsWith('@libs/')), 'Retired @libs aliases must not return');
const boundaries = read('eslint.config.mjs');
must(boundaries.includes('@nx/enforce-module-boundaries'), 'Root lint must enforce Nx project boundaries');
const danaUi = json('libs/shared/dana-ui/package.json');
must(danaUi.name === '@dana/ui', 'Dana UI package identity is invalid');
must(pkg.devDependencies?.['@dana/ui'] === undefined && pkg.dependencies?.['@dana/ui'] === undefined, 'All apps compile the one libs/shared/dana-ui source; do not install a Dana UI package');
must(JSON.stringify(aliases['@dana/ui']) === JSON.stringify(['./libs/shared/dana-ui/src/index.ts']), '@dana/ui must resolve to the libs/shared/dana-ui source');
for (const name of ['blade-tracking','cutter-builder','greenshed','server']) {
  const project = json(`apps/${name}/project.json`);
  must(project.sourceRoot === `apps/${name}/src`, `${name} must build from the unified root`);
  must(project.targets?.build, `${name} lost its build target`);
  const dockerfile = read(`apps/${name}/Dockerfile`);
  must(dockerfile.includes('COPY package.json package-lock.json'), `${name} image must install the root lockfile`);
  must(!/manufacturing\/package(?:-lock)?\.json/.test(dockerfile), `${name} image still installs an independent manufacturing graph`);
}
const server = json('apps/server/project.json');
must(server.name === 'gear-app-server', 'Preserve the manufacturing API project identity');
must(server.targets?.['build-fresh-db-bootstrap'], 'Keep the guarded fresh database bootstrap build');
const compose = read('compose.yml');
for (const marker of ['dana-postgres:','gear-db-bootstrap:','gear-base-data-bootstrap:','condition: service_completed_successfully','health/ready','--bootstrap-only']) must(compose.includes(marker), `Manufacturing deployment safety marker missing: ${marker}`);
must(!/^\s*container_name\s*:/m.test(compose), 'Do not introduce global container-name collisions');
must(!compose.includes('external:'), 'A fresh host must create its own namespaced Gear database volume');
for (const nav of ['apps/blade-tracking/src/app/layout/app-nav/app-nav.component.ts','apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.ts','apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.ts']) {
  must(read(nav).includes('@gearapps/manufacturing/shared/dana-app-config'), `${nav} lost shared navigation ownership`);
}
const login = read('libs/manufacturing/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.ts');
must(!login.includes('GearApps-E2E-Only-2026!') && !login.includes('GearApps-Admin-Only-2026!'), 'Do not embed fixture passwords in frontend bundles');
console.log('[PASS] Unified GearApps contract: one install/toolchain, all applications in the root graph, shared Dana UI, and guarded deployment.');

must(!fs.existsSync(path.join(root,'manufacturing')), 'Manufacturing sources live in libs/manufacturing, tools/manufacturing, docs/manufacturing and commands; do not restore a manufacturing/ directory');
