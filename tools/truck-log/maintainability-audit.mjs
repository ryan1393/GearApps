import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.slice(2).includes('--strict');
const SOURCE_ROOTS = ['apps', 'libs', 'tools/truck-log'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.mjs', '.js', '.css', '.html']);
const CODE_LINE_BUDGET = 1500;
// The NestJS API was split along its natural seams (queries, commands, stores,
// runtimes). Keep it that way: no server source file may grow past this budget.
// The largest remaining files are driver-print.store.ts and the visit slip renderer.
const SERVER_CODE_ROOT = 'libs/truck-log/server/';
const SERVER_CODE_LINE_BUDGET = 500;
const CSS_LINE_BUDGET = 750;
const HTML_LINE_BUDGET = 800;
// No exact duplicates are allowed. The RXO auth helper used to be copied into
// both workers; it now has one source in libs/truck-log/rxo-shared.
const DUPLICATE_ALLOWLIST = new Set([]);
const RXO_SHARED_MODULES = ['rxo-auth.mjs', 'process-lock.mjs', 'batch-retention.mjs'];

function normalized(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isGeneratedOrTest(relativePath) {
  const name = path.basename(relativePath);
  return relativePath.includes('/node_modules/')
    || relativePath.includes('/dist/')
    || relativePath.includes('/build/')
    || relativePath.includes('/coverage/')
    || relativePath.includes('/.nx/')
    || relativePath.startsWith('tests/')
    || /^test-.*\.(?:mjs|js|ts)$/.test(name)
    || /^validate-.*\.(?:mjs|js|ts)$/.test(name);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const files = SOURCE_ROOTS.flatMap((directory) => walk(path.join(root, directory)))
  .map((absolute) => ({ absolute, relative: normalized(path.relative(root, absolute)) }))
  .filter(({ absolute, relative }) => SOURCE_EXTENSIONS.has(path.extname(absolute)) && !isGeneratedOrTest(relative));

const rows = files.map(({ absolute, relative }) => {
  const content = fs.readFileSync(absolute, 'utf8');
  return {
    relative,
    extension: path.extname(absolute),
    lines: content.split(/\r?\n/).length,
    bytes: Buffer.byteLength(content),
    hash: crypto.createHash('sha256').update(content).digest('hex'),
  };
});

const failures = [];
for (const row of rows) {
  const budget = row.extension === '.css'
    ? CSS_LINE_BUDGET
    : row.extension === '.html'
      ? HTML_LINE_BUDGET
      : row.relative.startsWith(SERVER_CODE_ROOT)
        ? SERVER_CODE_LINE_BUDGET
        : CODE_LINE_BUDGET;
  if (row.lines > budget) {
    failures.push(`${row.relative} is ${row.lines} lines (budget ${budget})`);
  }
}

const hashGroups = new Map();
for (const row of rows.filter((item) => item.bytes >= 1000)) {
  const list = hashGroups.get(row.hash) ?? [];
  list.push(row.relative);
  hashGroups.set(row.hash, list);
}
for (const paths of hashGroups.values()) {
  if (paths.length < 2) continue;
  const key = [...paths].sort().join('|');
  if (!DUPLICATE_ALLOWLIST.has(key)) {
    failures.push(`unexpected exact duplicate source: ${[...paths].sort().join(', ')}`);
  }
}

const required = [
  'libs/truck-log/web/feature/check-in/src/lib/check-in.component.html',
  'libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.controller.ts',
  'libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.service.ts',
  'libs/truck-log/server/feature/rxo-documents/src/lib/rxo-document-pdf-validation.ts',
  'libs/truck-log/server/feature/rxo-documents/src/lib/rxo-document-orphan-reconciler.ts',
  'apps/rxo-integration/src/lib/rxo-filter-input.mjs',
  'apps/rxo-integration/src/lib/rxo-filter-selection.mjs',
  'apps/rxo-integration/src/lib/rxo-filter-ui.mjs',
  'apps/rxo-integration/src/lib/rxo-export-publication.mjs',
  'tools/truck-log/database-tooling.mjs',
  'docs/truck-log/MAINTAINABILITY.md',
  'CONTRIBUTING.md',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing maintainability boundary: ${relative}`);
}

const checkIn = fs.readFileSync(path.join(root, 'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts'), 'utf8');
if (!checkIn.includes("templateUrl: './check-in.component.html'")) {
  failures.push('Check-In must keep presentation in check-in.component.html');
}

const expediteModule = fs.readFileSync(path.join(root, 'libs/truck-log/server/feature/rxo-expedite/src/lib/rxo-expedite.module.ts'), 'utf8');
if (expediteModule.split(/\r?\n/).length > 80 || expediteModule.includes('spawn(') || expediteModule.includes('dataSource.query')) {
  failures.push('RXO Expedite module must stay a thin Nest composition root');
}

const rxoFilterUi = fs.readFileSync(path.join(root, 'apps/rxo-integration/src/lib/rxo-filter-ui.mjs'), 'utf8');
if (rxoFilterUi.split(/\r?\n/).length > 700 || rxoFilterUi.includes('async function optionCandidates') || rxoFilterUi.includes('async function typeFilterSearch')) {
  failures.push('RXO filter UI must stay an orchestration module; input and option-selection logic belong in extracted modules');
}
const rxoExporter = fs.readFileSync(path.join(root, 'apps/rxo-integration/src/rxo-fort-wayne-export.mjs'), 'utf8');
if (rxoExporter.includes('function requiredLatestFiles') || rxoExporter.includes('function copyFileToLatest')) {
  failures.push('RXO exporter publication/verification logic must stay in rxo-export-publication.mjs');
}

for (const app of ['rxo-integration', 'rxo-expedite']) {
  for (const name of RXO_SHARED_MODULES) {
    const shim = path.join(root, 'apps', app, 'src/lib', name);
    const text = fs.existsSync(shim) ? fs.readFileSync(shim, 'utf8') : '';
    if (!text.includes(`export * from '../../../../libs/truck-log/rxo-shared/${name}';`) || text.split(/\r?\n/).length > 12) {
      failures.push(`apps/${app}/src/lib/${name} must stay a re-export shim of libs/truck-log/rxo-shared/${name}`);
    }
  }
  const dockerfile = fs.readFileSync(path.join(root, 'apps', app, 'Dockerfile'), 'utf8');
  if (!dockerfile.includes('COPY libs/truck-log/rxo-shared/ ./src/lib/')) {
    failures.push(`apps/${app}/Dockerfile must copy libs/truck-log/rxo-shared into src/lib`);
  }
}

const rxoDocuments = fs.readFileSync(path.join(root, 'libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.service.ts'), 'utf8');
for (const marker of ['RxoDocumentOrphanReconciler', 'validateRxoDriverDocumentPdf']) {
  if (!rxoDocuments.includes(marker)) failures.push(`RXO Documents service is missing extracted boundary ${marker}`);
}

if (fs.existsSync(path.join(root, 'libs/truck-log/web/styles/src/styles/global-polish/global-polish-foundation.css'))) {
  failures.push('retired monolithic global-polish-foundation.css returned');
}

// Migrations: numbered files run by one runner; nothing else may apply schema changes.
const migrationsDir = path.join(root, 'database/truck-log/migrations');
for (const name of fs.readdirSync(migrationsDir)) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) failures.push(`migration file name must look like 0002_short_name.sql: ${name}`);
}
for (const name of fs.readdirSync(path.join(root, 'tools/truck-log'))) {
  if (/^apply-.*\.mjs$/.test(name)) failures.push(`one-off migration wrapper returned: tools/truck-log/${name}; add a numbered migration instead`);
}

const top = [...rows].sort((a, b) => b.lines - a.lines).slice(0, 20);
console.log('Truck Log maintainability audit');
console.log(`Active source files inspected: ${rows.length}`);
console.log(`Budgets: code <= ${CODE_LINE_BUDGET} (server code under ${SERVER_CODE_ROOT} <= ${SERVER_CODE_LINE_BUDGET}), CSS <= ${CSS_LINE_BUDGET}, HTML <= ${HTML_LINE_BUDGET} lines`);
console.log('');
console.log('Largest active source files:');
for (const row of top) {
  console.log(`${String(row.lines).padStart(5)}  ${row.relative}`);
}
console.log('');
console.log('Shared RXO modules: libs/truck-log/rxo-shared/ (copied into both worker images over src/lib re-export shims).');

if (failures.length) {
  console.log('');
  console.log('Maintainability findings:');
  for (const failure of failures) console.log(`- ${failure}`);
  if (strict) process.exitCode = 1;
} else {
  console.log('');
  console.log('[PASS] Maintainability boundaries and source-size budgets passed.');
}
