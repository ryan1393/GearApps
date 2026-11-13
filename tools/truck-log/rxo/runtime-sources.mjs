// The standard RXO worker is split into thin entry points plus src/lib modules:
//   exporter  src/rxo-fort-wayne-export.mjs + src/lib/rxo-export-*.mjs
//   scheduler src/rxo-scheduler.mjs + src/lib/rxo-scheduler-*.mjs
// Source-marker contracts read each entry point together with its modules.
import fs from 'node:fs';
import path from 'node:path';

export const EXPORTER_ENTRY = 'apps/rxo-integration/src/rxo-fort-wayne-export.mjs';
export const SCHEDULER_ENTRY = 'apps/rxo-integration/src/rxo-scheduler.mjs';

function moduleFiles(root, pattern) {
  const lib = path.join(root, 'apps/rxo-integration/src/lib');
  return fs.readdirSync(lib).filter(name => pattern.test(name)).sort()
    .map(name => `apps/rxo-integration/src/lib/${name}`);
}

export function exporterSourceFiles(root = process.cwd()) {
  return [EXPORTER_ENTRY, ...moduleFiles(root, /^rxo-export-.*\.mjs$/)];
}

export function schedulerSourceFiles(root = process.cwd()) {
  return [SCHEDULER_ENTRY, ...moduleFiles(root, /^rxo-scheduler-.*\.mjs$/)];
}

function readAll(root, files) {
  return files
    .map(rel => `\n/* SOURCE: ${rel} */\n${fs.readFileSync(path.join(root, rel), 'utf8')}`)
    .join('\n');
}

export const readExporterSource = (root = process.cwd()) => readAll(root, exporterSourceFiles(root));
export const readSchedulerSource = (root = process.cwd()) => readAll(root, schedulerSourceFiles(root));
