import { createRequire } from 'node:module';
import fs from 'node:fs';
import { sha256File } from './rxo-export-runtime.mjs';
import { EXPORT_ZONE, exportWindow, exportAssertWindow } from './rxo-export-window.mjs';

const EXPORT_XLSX = createRequire(import.meta.url)('xlsx');

function exportDatasetEvidence(item) {
  return { pageKey: item.pageKey, direction: item.direction, completeness: item.completeness,
    downloadValidation: item.download?.downloadValidation ?? null };
}

// RXO_EXPORT: retained, runtime-verified RXO date filtering. Inlined into the supplied exporter.
const EXPORT_LIMIT = 10000;
const exportCanon = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const exportText = value => String(value ?? '').trim();

function exportDay(value) {
  const plantDay = date => {
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: EXPORT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  if (value instanceof Date) return plantDay(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return plantDay(date);
  }
  const text = exportText(value);
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})(?:\s|$)/i.exec(text);
  if (match) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].toLowerCase()) + 1;
    const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const date = new Date(iso + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
    const clock = /\s(\d{1,2}):(\d{2})(?:\s*(ET|CT|MT|PT))?$/i.exec(text);
    if (!clock) return iso;
    const hour = Number(clock[1]), minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return null;
    const zones = { ET: EXPORT_ZONE, CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles' };
    const zone = zones[String(clock[3] || 'ET').toUpperCase()];
    const wanted = Date.UTC(Number(match[3]), month - 1, Number(match[2]), hour, minute);
    let instant = new Date(wanted);
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
      const delta = wanted - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
      if (!delta) break;
      instant = new Date(instant.getTime() + delta);
    }
    return plantDay(instant);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) return null;
    return plantDay(date);
  }
  return null;
}

function exportSiteDay(table, row, kind, direction) {
  const side = direction === 'OUTBOUND' ? 'Pickup' : 'Delivery';
  const headers = (kind === 'orders' ? [`Early ${side} Date`, `Late ${side} Date`] : []).concat([
    `${side} - Appointment Arrival`, `${side} Appointment Arrival`,
    `${side} - Estimated Arrival`, `${side} Estimated Arrival`, `${side} Est. Arrival`, `${side} Date`,
  ]);
  for (const name of headers) {
    const index = table.headers.findIndex(header => exportCanon(header) === exportCanon(name));
    if (index >= 0) {
      const date = exportDay(row[index]);
      if (date) return date;
    }
  }
  return null;
}

function exportReadWorkbook(file, kind) {
  const book = EXPORT_XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const sheet = book.SheetNames[0];
  if (!sheet) throw new Error(`${kind}: workbook has no worksheet.`);
  const matrix = EXPORT_XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: true });
  const expected = new Set(kind === 'orders'
    ? ['ordernumber','orderid','shipmentid','originname','destinationname','pickupdate','deliverydate','status']
    : ['shipmentid','shipment','orders','status','mode','carrier','firststopaddress','laststopaddress']);
  let headerIndex = -1, best = -1;
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const keys = new Set(matrix[i].map(exportCanon).filter(Boolean));
    let score = Math.min(keys.size, 20) + matrix[i].filter(value => /[a-z]/i.test(String(value ?? ''))).length;
    for (const key of keys) if (expected.has(key)) score += 10;
    if (score > best) { best = score; headerIndex = i; }
  }
  const headers = (matrix[headerIndex] || []).map(exportText);
  const allowed = kind === 'orders' ? ['ordernumber','orderid','order'] : ['shipmentid','shipmentnumber','shipment'];
  const keyIndex = headers.findIndex(value => allowed.includes(exportCanon(value)));
  if (keyIndex < 0) throw new Error(`${kind}: expected workbook key header is missing.`);
  const populated = matrix.slice(headerIndex + 1).filter(row => row.some(value => exportText(value)));
  const rows = populated.filter(row => exportText(row[keyIndex]));
  if (populated.length > 0 && !rows.length) throw new Error(`${kind}: populated workbook has no keyed rows.`);
  return { headers, keyIndex, rows, sourceRows: populated.length, sheet, headerRow: headerIndex + 1,
    sha256: sha256File(file), capped: populated.length >= EXPORT_LIMIT };
}


// RXO_EXPORT live menu evidence: Orders and Shipments use different date columns.
// Shipments scheduling uses Appointment Arrival, then Estimated Arrival.
// Fetch both independently: a capped baseline cannot reveal every missing row.
function exportDateColumns(kind, direction) {
  if (!['OUTBOUND', 'INBOUND'].includes(direction)) throw new Error('RXO_EXPORT: unknown date direction.');
  const side = direction === 'OUTBOUND' ? 'Pickup' : 'Delivery';
  if (kind === 'orders') return [side + ' Date'];
  if (kind === 'shipments') return [side + ' Appointment Arrival', side + ' Estimated Arrival'];
  throw new Error('RXO_EXPORT: no verified date-column plan for ' + kind + '.');
}

function exportShipmentDateSchema(table, direction) {
  const columns = exportDateColumns('shipments', direction);
  const names = table.headers.map(exportCanon);
  for (const column of columns) {
    const aliases = [exportCanon(column)];
    if (column.includes('Estimated')) aliases.push(exportCanon(column.replace('Estimated', 'Est.')));
    if (names.filter(name => aliases.includes(name)).length !== 1) {
      throw new Error('RXO_EXPORT: Shipments workbook must identify one ' + column + ' column.');
    }
  }
  const side = direction === 'OUTBOUND' ? 'Pickup' : 'Delivery';
  // A generic Date column would introduce another importer fallback. The live
  // menu did not expose a matching generic Shipments option; do not guess.
  if (names.includes(exportCanon(side + ' Date'))) {
    throw new Error('RXO_EXPORT: unsupported generic Shipments ' + side + ' Date fallback; arrival-only completeness cannot be verified.');
  }
}

export {
  EXPORT_LIMIT,
  EXPORT_ZONE,
  exportAssertWindow,
  exportCanon,
  exportDatasetEvidence,
  exportDateColumns,
  exportDay,
  exportReadWorkbook,
  exportShipmentDateSchema,
  exportSiteDay,
  exportText,
  exportWindow,
};
// Date-range UI: rxo-export-date-filter.mjs. Header alignment and merging: rxo-export-merge.mjs.
