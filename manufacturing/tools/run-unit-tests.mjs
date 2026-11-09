import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projects = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      ['node_modules', 'dist', '.nx'].includes(entry.name) ||
      entry.name.endsWith('-e2e')
    )
      continue;
    const folder = path.join(directory, entry.name);
    const config = ['jest.config.cts','jest.config.ts','jest.config.js'].map(name => path.join(folder,name)).find(file => fs.existsSync(file));
    if (config) projects.push(config);
    else visit(folder);
  }
}
visit(path.join(root, 'apps'));
visit(path.join(root, 'libs'));
visit(path.join(root, 'manufacturing/apps'));
visit(path.join(root, 'manufacturing/libs'));
projects.sort();

// ts-jest retains a compiler per project. Recycling the process between small,
// sequential batches avoids retaining the whole server and browser graph at once.
const backend = projects.filter(
  (file) =>
    file.startsWith(path.join(root, 'manufacturing/libs/server') + path.sep) ||
    file.startsWith(path.join(root, 'manufacturing/apps/server') + path.sep) ||
    file.startsWith(path.join(root, 'libs/api') + path.sep) ||
    file.startsWith(path.join(root, 'apps/lapper-api') + path.sep),
);
const other = projects.filter((file) => !backend.includes(file));
const batches = [];
for (const [name, configs] of [
  ['server', backend],
  ['frontend/shared', other],
]) {
  for (let offset = 0; offset < configs.length; offset += 6)
    batches.push({ name, projects: configs.slice(offset, offset + 6) });
}
if (!batches.length) throw new Error('No unit test projects were found');

const forwarded = [];
let outputFile;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--outputFile') {
    outputFile = process.argv[++i];
    if (!outputFile) throw new Error('--outputFile requires a path');
  } else if (arg.startsWith('--outputFile='))
    outputFile = arg.slice('--outputFile='.length);
  else if (arg !== '--json') forwarded.push(arg);
}
const listing = forwarded.includes('--listTests');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gearapps-unit-'));
const numericKeys = [
  'numFailedTestSuites',
  'numFailedTests',
  'numPassedTestSuites',
  'numPassedTests',
  'numPendingTestSuites',
  'numPendingTests',
  'numRuntimeErrorTestSuites',
  'numTodoTests',
  'numTotalTestSuites',
  'numTotalTests',
];
const summary = {
  success: true,
  wasInterrupted: false,
  startTime: Date.now(),
  testResults: [],
  openHandles: [],
};
for (const key of numericKeys) summary[key] = 0;
try {
  for (const [index, batch] of batches.entries()) {
    const report = path.join(temporary, `${index}.json`);
    console.log(
      `Unit tests: ${batch.name} batch ${index + 1}/${batches.length} (${batch.projects.length} projects)`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=2048',
        path.join(root, 'node_modules/jest/bin/jest.js'),
        '--runInBand',
        '--passWithNoTests',
        ...forwarded,
        ...(listing ? [] : ['--json', `--outputFile=${report}`]),
        '--projects',
        ...batch.projects,
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          ENVIRONMENT: 'test',
          NX_DAEMON: 'false',
          JWT_ACCESS_SECRET: 'unit-test-access-secret-no-production-use',
          JWT_REFRESH_SECRET: 'unit-test-refresh-secret-no-production-use',
          DATABASE_TYPE: 'better-sqlite3',
          DATABASE_PATH: ':memory:',
          EMAIL_ENABLED: 'false',
          SOCIAL_GOOGLE_ENABLED: 'false',
          SENTRY_DSN: '',
        },
      },
    );
    if (result.error) throw result.error;
    summary.success &&= result.status === 0;
    if (fs.existsSync(report)) {
      const current = JSON.parse(fs.readFileSync(report, 'utf8'));
      summary.success &&= current.success === true;
      summary.wasInterrupted ||= current.wasInterrupted === true;
      summary.testResults.push(...(current.testResults ?? []));
      summary.openHandles.push(...(current.openHandles ?? []));
      for (const key of numericKeys) summary[key] += current[key] ?? 0;
    }
    if (result.signal) {
      summary.wasInterrupted = true;
      break;
    }
  }
  if (!listing) {
    console.log(
      `Unit totals: ${summary.numPassedTests}/${summary.numTotalTests} tests passed across ${summary.numTotalTestSuites} suites; ${summary.success ? 'PASS' : 'FAIL'}.`,
    );
    if (outputFile) {
      const destination = path.resolve(root, outputFile);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify(summary) + '\n');
      console.log(`Combined test results written to ${destination}`);
    }
  }
  process.exitCode = summary.success ? 0 : 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
