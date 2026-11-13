// Default: source/lock contracts, no installs/network. --fixtures additionally
// runs real SheetJS parser/writer paths after npm ci in apps/rxo-integration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const json = rel => JSON.parse(read(rel));
const sheetJs = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
const sheetIntegrity = 'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==';
let checks = 0;
async function test(name, run) { await run(); checks++; console.log(`[PASS] ${name}`); }

for (const app of ['rxo-integration', 'rxo-expedite']) {
  await test(`${app}: reproducible locked graph and matching patched browser image`, () => {
    const base = `apps/${app}`, pkg = json(`${base}/package.json`), lock = json(`${base}/package-lock.json`);
    assert.equal(pkg.version, read('VERSION').trim());
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
    assert.equal(pkg.dependencies.playwright, '1.55.1');
    assert.equal(lock.packages['node_modules/playwright'].version, '1.55.1');
    assert.equal(lock.packages['node_modules/playwright-core'].version, '1.55.1');
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!name) continue;
      assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
      assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/') || entry.resolved === sheetJs);
    }
    const docker = read(`${base}/Dockerfile`);
    assert.ok(docker.includes('FROM mcr.microsoft.com/playwright:v1.55.1-noble'));
    assert.ok(docker.includes(`COPY ${base}/package.json ${base}/package-lock.json ./`));
    assert.match(docker, /RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
    assert.ok(!docker.includes('npm install'));
    assert.ok(read(`${base}/Dockerfile.dockerignore`).includes(`!${base}/package-lock.json`));
  });
}
await test('SheetJS comes from the patched official release with a pinned SHA-512', () => {
  const pkg = json('apps/rxo-integration/package.json'), lock = json('apps/rxo-integration/package-lock.json');
  assert.equal(pkg.dependencies.xlsx, sheetJs);
  assert.equal(lock.packages['node_modules/xlsx'].version, '0.20.3');
  assert.equal(lock.packages['node_modules/xlsx'].resolved, sheetJs);
  assert.equal(lock.packages['node_modules/xlsx'].integrity, sheetIntegrity);
});

if (process.argv.includes('--fixtures')) {
  const require = createRequire(path.join(root, 'apps/rxo-integration/package.json'));
  const XLSX = require('xlsx');
  assert.equal(XLSX.version, '0.20.3');
  const { exportReadWorkbook } = await import(pathToFileURL(path.join(root, 'apps/rxo-integration/src/lib/rxo-export-data.mjs')));
  const { exportCompleteDataset } = await import(pathToFileURL(path.join(root, 'apps/rxo-integration/src/lib/rxo-export-dataset.mjs')));
  const { exportWindow } = await import(pathToFileURL(path.join(root, 'apps/rxo-integration/src/lib/rxo-export-window.mjs')));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-worker-xlsx-'));
  function write(name, rows) {
    const file = path.join(temp, name);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    XLSX.writeFile(workbook, file);
    return file;
  }
  try {
    await test('actual parser preserves scalar values, multiline IDs, blank rows and dates', () => {
      const at = new Date('2026-10-28T18:30:00.000Z');
      const file = write('roundtrip.xlsx', [[], ['Shipment ID', 'Status', 'Order ID', 'Pickup Date', 'Cancel'],
        ['S1', 'Pending', 'O1\r\nO2', at, false], [], ['S2', 'Pending', 'O3', at, true]]);
      const table = exportReadWorkbook(file, 'shipments');
      assert.equal(table.headerRow, 2);
      assert.equal(table.rows.length, 2);
      assert.equal(table.rows[0][2].replace(/\r\n/g, '\n'), 'O1\nO2');
      assert.equal(table.rows[0][3].toISOString(), at.toISOString());
      assert.equal(table.rows[0][4], false);
      assert.equal(table.rows[1][4], true);
      assert.throws(() => exportReadWorkbook(write('no-key.xlsx', [['Invalid'], ['x']]), 'shipments'), /key header/);
    });
    await test('uncapped dataset is retained byte-for-byte without date filtering', async () => {
      const file = write('uncapped.xlsx', [['Order Number', 'Pickup Date', 'Cancel'], ['O1', 'Jan 01, 2026', false]]);
      const before = fs.readFileSync(file);
      const result = await exportCompleteDataset({ pageCase: { key: 'orders' }, direction: { direction: 'OUTBOUND' },
        baselineFile: file, window: exportWindow(new Date('2026-10-28T17:00:00Z')),
        exportRange: async () => { throw new Error('Uncapped dataset must not request ranges'); } });
      assert.equal(result.mode, 'UNWINDOWED_BELOW_CEILING');
      assert.ok(before.equals(fs.readFileSync(file)));
    });
    await test('capped dataset merges verified ranges through the actual upgraded writer', async () => {
      const headers = ['Order Number', 'Pickup Date', 'Cancel'];
      const selected = [['O0', 'Oct 28, 2026', false], ['O1', 'Oct 28, 2026', false]];
      const source = [...selected, ...Array.from({ length: 9998 }, (_, n) => [`OLD${n}`, 'Jan 01, 2026', false])];
      const baselineFile = write('capped.xlsx', [headers, ...source]);
      const rangeFile = write('range.xlsx', [headers, ...selected]);
      const result = await exportCompleteDataset({ pageCase: { key: 'orders' }, direction: { direction: 'OUTBOUND' },
        baselineFile, window: exportWindow(new Date('2026-10-28T17:00:00Z')),
        exportRange: async range => ({ file: rangeFile, verification: { verified: true, ...range, field: 'Pickup', timeZone: 'America/Indiana/Indianapolis' } }) });
      assert.equal(result.mode, 'VERIFIED_SITE_DATE_WINDOW');
      assert.equal(result.knownWindowRows, 2);
      assert.deepEqual(exportReadWorkbook(baselineFile, 'orders').rows, selected);
      assert.equal(result.mergeConsistency.verified, true);
    });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
console.log(`[PASS] Worker dependency contracts${process.argv.includes('--fixtures') ? '/workbook fixtures' : ''}: ${checks} cases.`);
