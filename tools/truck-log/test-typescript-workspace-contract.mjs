import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const normalize = (value) => value.split(path.sep).join('/');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
};

for (const relative of ['tsconfig.json', 'tsconfig.base.json', 'apps/truck-log/tsconfig.app.json', 'apps/truck-log-server/tsconfig.app.json']) {
  must(fs.existsSync(path.join(root, relative)), `TypeScript config exists: ${relative}`);
}

const base = readJson('tsconfig.base.json');
const aliases = base.compilerOptions?.paths ?? {};
const expectedAliases = {
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
for (const [alias, target] of Object.entries(expectedAliases)) {
  must(aliases[alias]?.[0] === target, `Canonical TypeScript path alias is configured: ${alias}`);
}
for (const retired of ['@truck-log/contracts', '@truck-log/web', '@truck-log/server']) {
  must(!aliases[retired], `Retired umbrella alias is absent: ${retired}`);
}

const rootConfig = readJson('tsconfig.json');
must(rootConfig.extends === './tsconfig.base.json', 'Root tsconfig extends tsconfig.base.json');
must(rootConfig.compilerOptions?.noEmit === true, 'Root editor tsconfig is no-emit');
must(Array.isArray(rootConfig.files) && rootConfig.files.length === 0, 'Root editor tsconfig does not create a mixed browser/server compilation');

function parseConfig(relative) {
  const absolute = path.join(root, relative);
  const loaded = ts.readConfigFile(absolute, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(absolute), undefined, absolute);
  const errors = parsed.errors.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
  return parsed;
}

function walk(directory, fileName) {
  if (!fs.existsSync(directory)) return [];
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(absolute, fileName));
    else if (entry.name === fileName) out.push(absolute);
  }
  return out;
}

const libProjects = walk(path.join(root, 'libs/truck-log'), 'project.json')
  .map((file) => ({ file, config: JSON.parse(fs.readFileSync(file, 'utf8')), directory: path.dirname(file) }))
  .filter(({ config }) => config.tags?.some((tag) => ['platform:web', 'platform:server', 'platform:shared'].includes(tag)) && !config.tags?.includes('type:styles'));

for (const project of libProjects) {
  const relativeConfig = normalize(path.relative(root, path.join(project.directory, 'tsconfig.json')));
  must(fs.existsSync(path.join(project.directory, 'tsconfig.json')), `${project.config.name} owns a tsconfig.json`);
  const parsed = parseConfig(relativeConfig);
  const configured = new Set(parsed.fileNames.map((file) => normalize(path.resolve(file))));
  const sourceRoot = path.join(project.directory, 'src');
  const sources = [];
  const stack = [sourceRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.name.endsWith('.ts')) sources.push(absolute);
    }
  }
  for (const source of sources) {
    must(configured.has(normalize(path.resolve(source))), `${project.config.name} owns ${normalize(path.relative(root, source))}`);
  }
}

const resolutionCases = [
  ['@truck-log/shared/contracts', 'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts', 'apps/truck-log/tsconfig.app.json', 'libs/truck-log/shared/contracts/src/index.ts'],
  ['@truck-log/web/data-access', 'apps/truck-log/src/app/app.component.ts', 'apps/truck-log/tsconfig.app.json', 'libs/truck-log/web/data-access/src/index.ts'],
  ['@truck-log/web/feature/check-in', 'apps/truck-log/src/app/app.routes.ts', 'apps/truck-log/tsconfig.app.json', 'libs/truck-log/web/feature/check-in/src/index.ts'],
  ['@truck-log/server/core', 'apps/truck-log-server/src/app/app.module.ts', 'apps/truck-log-server/tsconfig.app.json', 'libs/truck-log/server/core/src/index.ts'],
  ['@truck-log/server/domain/driver-print', 'libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts', 'apps/truck-log-server/tsconfig.app.json', 'libs/truck-log/server/domain/driver-print/src/index.ts'],
];
for (const [alias, containing, config, expected] of resolutionCases) {
  const parsed = parseConfig(config);
  const resolved = ts.resolveModuleName(alias, path.join(root, containing), parsed.options, ts.sys).resolvedModule;
  must(Boolean(resolved), `TypeScript resolves ${alias} from ${containing}`);
  must(normalize(path.resolve(resolved.resolvedFileName)) === normalize(path.resolve(root, expected)), `${alias} resolves through its public Nx entry point`);
}

console.log(`[PASS] TypeScript ownership and public aliases passed across ${libProjects.length} Nx TypeScript libraries.`);
