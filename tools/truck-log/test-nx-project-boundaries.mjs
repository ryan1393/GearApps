import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = (message) => { throw new Error(message); };
const norm = (value) => value.split(path.sep).join('/');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

function walk(directory, name) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.nx', '.git'].includes(entry.name)) {
      result.push(...walk(absolute, name));
    } else if (entry.isFile() && entry.name === name) {
      result.push(absolute);
    }
  }
  return result;
}

const projectFiles = [...walk(path.join(root, 'apps'), 'project.json'), ...walk(path.join(root, 'libs'), 'project.json')];
const projects = projectFiles.map((file) => {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const projectRoot = norm(path.relative(root, path.dirname(file)));
  const tags = new Set(json.tags ?? []);
  return { ...json, projectRoot, tags };
});

const names = new Map();
for (const project of projects) {
  if (!project.name) fail(`Nx project at ${project.projectRoot} has no name.`);
  if (names.has(project.name)) fail(`Duplicate Nx project name ${project.name}: ${names.get(project.name)} and ${project.projectRoot}`);
  names.set(project.name, project.projectRoot);
  if (!project.tags.has('scope:truck-log')) fail(`${project.name} is missing scope:truck-log.`);
  if (![...project.tags].some((tag) => tag.startsWith('type:'))) fail(`${project.name} is missing a type:* tag.`);
  if (![...project.tags].some((tag) => tag.startsWith('platform:'))) fail(`${project.name} is missing a platform:* tag.`);
}

const expectedApps = new Map([
  ['truck-log', 'apps/truck-log'],
  ['truck-log-server', 'apps/truck-log-server'],
  ['rxo-integration', 'apps/rxo-integration'],
  ['rxo-expedite', 'apps/rxo-expedite'],
]);
for (const [name, location] of expectedApps) {
  if (names.get(name) !== location) fail(`Expected ${name} at ${location}; found ${names.get(name) ?? 'missing'}.`);
}

for (const [name, location] of expectedApps) {
  const project = projects.find((item) => item.name === name);
  if (project.projectType !== 'application') fail(`${name} must remain an Nx application.`);
  if (project.sourceRoot !== `${location}/src`) fail(`${name} sourceRoot must be ${location}/src.`);
  if (!project.targets?.build) fail(`${name} must expose a build target.`);
}

const requiredLibs = [
  'truck-log-shared-contracts',
  'truck-log-web-data-access', 'truck-log-web-domain', 'truck-log-web-ui', 'truck-log-web-auth-admin', 'truck-log-web-auth-station', 'truck-log-web-styles',
  'truck-log-server-core', 'truck-log-server-data-access',
  'truck-log-server-auth-access', 'truck-log-server-auth-admin', 'truck-log-server-auth-print-agent',
  'truck-log-server-domain-rxo', 'truck-log-server-domain-driver-print',
  'truck-log-server-infrastructure-uploads', 'truck-log-server-infrastructure-sap-documents', 'truck-log-server-infrastructure-rxo-recovery',
];
for (const name of requiredLibs) if (!names.has(name)) fail(`Missing Nx library project ${name}.`);

for (const project of projects.filter((item) => item.projectRoot.startsWith('libs/truck-log/'))) {
  if (project.projectType !== 'library') fail(`${project.name} must remain an Nx library.`);
  const expectedSourceRoot = `${project.projectRoot}/src`;
  if (project.sourceRoot !== expectedSourceRoot) fail(`${project.name} sourceRoot must be ${expectedSourceRoot}.`);
  if (!project.tags.has('type:styles') && !fs.existsSync(path.join(root, project.projectRoot, 'src', 'index.ts'))) fail(`${project.name} must expose src/index.ts.`);
}
for (const project of projects.filter((item) => item.projectRoot.startsWith('libs/truck-log/web/feature/'))) {
  if (!project.tags.has('type:feature') || !project.tags.has('platform:web')) fail(`${project.name} has invalid web-feature tags.`);
}
for (const project of projects.filter((item) => item.projectRoot.startsWith('libs/truck-log/server/feature/'))) {
  if (!project.tags.has('type:feature') || !project.tags.has('platform:server')) fail(`${project.name} has invalid server-feature tags.`);
}

for (const retired of [
  'libs/truck-log/web/project.json',
  'libs/truck-log/server/project.json',
  'libs/truck-log/contracts/project.json',
  'libs/truck-log/ui/project.json',
]) {
  if (fs.existsSync(path.join(root, retired))) fail(`Retired umbrella Nx project returned: ${retired}`);
}

const tsconfig = readJson('tsconfig.base.json');
const aliases = tsconfig.compilerOptions?.paths ?? {};
const requiredAliases = {
  '@truck-log/shared/contracts': 'libs/truck-log/shared/contracts/src/index.ts',
  '@truck-log/web/data-access': 'libs/truck-log/web/data-access/src/index.ts',
  '@truck-log/web/domain': 'libs/truck-log/web/domain/src/index.ts',
  '@truck-log/web/ui': 'libs/truck-log/web/ui/src/index.ts',
  '@truck-log/web/auth/*': 'libs/truck-log/web/auth/*/src/index.ts',
  '@truck-log/web/feature/*': 'libs/truck-log/web/feature/*/src/index.ts',
  '@truck-log/server/core': 'libs/truck-log/server/core/src/index.ts',
  '@truck-log/server/data-access': 'libs/truck-log/server/data-access/src/index.ts',
  '@truck-log/server/auth/*': 'libs/truck-log/server/auth/*/src/index.ts',
  '@truck-log/server/domain/*': 'libs/truck-log/server/domain/*/src/index.ts',
  '@truck-log/server/infrastructure/*': 'libs/truck-log/server/infrastructure/*/src/index.ts',
  '@truck-log/server/feature/*': 'libs/truck-log/server/feature/*/src/index.ts',
};
for (const [alias, target] of Object.entries(requiredAliases)) {
  if (aliases[alias]?.[0] !== target) fail(`Canonical Nx alias ${alias} must point to ${target}.`);
}
for (const retired of ['@truck-log/contracts', '@truck-log/web', '@truck-log/server']) {
  if (aliases[retired]) fail(`Retired umbrella alias must not exist: ${retired}`);
}

function owningProject(file) {
  const rel = norm(path.relative(root, file));
  const matches = projects.filter((project) => rel === project.projectRoot || rel.startsWith(project.projectRoot + '/'));
  return matches.sort((a, b) => b.projectRoot.length - a.projectRoot.length)[0] ?? null;
}
function targetProjectForAlias(alias) {
  for (const [pattern, values] of Object.entries(aliases)) {
    if (!pattern.includes('*')) {
      if (alias !== pattern) continue;
      return owningProject(path.join(root, values[0]));
    }
    const [prefix, suffix] = pattern.split('*');
    if (!alias.startsWith(prefix) || !alias.endsWith(suffix)) continue;
    const middle = alias.slice(prefix.length, alias.length - suffix.length || undefined);
    return owningProject(path.join(root, values[0].replace('*', middle)));
  }
  return null;
}
function tagValue(project, prefix) {
  return [...project.tags].find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? '';
}
function canDepend(source, target) {
  if (source.name === target.name) return true;
  const sourcePlatform = tagValue(source, 'platform:');
  const targetPlatform = tagValue(target, 'platform:');
  const sourceType = tagValue(source, 'type:');
  const targetType = tagValue(target, 'type:');
  if (targetPlatform === 'shared') return true;
  if (sourcePlatform === 'web' && targetPlatform === 'server') return false;
  if (sourcePlatform === 'server' && targetPlatform === 'web') return false;
  if (sourceType === 'feature' && targetType === 'feature') return false;
  if (sourceType === 'data-access' && ['feature', 'core'].includes(targetType)) return false;
  if (sourceType === 'domain' && ['feature', 'core'].includes(targetType)) return false;
  if (sourceType === 'auth' && ['feature', 'core'].includes(targetType)) return false;
  if (sourceType === 'infrastructure' && ['feature', 'core'].includes(targetType)) return false;
  return true;
}

const tsFiles = walk(path.join(root, 'libs', 'truck-log'), '___none___');
// walk() above is file-name-specific. Collect TypeScript explicitly.
function allFiles(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(absolute));
    else if (entry.isFile()) out.push(absolute);
  }
  return out;
}
const sourceFiles = allFiles(path.join(root, 'libs', 'truck-log')).filter((file) => file.endsWith('.ts'));
const importPattern = /(?:from\s+|import\s*\()['"]([^'"]+)['"]/g;
for (const file of sourceFiles) {
  const source = owningProject(file);
  if (!source) fail(`TypeScript source is outside an Nx project: ${norm(path.relative(root, file))}`);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!(resolved === path.join(root, source.projectRoot) || resolved.startsWith(path.join(root, source.projectRoot) + path.sep))) {
        fail(`${norm(path.relative(root, file))} crosses an Nx project boundary with relative import ${specifier}.`);
      }
      continue;
    }
    if (!specifier.startsWith('@truck-log/')) continue;
    if (specifier.includes('/src/') || specifier.includes('/lib/')) fail(`Deep Truck Log import is forbidden: ${specifier}`);
    const target = targetProjectForAlias(specifier);
    if (!target) fail(`${norm(path.relative(root, file))} uses unmapped Truck Log alias ${specifier}.`);
    if (!canDepend(source, target)) fail(`${source.name} (${tagValue(source, 'type:')}) may not depend on ${target.name} (${tagValue(target, 'type:')}).`);
  }
}

console.log(`[PASS] Nx project boundaries: ${projects.length} projects, public APIs only, no cross-feature library dependencies.`);
