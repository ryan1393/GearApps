import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(contractPath(process.cwd(), 'package.json'),'utf8').replace(/^\uFEFF/,''));
const lock=JSON.parse(fs.readFileSync(contractPath(process.cwd(), 'package-lock.json'),'utf8').replace(/^\uFEFF/,''));
const rootLock=lock.packages?.[''] ?? {};

const removed=[
  '@commitlint/config-conventional',
  '@commitlint/config-nx-scopes',
  '@commitlint/cz-commitlint',
  '@openapitools/openapi-generator-cli',
  '@sentry/nestjs',
  'commitizen',
  'commitlint',
  'husky',
  'lint-staged',
  'vuepress',
];

const declared={...(pkg.dependencies??{}),...(pkg.devDependencies??{})};
for(const name of removed){
  if(name in declared) throw new Error(`Trimmed package was reintroduced: ${name}`);
}

const canonical = value => JSON.stringify(Object.entries(value ?? {}).sort(([a],[b]) => a.localeCompare(b)));
if(canonical(pkg.dependencies)!==canonical(rootLock.dependencies)){
  throw new Error('package.json dependencies do not match package-lock root dependencies.');
}
if(canonical(pkg.devDependencies)!==canonical(rootLock.devDependencies)){
  throw new Error('package.json devDependencies do not match package-lock root devDependencies.');
}

for(const obsolete of ['prepare','docs:dev','docs:build']){
  if(pkg.scripts?.[obsolete]) throw new Error(`Obsolete script still exists after dependency trim: ${obsolete}`);
}
if(pkg.config?.commitizen) throw new Error('Obsolete commitizen configuration remains in package.json.');

console.log(`[PASS] Dependency trim contract passed: ${removed.length} unnecessary root packages remain removed.`);
