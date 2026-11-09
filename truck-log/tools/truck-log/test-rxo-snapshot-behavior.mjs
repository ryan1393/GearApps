// Behavioral coverage for the supplied parsers and settings paths. No live RXO,
// Docker, database or browser operations are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { exportWindow, exportAssertWindow } from '../../apps/rxo-integration/src/lib/rxo-export-window.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ExcelJS = require('exceljs');
const root = process.cwd();
const lib = path.join(root, 'libs/truck-log/server/feature/rxo-ingestion/src/lib');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-rxo-behavior-'));
const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(compile(file), file);
function compile(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    fileName: file,
  }).outputText;
  // Execute actual public Nx library entry points after infrastructure extraction.
  return output.replace(/(["'])@truck-log\/([^"']+)\1/g, (_match, _quote, name) =>
    JSON.stringify(path.join(root, 'libs/truck-log', name, 'src/index.ts')));
}
let checks = 0;
function test(label, run) {
  return Promise.resolve().then(run).then(() => { checks++; console.log(`[PASS] ${label}`); });
}

try {
  const { RxoSnapshotFields } = require(path.join(lib, 'rxo-snapshot-fields.ts'));
  const { RxoSnapshotReader } = require(path.join(lib, 'rxo-snapshot-reader.ts'));
  const { RxoControlRuntime } = require(path.join(lib, 'rxo-control-runtime.ts'));
  const { RxoControlService } = require(path.join(lib, 'rxo-control.service.ts'));
  const fields = new RxoSnapshotFields(temp, 'America/Indiana/Indianapolis');
  const reader = new RxoSnapshotReader(temp, 'America/Indiana/Indianapolis');

  await test('newline, CRLF and mixed order-ID separators preserve each real ID', () => {
    for (const value of ['O1\nO2', 'O1\r\nO2', 'O1\rO2', ' o1 ; O2|o1,\n O3\r\n ']) {
      const expected = value.includes('O3') ? ['O1', 'O2', 'O3'] : ['O1', 'O2'];
      assert.deepEqual(fields.fieldList({ 'Order ID': value }, ['Order ID']), expected);
    }
    assert.deepEqual(fields.fieldList({ 'Order ID': { richText: [{ text: 'O1\r\n' }, { text: 'O2' }] } }, ['Order ID']), ['O1', 'O2']);
    assert.deepEqual(fields.fieldList({ 'Order ID': { formula: 'A1', result: 'O1\nO2' } }, ['Order ID']), ['O1', 'O2']);
    assert.deepEqual(fields.fieldList({}, ['Order ID']), []);
    assert.equal(fields.text(' A\r\n B '), 'A B');
  });

  async function readRows(name, fill) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    fill(sheet);
    const file = path.join(temp, `${name}.xlsx`);
    await workbook.xlsx.writeFile(file);
    return reader.readWorkbook(file, 'shipments');
  }

  await test('blank rows between records preserve later shipments', async () => {
    const result = await readRows('gaps', sheet => {
      sheet.getRow(1).values = ['Shipment ID', 'Status'];
      sheet.getRow(2).values = ['S1', 'Pending'];
      sheet.getRow(4).values = ['S2', 'Pending'];
    });
    assert.deepEqual(result.rows.map(row => row['Shipment ID']), ['S1', 'S2']);
  });

  await test('header scan uses row positions, including leading blank rows', async () => {
    const result = await readRows('leading', sheet => {
      sheet.getRow(8).values = ['Shipment ID', 'Status'];
      sheet.getRow(10).values = ['S1', 'Pending'];
    });
    assert.equal(result.headerRow, 8);
    assert.deepEqual(result.rows.map(row => row['Shipment ID']), ['S1']);
  });

  await test('sparse worksheet counts populated data toward the row limit', async () => {
    const result = await readRows('sparse-limit', sheet => {
      sheet.getRow(1).values = ['Shipment ID', 'Status'];
      sheet.getRow(25002).values = ['S1', 'Pending'];
    });
    assert.deepEqual(result.rows.map(row => row['Shipment ID']), ['S1']);
    await assert.rejects(() => readRows('over-limit', sheet => {
      sheet.getRow(1).values = ['Shipment ID', 'Status'];
      for (let n = 0; n < 25001; n++) sheet.addRow([`S${n}`, 'Pending']);
    }), /exceeds 25,000 rows/);
  });

  const config = { get: (_name, fallback) => fallback };
  const runtime = new RxoControlRuntime(config);
  await test('legacy window settings are ignored while supported scan settings survive', async () => {
    runtime.readVolumeFile = async () => JSON.stringify({
      operationalLookbackDays: 14, operationalLookaheadDays: 90,
      syncIntervalMinutes: 15, maxScanDurationMinutes: 60, noProgressTimeoutMinutes: 10,
    });
    assert.deepEqual(await runtime.readSettings(), {
      syncIntervalMinutes: 15, maxScanDurationMinutes: 60, noProgressTimeoutMinutes: 10,
    });
    const control = new RxoControlService(config, {});
    control.runtime.requireDocker = async () => 'test';
    control.runtime.readSettings = () => runtime.readSettings();
    let stored;
    control.runtime.writeVolumeFile = async (_volume, file, content) => { assert.equal(file, 'control-settings.json'); stored = JSON.parse(content); };
    await control.updateSettings({ operationalLookbackDays: 99, operationalLookaheadDays: 365, syncIntervalMinutes: 20 });
    assert.deepEqual(stored, { syncIntervalMinutes: 20, maxScanDurationMinutes: 60, noProgressTimeoutMinutes: 10 });
  });

  await test('API reports the actual fixed export plan even if Docker is unavailable', async () => {
    const control = new RxoControlService(config, {});
    control.runtime.requireDocker = async () => { throw new Error('offline'); };
    const status = await control.status();
    assert.deepEqual(status.exportWindow, { lookbackDays: 1, lookaheadDays: 1, timeZone: 'America/Indiana/Indianapolis' });
    assert.deepEqual(status.settings, runtime.defaultSettings());
    for (const now of [new Date('2026-01-01T17:00:00Z'), new Date('2026-11-01T05:30:00Z')]) {
      const plan = exportWindow(now);
      assert.equal(plan.timeZone, status.exportWindow.timeZone);
      assert.equal(plan.dates.length, status.exportWindow.lookbackDays + 1 + status.exportWindow.lookaheadDays);
      assert.equal(plan.startDate, plan.dates[0]);
      assert.equal(plan.endDate, plan.dates[2]);
      exportAssertWindow(plan, now);
      assert.throws(() => exportAssertWindow(plan, new Date(now.getTime() + 86400000)), /calendar day changed/);
    }
    assert.deepEqual(exportWindow(new Date('2026-01-01T03:00:00Z')).dates, ['2025-12-30', '2025-12-31', '2026-01-01']);
  });

  await test('settings panel sends only supported settings and states the real coverage', () => {
    const file = path.join(root, 'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-settings-panel.component.ts');
    const exports = {};
    const decorator = () => () => {};
    const angular = { Component: decorator, Input: decorator, Output: decorator, EventEmitter: class { emit() {} } };
    vm.runInNewContext(compile(file), {
      exports, require: name => name === '@angular/core' ? angular : {},
    }, { filename: file });
    let payload;
    const panel = new exports.RxoSettingsPanelComponent({ updateRxoSettings: value => {
      payload = value; return { subscribe: ({ next }) => next() };
    } }, { success() {}, error() {} }, { canWrite: () => true });
    panel.form = exports.emptyRxoSettingsForm();
    assert.equal(panel.settingsValid, true);
    panel.saveSettings();
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), { syncIntervalMinutes: 30, maxScanDurationMinutes: 30, noProgressTimeoutMinutes: 15 });
    const html = fs.readFileSync(file.replace('.ts', '.html'), 'utf8');
    assert.match(html, /Active load window:/);
    assert.match(html, /Exports below RXO's row limit are kept in full/);
    assert.match(html, /yesterday, today and tomorrow in Fort Wayne time/);
    assert.doesNotMatch(html, /Look back|Look ahead|settingsLookback|settingsLookahead/);
    const summary = fs.readFileSync(path.join(path.dirname(file), 'rxo-control-center.component.html'), 'utf8');
    assert.match(summary, /Yesterday, today and tomorrow \(Fort Wayne time\)/);
  });

  console.log(`[PASS] RXO parser/settings behavior: ${checks} cases.`);
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
  fs.rmSync(temp, { recursive: true, force: true });
}
