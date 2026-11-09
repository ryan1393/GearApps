// RXO_EXPORT: header alignment, known-row coverage and exact merging of
// separately downloaded range workbooks.
import crypto from 'node:crypto';
import { EXPORT_LIMIT, exportCanon, exportDay, exportSiteDay, exportText } from './rxo-export-data.mjs';

// Match unique columns by case/whitespace-normalized names. The live R5
// workbooks repeat two Orders names: their fixed-prefix and extension copies
// are distinct fields. Resolve only that observed schema, never occurrence
// number alone, arbitrary positional fallback, aliases or a schema union.
const exportHeaderName = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const exportHeaderKey = value => exportHeaderName(value).toLowerCase();
const EXPORT_ORDERS_FIXED_PREFIX = [
  'Customer Code', 'Order Number', 'Shipment Id', 'Customer Order Number',
  'Origin Location Name', 'Origin Address Line 1', 'Origin Address Line 2',
  'Origin City', 'Origin State', 'Origin Postal Code', 'Origin Country',
  'Early Pickup Date', 'Early Pickup Time', 'Late Pickup Date', 'Late Pickup Time',
  'Pickup - Actual Arrival', 'Destination Location Name', 'Destination Address Line 1',
  'Destination Address Line 2', 'Destination City', 'Destination State',
  'Destination Postal Code', 'Destination Country', 'Early Delivery Date',
  'Early Delivery Time', 'Late Delivery Date', 'Late Delivery Time',
  'Delivery - Actual Departure', 'Status', 'Count', 'Weight', 'Weight UOM',
  'Volume', 'Volume UOM', 'Total Shipunit Count', 'Created On (UTC Time Zone)',
  'Created By', 'Business Segment',
];

function exportHeaderShape(table) {
  let width = table.headers.length;
  for (const row of table.rows) width = Math.max(width, row.length);
  const columns = [], ignoredEmptyColumns = [], populatedUnnamedColumns = [];
  const names = new Map(), duplicates = [];
  for (let index = 0; index < width; index++) {
    const name = exportHeaderName(table.headers[index]), key = exportHeaderKey(name);
    if (!key) {
      let populatedRows = 0;
      for (const row of table.rows) if (exportText(row[index])) populatedRows++;
      if (populatedRows) populatedUnnamedColumns.push({ column: index + 1, populatedRows });
      else ignoredEmptyColumns.push(index + 1);
      continue;
    }
    if (names.has(key)) duplicates.push({ name, columns: [names.get(key) + 1, index + 1] });
    else names.set(key, index);
    columns.push({ index, name, key });
  }
  return { width, columns, names, duplicates, ignoredEmptyColumns, populatedUnnamedColumns,
    key: exportHeaderKey(table.headers[table.keyIndex]) };
}

function exportHeaderSummary(table, shape = exportHeaderShape(table)) {
  return { headerRow: table.headerRow ?? null, sourceRows: table.sourceRows, sha256: table.sha256 ?? null,
    width: shape.width, headers: Array.from({ length: shape.width }, (_, index) => exportHeaderName(table.headers[index]).slice(0, 200)),
    ignoredEmptyColumns: shape.ignoredEmptyColumns, populatedUnnamedColumns: shape.populatedUnnamedColumns,
    duplicates: shape.duplicates, keyColumn: table.keyIndex + 1 };
}

function exportOrdersDuplicateIdentity(table, shape) {
  const length = EXPORT_ORDERS_FIXED_PREFIX.length;
  if (table.keyIndex !== 1 || !EXPORT_ORDERS_FIXED_PREFIX.every((name, index) =>
    exportHeaderKey(table.headers[index]) === exportHeaderKey(name))) return null;
  const allowed = [{ name: 'Customer Code', fixedColumn: 1 }, { name: 'Created By', fixedColumn: 37 }];
  if (shape.duplicates.length !== allowed.length) return null;
  const columns = [];
  for (const field of allowed) {
    const matches = shape.columns.filter(column => column.key === exportHeaderKey(field.name));
    if (matches.length !== 2 || matches[0].index + 1 !== field.fixedColumn || matches[1].index < length) return null;
    columns.push({ ...field, extensionColumn: matches[1].index + 1 });
  }
  // Identity is the verified namespace and name. Each namespace must itself
  // be unique, so a third copy or an unrelated duplicate can never be mapped.
  const identities = shape.columns.map(column =>
    JSON.stringify([column.index < length ? 'FIXED' : 'EXTENSION', column.key]));
  if (new Set(identities).size !== identities.length) return null;
  return { identities, evidence: { verified: true, method: 'VERIFIED_ORDERS_FIXED_PREFIX',
    fixedPrefixColumns: length, columns } };
}

function exportAlignHeaders(tables, baseline, kind, direction) {
  const shapes = tables.map(exportHeaderShape), first = shapes[0];
  const diagnostic = { pageKey: kind, direction, method: 'NAMED_COLUMN_BIJECTION', verified: false,
    baseline: exportHeaderSummary(baseline), parts: tables.map((table, index) => exportHeaderSummary(table, shapes[index])) };
  const fail = message => {
    const error = new Error(`RXO_EXPORT ${kind} ${direction}: ${message}; merge stopped.`);
    error.rxoHeaderDiagnostics = diagnostic;
    throw error;
  };
  const needsDuplicateIdentity = shapes.some(shape => shape.duplicates.length);
  if (needsDuplicateIdentity) {
    if (kind !== 'orders') fail('duplicate or ambiguous column names have no verified schema for this dataset');
    const baselineIdentity = exportOrdersDuplicateIdentity(baseline, exportHeaderShape(baseline));
    if (!baselineIdentity) fail('duplicate or ambiguous column names: baseline Orders prefix cannot be verified');
    diagnostic.method = 'NAMED_COLUMNS_WITH_VERIFIED_ORDERS_PREFIX';
    diagnostic.fixedPrefixHeaders = EXPORT_ORDERS_FIXED_PREFIX;
    diagnostic.baseline.duplicateResolution = baselineIdentity.evidence;
    shapes.forEach((shape, index) => {
      const identity = exportOrdersDuplicateIdentity(tables[index], shape);
      if (!identity) fail(`range ${index + 1} has duplicate or ambiguous column names outside the verified Orders schema`);
      shape.columns.forEach((column, columnIndex) => { column.key = identity.identities[columnIndex]; });
      shape.names = new Map(shape.columns.map(column => [column.key, column.index]));
      shape.key = shape.columns.find(column => column.index === tables[index].keyIndex)?.key;
      diagnostic.parts[index].duplicateResolution = identity.evidence;
    });
  }
  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index];
    if (shape.duplicates.length && !diagnostic.parts[index].duplicateResolution?.verified) fail(`range ${index + 1} has duplicate or ambiguous column names`);
    if (shape.populatedUnnamedColumns.length) fail(`range ${index + 1} has populated unnamed columns`);
    if (!shape.key || !shape.names.has(shape.key)) fail(`range ${index + 1} has no unambiguous key column`);
    const missing = first.columns.filter(column => !shape.names.has(column.key)).map(column => column.name);
    const extra = shape.columns.filter(column => !first.names.has(column.key)).map(column => column.name);
    diagnostic.parts[index].missingColumns = missing;
    diagnostic.parts[index].extraColumns = extra;

    // RXO Shipments can add export-only metadata columns to one bounded date
    // workbook while retaining every canonical field from the first complete
    // range. Merge by the first range's named schema and ignore only bounded,
    // additive columns. Missing fields, duplicate names, populated unnamed
    // columns, key changes, Orders drift, and large/unknown schema changes still
    // fail closed. exportShipmentDateSchema() has already required both supported
    // Appointment Arrival and Estimated Arrival columns in every Shipments file.
    const additiveShipmentColumns =
      kind === 'shipments' &&
      index > 0 &&
      missing.length === 0 &&
      extra.length > 0 &&
      extra.length <= 16;

    diagnostic.parts[index].ignoredAdditiveColumns =
      additiveShipmentColumns ? extra : [];

    if (missing.length || (extra.length && !additiveShipmentColumns)) {
      fail(`range workbook headers differ in named fields (range ${index + 1}: ${missing.length} missing, ${extra.length} extra)`);
    }

    if (additiveShipmentColumns) {
      diagnostic.method = 'NAMED_COLUMN_BIJECTION_WITH_SHIPMENT_ADDITIVE_EXTRAS';
    }

    if (shape.key !== first.key) fail(`range ${index + 1} uses a different record key column`);
  }
  const headers = first.columns.map(column => column.name);
  const maps = shapes.map(shape => first.columns.map(column => shape.names.get(column.key)));
  diagnostic.verified = true;
  diagnostic.columnCount = headers.length;
  diagnostic.outputHeaders = headers;
  diagnostic.parts.forEach((part, index) => { part.sourceColumnsForOutput = maps[index].map(column => column + 1); });
  return { headers, maps, evidence: diagnostic };
}

// RXO_EXPORT: broaden acquisition only; the application's Eastern three-day window
// stays unchanged. Capped source rows are evidence, never merge input.
function exportShiftDay(day, offset) {
  return new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}
function exportRangeDays(range) {
  const days = [];
  for (let day = range.startDate; day <= range.endDate; day = exportShiftDay(day, 1)) {
    days.push(day);
    if (days.length > 31) throw new Error('RXO_EXPORT: an acquisition range exceeds 31 days. No incomplete export was accepted.');
  }
  if (!days.length) throw new Error('RXO_EXPORT: empty or reversed acquisition range.');
  return days;
}
function exportRowEvidence(table, row, kind, direction) {
  const dateFields = {};
  for (let i = 0; i < table.headers.length; i++) {
    if (/^(?:(?:early|late)\s+)?(?:pickup|delivery)\b.*(?:date|time|arrival|departure)/i.test(table.headers[i])) {
      const value = row[i];
      dateFields[table.headers[i]] = { type: value instanceof Date ? 'Date' : typeof value,
        value: value instanceof Date ? value.toISOString() : String(value ?? '').slice(0, 160) };
    }
  }
  const statusIndex = table.headers.findIndex(header => exportCanon(header) === 'status');
  return { key: exportText(row[table.keyIndex]).slice(0, 100),
    status: statusIndex < 0 ? null : exportText(row[statusIndex]).slice(0, 60),
    exporterSiteDay: exportSiteDay(table, row, kind, direction), dateFields };
}
function exportKnownWindow(baseline, kind, direction, window) {
  return new Map(baseline.rows.filter(row => {
    const day = exportSiteDay(baseline, row, kind, direction);
    return day && day >= window.startDate && day <= window.endDate;
  }).map(row => [exportText(row[baseline.keyIndex]).toUpperCase(), row]));
}
function exportMissingKnown(tables, baseline, kind, direction, window) {
  const known = exportKnownWindow(baseline, kind, direction, window);
  const seen = new Set(tables.flatMap(table => table.rows.map(row => exportText(row[table.keyIndex]).toUpperCase())));
  return { known, missing: [...known].filter(([key]) => !seen.has(key)) };
}
function exportCoverageError(message, tables, baseline, kind, direction, window, attempts) {
  const { known, missing } = exportMissingKnown(tables, baseline, kind, direction, window);
  const error = new Error(message);
  error.rxoCoverageDiagnostics = { pageKey: kind, direction, window, knownWindowRows: known.size,
    missingKnownWindowRows: missing.length, baselineCapped: baseline.capped, evidenceIsLowerBound: baseline.capped,
    missingRows: missing.slice(0, 40).map(([, row]) => exportRowEvidence(baseline, row, kind, direction)),
    missingRowsTruncated: missing.length > 40, attempts };
  return error;
}
function exportRecoveryRanges(missing, baseline, direction, covered) {
  const side = direction === 'OUTBOUND' ? 'Pickup' : 'Delivery';
  const relevant = new RegExp('^(?:(?:early|late)\\s+)?' + side + '\\b.*(?:date|arrival|departure)', 'i');
  const days = new Set();
  for (const [, row] of missing) {
    baseline.headers.forEach((header, index) => {
      if (!relevant.test(header)) return;
      const day = exportDay(row[index]);
      if (day) for (const offset of [-1, 0, 1]) {
        const candidate = exportShiftDay(day, offset);
        if (!covered.has(candidate)) days.add(candidate);
      }
    });
  }
  if (days.size > 21) throw new Error('RXO_EXPORT: missing rows require more than 21 additional acquisition days. Evidence retained; no partial merge accepted.');
  const ranges = [];
  for (const day of [...days].sort()) {
    const prior = ranges.at(-1);
    if (prior && exportShiftDay(prior.endDate, 1) === day) prior.endDate = day;
    else ranges.push({ startDate: day, endDate: day });
  }
  return ranges;
}

function exportMergeCellEvidence(header, value) {
  const type = value instanceof Date ? 'Date' : typeof value;
  const serialized = JSON.stringify(value);
  const evidence = { type, sha256: crypto.createHash('sha256').update(serialized).digest('hex') };
  // Date/status fields explain operational conflicts without exporting contact
  // data from unrelated columns into routine health diagnostics.
  if (/^(?:status|(?:(?:early|late)\s+)?(?:pickup|delivery)\b.*(?:date|time|arrival|departure))$/i.test(header)) {
    evidence.value = (value instanceof Date ? value.toISOString() : String(value)).slice(0, 160);
  }
  return evidence;
}

function exportMergeTables(tables, baseline, kind, direction, window) {
  if (!tables.length) throw new Error('RXO_EXPORT: no complete export ranges to merge.');
  if (tables.some(table => table.capped)) throw new Error('RXO_EXPORT: a range still reaches the export ceiling.');
  const alignment = exportAlignHeaders(tables, baseline, kind, direction);
  const headers = alignment.headers;
  const keyed = new Map(), firstSeen = new Map(), conflictingKeys = new Set(), samples = [];
  let duplicatesCollapsed = 0, withinWorkbookConflicts = 0, acrossWorkbookConflicts = 0, conflictComparisons = 0;
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex], columns = alignment.maps[tableIndex];
    const workbookKeys = new Map();
    for (const [rowIndex, row] of table.rows.entries()) {
      const key = exportText(row[table.keyIndex]).toUpperCase();
      const values = columns.map(index => row[index] ?? '');
      if (workbookKeys.has(key) && JSON.stringify(workbookKeys.get(key)) !== JSON.stringify(values)) withinWorkbookConflicts++;
      else if (!workbookKeys.has(key)) workbookKeys.set(key, values);
      if (keyed.has(key)) {
        const previous = keyed.get(key);
        if (JSON.stringify(previous) !== JSON.stringify(values)) {
          const origin = firstSeen.get(key);
          conflictComparisons++;
          if (origin.tableIndex !== tableIndex) acrossWorkbookConflicts++;
          conflictingKeys.add(key);
          if (samples.length < 20) {
            const changes = [];
            for (let column = 0; column < headers.length; column++) {
              if (JSON.stringify(previous[column]) !== JSON.stringify(values[column])) {
                changes.push({ column: column + 1, header: headers[column],
                  before: exportMergeCellEvidence(headers[column], previous[column]),
                  after: exportMergeCellEvidence(headers[column], values[column]) });
              }
            }
            samples.push({ key: key.slice(0, 100),
              first: { workbook: origin.tableIndex + 1, keyedRow: origin.rowIndex + 1, sha256: tables[origin.tableIndex].sha256 },
              second: { workbook: tableIndex + 1, keyedRow: rowIndex + 1, sha256: table.sha256 }, changes });
          }
        } else duplicatesCollapsed++;
      } else { keyed.set(key, values); firstSeen.set(key, { tableIndex, rowIndex }); }
    }
  }
  if (conflictingKeys.size) {
    const fields = [...new Set(samples.flatMap(sample => sample.changes.map(change => change.header)))];
    const error = new Error(`RXO_EXPORT ${kind} ${direction}: conflicting duplicate rows for ${conflictingKeys.size} load(s); changed fields: ${fields.slice(0, 5).join(', ')}. No partial merge was published.`);
    error.code = 'RXO_CONFLICTING_EXPORT_ROWS';
    error.rxoMergeConflictKeys = [...conflictingKeys];
    error.rxoMergeDiagnostics = { pageKey: kind, direction, code: error.code,
      conflictingKeys: conflictingKeys.size, withinWorkbookConflicts, acrossWorkbookConflicts,
      samples, samplesTruncated: conflictComparisons > samples.length };
    throw error;
  }
  if (keyed.size >= EXPORT_LIMIT) throw new Error('RXO_EXPORT: complete merged window reaches the existing importer ceiling. No safeguard was bypassed.');
  const { known, missing } = exportMissingKnown(tables, baseline, kind, direction, window);
  if (missing.length) throw exportCoverageError(`RXO_EXPORT ${kind} ${direction}: date exports omitted ${missing.length} known rows in the site window. Prior published data retained.`, tables, baseline, kind, direction, window, []);
  return { headers, rows: [...keyed.values()], duplicatesCollapsed, knownWindowRows: known.size, missingKnownWindowRows: 0, columnAlignment: alignment.evidence };
}

function exportReacquisitionCoverage(tables, previousKeys, conflictKeys, kind, direction) {
  const seen = new Map();
  tables.forEach((table, index) => {
    for (const row of table.rows) {
      const key = exportText(row[table.keyIndex]).toUpperCase();
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(index);
    }
  });
  const missing = [...previousKeys].filter(key => !seen.has(key));
  const unconfirmed = [...conflictKeys].filter(key => (seen.get(key)?.size ?? 0) < 2);
  if (missing.length || unconfirmed.length) {
    const error = new Error(`RXO_EXPORT ${kind} ${direction}: refreshed exports omitted ${missing.length} previously observed load(s) or could not reconfirm ${unconfirmed.length} conflicting load(s) in two complete ranges. No partial merge was published.`);
    error.rxoMergeDiagnostics = { pageKey: kind, direction, code: 'RXO_REACQUISITION_NOT_CONFIRMED',
      missingPreviouslyObservedKeys: missing.length, unconfirmedConflictingKeys: unconfirmed.length,
      missingSamples: missing.slice(0, 20).map(key => key.slice(0, 100)), unconfirmedSamples: unconfirmed.slice(0, 20).map(key => key.slice(0, 100)) };
    throw error;
  }
  return { previouslyObservedKeys: previousKeys.size, recheckedObservedKeys: previousKeys.size,
    previouslyConflictingKeys: conflictKeys.size, reconfirmedConflictingKeys: conflictKeys.size };
}

export {
  exportCoverageError,
  exportHeaderSummary,
  exportMergeTables,
  exportMissingKnown,
  exportRangeDays,
  exportReacquisitionCoverage,
  exportRecoveryRanges,
  exportShiftDay,
};
