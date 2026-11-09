import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORITATIVE_DOCKS } from './sync-authoritative-docks.mjs';
import { readSchemaSql, schemaIncludes } from '../migration-sql.mjs';

const expected = [
  ['7','West',10],['25','Carrier',20],['28','Receiving',30],['41','North Building',40],['49','Steel Coil',50],
  ['52','Long Bar',60],['61','Tube',70],['62','Tube',80],['68','Forge',90],
];
if (AUTHORITATIVE_DOCKS.length !== expected.length) throw new Error(`Expected ${expected.length} docks, got ${AUTHORITATIVE_DOCKS.length}`);
for (let i = 0; i < expected.length; i++) {
  const [code, description, sortOrder] = expected[i];
  const got = AUTHORITATIVE_DOCKS[i];
  if (got.code !== code || got.description !== description || got.sortOrder !== sortOrder) {
    throw new Error(`Dock row ${i + 1} mismatch: ${JSON.stringify(got)}`);
  }
}
const codes = AUTHORITATIVE_DOCKS.map(x => x.code);
if (new Set(codes).size !== codes.length) throw new Error('Duplicate Dock code in authoritative master.');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = readSchemaSql();
for (const [code, description, sortOrder] of expected) {
  const escaped = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\(\\d+, '${code}', '${escaped}', true, ${sortOrder},`);
  if (!pattern.test(migration)) throw new Error(`The baseline migration does not seed authoritative dock ${code} ${description}.`);
}
if (!schemaIncludes("('site_name', 'Dana Fort Wayne Plant'")) throw new Error('The baseline migration does not seed Dana Fort Wayne Plant identity.');
if (!schemaIncludes("('plant_location_name', 'Fort Wayne'")) throw new Error('The baseline migration does not seed Fort Wayne plant location.');

const csv = fs.readFileSync(path.join(root, 'reference-data-import/truck-log-dock-master.csv'), 'utf8').trim().split(/\r?\n/);
const csvRows = csv.slice(1).map(line => {
  const fields = line.split(',');
  return [fields[4], fields[1]];
});
if (csvRows.length !== expected.length) throw new Error(`Dock reference CSV has ${csvRows.length} rows; expected ${expected.length}.`);
for (let i = 0; i < expected.length; i++) {
  if (csvRows[i][0] !== expected[i][0] || csvRows[i][1] !== expected[i][1]) {
    throw new Error(`Dock reference CSV row ${i + 1} drifted from authoritative source.`);
  }
}

console.log('[PASS] Authoritative Fort Wayne dock master is consistent across runtime sync, fresh migration seed and reference CSV.');
