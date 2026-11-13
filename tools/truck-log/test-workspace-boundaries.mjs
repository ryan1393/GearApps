import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const must = (condition, message) => { if (!condition) throw new Error(message); };
const exists = (relative) => fs.existsSync(path.join(root, relative));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));

for (const relative of [
  'apps/truck-log/project.json',
  'apps/truck-log-server/project.json',
  'apps/rxo-integration/project.json',
  'apps/rxo-expedite/project.json',
  'libs/truck-log/shared/contracts/project.json',
  'libs/truck-log/web/data-access/project.json',
  'libs/truck-log/web/domain/project.json',
  'libs/truck-log/web/ui/project.json',
  'libs/truck-log/server/core/project.json',
  'libs/truck-log/server/data-access/project.json',
]) must(exists(relative), `Missing canonical Nx boundary: ${relative}`);

for (const retired of [
  'libs/truck-log/web/project.json',
  'libs/truck-log/server/project.json',
  'libs/truck-log/contracts/project.json',
  'libs/truck-log/ui/project.json',
]) must(!exists(retired), `Retired umbrella project still exists: ${retired}`);

const appDir = path.join(root, 'apps/truck-log/src/app');
const appFiles = fs.readdirSync(appDir, { withFileTypes: true }).map((entry) => entry.name).sort();
for (const expected of ['app.component.ts', 'app.config.ts', 'app.routes.ts']) {
  must(appFiles.includes(expected), `Angular composition root missing ${expected}`);
}
for (const forbidden of ['api.service.ts', 'models.ts', 'check-in-form.ts', 'dock-age.ts', 'visit-display.ts', 'toast.service.ts', 'pages']) {
  must(!appFiles.includes(forbidden), `Angular app contains implementation that belongs in an Nx library: ${forbidden}`);
}

const shell = read('apps/truck-log/src/app/app.component.ts');
const routes = read('apps/truck-log/src/app/app.routes.ts');
must(shell.includes("from '@truck-log/web/data-access'") && shell.includes("from '@truck-log/web/ui'"),
  'Angular shell must consume focused public Nx libraries');
for (const alias of [
  '@truck-log/web/feature/dashboard', '@truck-log/web/feature/check-in', '@truck-log/web/feature/dock-board',
  '@truck-log/web/feature/active-trucks', '@truck-log/web/feature/history', '@truck-log/web/feature/admin',
  '@truck-log/web/feature/rxo-control-center', '@truck-log/web/feature/rxo-expedite-control-center', '@truck-log/web/feature/tv-display',
]) must(routes.includes(alias), `Routes must consume ${alias}`);

const paths = json('tsconfig.base.json').compilerOptions?.paths ?? {};
for (const alias of ['@truck-log/contracts', '@truck-log/web', '@truck-log/server']) {
  must(!paths[alias], `Retired umbrella alias must not be configured: ${alias}`);
}
for (const alias of [
  '@truck-log/shared/contracts', '@truck-log/web/data-access', '@truck-log/web/domain', '@truck-log/web/ui',
  '@truck-log/web/feature/*', '@truck-log/server/core', '@truck-log/server/data-access', '@truck-log/server/feature/*',
]) must(Boolean(paths[alias]), `Focused Nx alias must be configured: ${alias}`);

console.log('[PASS] Truck Log workspace uses thin applications and focused Nx library boundaries.');
