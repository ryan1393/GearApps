import { contractPath, workspaceRoot } from './lib/contract-paths.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.nx', '.git', 'dist', 'build', 'coverage',
  '_patch_backups', '.angular', '.cache', '_archive'
]);

function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  // These inputs are text configuration files. Git may check them out with
  // CRLF on Windows and LF on Linux; the fingerprint must describe the source.
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walkProjectFiles(root, startRel) {
  const start = contractPath(root, startRel);
  if (!fs.existsSync(start)) return [];
  const out = [];
  const visit = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory() && EXCLUDED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(full);
      else if (ent.isFile() && ent.name === 'project.json') out.push(full);
    }
  };
  visit(start);
  return out;
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

export function buildGearMergeManifest(root = workspaceRoot) {
  const pkg = readJson(contractPath(root, 'package.json'));
  const projectFiles = [
    ...walkProjectFiles(root, 'apps'),
    ...walkProjectFiles(root, 'libs'),
  ];

  const projects = projectFiles.map((file) => {
    const cfg = readJson(file);
    const targets = Object.keys(cfg.targets ?? {}).sort();
    return {
      name: cfg.name ?? null,
      root: rel(root, path.dirname(file)),
      projectType: cfg.projectType ?? null,
      tags: [...(cfg.tags ?? [])].sort(),
      targets,
      hasBuildTarget: targets.includes('build'),
      hasServeTarget: targets.includes('serve'),
      hasTestTarget: targets.includes('test'),
    };
  }).sort((a, b) =>
    String(a.name).localeCompare(String(b.name)) || a.root.localeCompare(b.root)
  );

  const composeFiles = ['compose.yml']
    .filter((name) => fs.existsSync(contractPath(root, name)))
    .map((name) => ({ path: name, sha256: sha256File(contractPath(root, name)) }));

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const frameworkVersions = {};
  for (const name of ['nx', '@angular/core', '@nestjs/core', 'typeorm', 'pg', 'typescript']) {
    if (deps[name]) frameworkVersions[name] = deps[name];
  }

  const rootHashes = {};
  for (const name of ['package.json', 'package-lock.json', 'nx.json', 'tsconfig.base.json']) {
    if (fs.existsSync(contractPath(root, name))) rootHashes[name] = sha256File(contractPath(root, name));
  }

  const runtimeNames = ['lapper-client', 'lapper-read', 'blade-tracking', 'cutter-builder', 'greenshed', 'meshforge-server'];
  const runtimeProjects = runtimeNames.map((name) => {
    const project = projects.find((p) => p.name === name);
    return project ?? { name, missing: true };
  });

  return {
    schemaVersion: 1,
    hashEncoding: 'utf8-lf',
    baseline: 'Dana Apps V70.0.0',
    releaseVersion: pkg.version,
    workspace: 'single-root',
    authoritativeTest: pkg.scripts?.['test:unit'] ?? null,
    sourcePackager: fs.existsSync(contractPath(root, 'tools/package-release.mjs'))
      ? 'tools/package-release.mjs'
      : null,
    masterUiBaseline: fs.existsSync(contractPath(root, 'docs/manufacturing/DANA_MASTER_UI_BASELINE.md'))
      ? 'docs/manufacturing/DANA_MASTER_UI_BASELINE.md'
      : null,
    gearPreMergeReadiness: fs.existsSync(contractPath(root, 'docs/manufacturing/DANA_APPS_GEAR_PREMERGE_READINESS.md'))
      ? 'docs/manufacturing/DANA_APPS_GEAR_PREMERGE_READINESS.md'
      : null,
    sourcePackageHygiene: fs.existsSync(contractPath(root, 'docs/manufacturing/DANA_APPS_SOURCE_PACKAGE_HYGIENE.md'))
      ? 'docs/manufacturing/DANA_APPS_SOURCE_PACKAGE_HYGIENE.md'
      : null,
    frameworkVersions,
    rootHashes,
    composeFiles,
    runtimeProjects,
    projects,
  };
}

export function stableStringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (invoked) {
  const root = workspaceRoot;
  const output = path.join(workspaceRoot, 'docs/manufacturing/DANA_APPS_GEAR_MERGE_MANIFEST.json');
  fs.writeFileSync(output, stableStringify(buildGearMergeManifest(root)));
  console.log(`[PASS] Gear merge manifest generated: ${output}`);
}
