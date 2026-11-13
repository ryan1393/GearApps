import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skip = new Set(['node_modules', 'dist', '.nx', '.git', '.setup-backups', '_patch_backups']);
const projects = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name === 'project.json') {
      const json = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      projects.push({
        name: json.name,
        root: path.relative(root, path.dirname(absolute)).split(path.sep).join('/'),
        projectType: json.projectType,
        tags: json.tags ?? [],
      });
    }
  }
}
walk(path.join(root, 'apps'));
walk(path.join(root, 'libs'));

const names = new Map();
for (const project of projects) {
  if (!project.name) throw new Error(`Nx project under ${project.root} has no name.`);
  if (names.has(project.name)) throw new Error(`Duplicate Nx project ${project.name}: ${names.get(project.name)} and ${project.root}`);
  names.set(project.name, project.root);
  if (!project.tags.includes('scope:truck-log')) throw new Error(`${project.name} is missing scope:truck-log.`);
}

const apps = {
  'truck-log': 'apps/truck-log',
  'truck-log-server': 'apps/truck-log-server',
  'rxo-integration': 'apps/rxo-integration',
  'rxo-expedite': 'apps/rxo-expedite',
};
for (const [name, expectedRoot] of Object.entries(apps)) {
  if (names.get(name) !== expectedRoot) throw new Error(`Nx application ${name} must live at ${expectedRoot}.`);
}

const appProjects = projects.filter((project) => project.root.startsWith('apps/'));
if (appProjects.length !== 4) throw new Error(`Expected 4 Truck Log Nx applications; found ${appProjects.length}.`);
for (const project of appProjects) {
  if (project.projectType !== 'application') throw new Error(`${project.name} must be an Nx application.`);
  const projectJson = JSON.parse(fs.readFileSync(path.join(root, project.root, 'project.json'), 'utf8'));
  const expectedSourceRoot = `${project.root}/src`;
  if (projectJson.sourceRoot !== expectedSourceRoot) throw new Error(`${project.name} sourceRoot must be ${expectedSourceRoot}.`);
  if (!projectJson.targets?.build) throw new Error(`${project.name} must expose an Nx build target.`);
}

const workerShapes = {
  'rxo-integration': {
    entries: ['playwright-preflight.mjs', 'rxo-filter-test.mjs', 'rxo-fort-wayne-export.mjs', 'rxo-scheduler.mjs', 'test-new-host-filter-readiness.mjs'],
    internals: ['rxo-auth.mjs', 'rxo-export-data.mjs', 'rxo-export-runtime.mjs', 'rxo-filter-common.mjs', 'rxo-filter-panel.mjs', 'rxo-filter-readiness.mjs', 'rxo-filter-ui.mjs', 'rxo-overlay-ui.mjs'],
  },
  'rxo-expedite': {
    entries: ['cli.mjs', 'scheduler.mjs'],
    internals: ['acquisition.mjs', 'credentials.mjs', 'rxo-auth.mjs', 'workbook.mjs'],
  },
};
for (const [name, shape] of Object.entries(workerShapes)) {
  const appRoot = path.join(root, apps[name]);
  const sourceRoot = path.join(appRoot, 'src');
  for (const entry of shape.entries) {
    if (!fs.existsSync(path.join(sourceRoot, entry))) throw new Error(`${name} entry point must live at src/${entry}.`);
  }
  for (const internal of shape.internals) {
    if (!fs.existsSync(path.join(sourceRoot, 'lib', internal))) throw new Error(`${name} internal module must live at src/lib/${internal}.`);
    if (fs.existsSync(path.join(sourceRoot, internal))) throw new Error(`${name} internal module leaked back into src/: ${internal}.`);
  }
  const appRootMjs = fs.readdirSync(appRoot).filter((name) => name.endsWith('.mjs'));
  if (appRootMjs.length) throw new Error(`${name} executable source must live under src/, not the app root: ${appRootMjs.join(', ')}`);
}

const libraryProjects = projects.filter((project) => project.root.startsWith('libs/truck-log/'));
// Counted separately so web and server library additions are reviewed (and merge) independently.
const webLibraryProjects = libraryProjects.filter((project) => project.root.startsWith('libs/truck-log/web/'));
const otherLibraryProjects = libraryProjects.filter((project) => !project.root.startsWith('libs/truck-log/web/'));
if (webLibraryProjects.length !== 15) throw new Error(`Expected 15 Truck Log web Nx libraries; found ${webLibraryProjects.length}.`);
if (otherLibraryProjects.length !== 24) throw new Error(`Expected 24 Truck Log shared/server Nx libraries; found ${otherLibraryProjects.length}.`);
for (const required of ['libs/truck-log/server/auth/station', 'libs/truck-log/web/auth/station']) {
  if (!libraryProjects.some((project) => project.root === required)) throw new Error(`Missing Nx library ${required}.`);
}
for (const project of libraryProjects) {
  if (project.projectType !== 'library') throw new Error(`${project.name} must be an Nx library.`);
  const projectJson = JSON.parse(fs.readFileSync(path.join(root, project.root, 'project.json'), 'utf8'));
  const expectedSourceRoot = `${project.root}/src`;
  if (projectJson.sourceRoot !== expectedSourceRoot) throw new Error(`${project.name} sourceRoot must be ${expectedSourceRoot}.`);
  if (!project.tags.includes('type:styles') && !fs.existsSync(path.join(root, expectedSourceRoot, 'index.ts'))) throw new Error(`${project.name} must expose src/index.ts as its public API.`);
}
if (projects.length !== appProjects.length + libraryProjects.length) throw new Error(`Unexpected Nx projects outside apps/ and libs/truck-log/: ${projects.length}.`);

console.log(`[PASS] Nx project layout is canonical: 4 apps with src/ entry points + ${libraryProjects.length} focused libraries with public APIs.`);
