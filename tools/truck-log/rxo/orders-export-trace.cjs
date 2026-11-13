'use strict';
// Read-only diagnostic. Execute in the existing REGULAR RXO exporter.
// Reads only the published manifest and Orders workbooks; never loads credentials,
// browser profiles, exporter code, or order/driver identifiers into the report.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const XLSX = require('xlsx');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const canonical = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const root = path.resolve(process.env.RXO_DATA_DIR || '/app/data');
const latest = path.join(root, 'latest', 'fort-wayne');
const manifestPath = path.join(latest, 'manifest.json');
function trace() {
  const manifestBytes = fs.readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
  const directions = [];
  for (const direction of ['OUTBOUND', 'INBOUND']) {
    const file = path.join(latest, 'orders', direction === 'OUTBOUND' ? 'Outbound.xlsx' : 'Inbound.xlsx');
    try {
      const bytes = fs.readFileSync(file), sha256 = hash(bytes);
      const book = XLSX.read(bytes, {type: 'buffer', cellDates: true});
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw Error('Workbook has no worksheet');
      const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {header: 1, raw: true, defval: '', blankrows: true});
      const expected = new Set(['ordernumber','orderid','shipmentid','originname','destinationname','pickupdate','deliverydate','status']);
      let headerIndex = -1, bestScore = -1;
      for (let i = 0; i < Math.min(25, rows.length); i++) {
        const keys = new Set(rows[i].map(canonical).filter(Boolean));
        let score = Math.min(keys.size, 20) + rows[i].filter(v => /[A-Za-z]/.test(String(v ?? ''))).length;
        for (const key of keys) if (expected.has(key)) score += 10;
        if (score > bestScore) { bestScore = score; headerIndex = i; }
      }
      const headers = (rows[headerIndex] || []).map(v => String(v ?? '').trim());
      const keyIndex = headers.findIndex(v => ['ordernumber','orderid','order'].includes(canonical(v)));
      if (keyIndex < 0) throw Error('Required Orders key header is missing');
      const data = rows.slice(headerIndex + 1).filter(row => row.some(v => String(v ?? '').trim()));
      const entry = manifest.exports?.find(item => item.pageKey === 'orders' && item.direction === direction);
      directions.push({ direction, file: path.basename(file), sheet: sheetName, headerRow: headerIndex + 1,
        sourceRows: data.length, keyedRows: data.filter(row => String(row[keyIndex] ?? '').trim()).length,
        uniqueOrderKeys: new Set(data.map(row => String(row[keyIndex] ?? '').trim().toUpperCase()).filter(Boolean)).size,
        possibleExportCeiling: data.length >= 10000, sha256, stableDuringRead: sha256 === hash(fs.readFileSync(file)),
        matchesManifestHash: !!entry?.download?.sha256 && sha256 === String(entry.download.sha256).toLowerCase(),
        locationFilter: entry?.filter ?? null, locationFilterVerification: entry?.filterVerification ?? null,
        dateHeaders: headers.filter(v => /pickup|delivery/i.test(v) && /date|time|arrival/i.test(v)),
        verifiedDateRangeRecorded: Boolean(entry?.dateRangeVerification?.verified === true),
      });
    } catch (error) { directions.push({direction, error: error.message.slice(0, 400)}); }
  }
  return { contractVersion: 1, source: 'RXO_REGULAR_EXPORTER', readOnly: true, observedAt: new Date().toISOString(),
    batchId: manifest.batchId ?? null, completedAt: manifest.completedAt ?? null, status: manifest.status ?? null,
    directionRule: manifest.directionRule ?? null, stableManifest: hash(manifestBytes) === hash(fs.readFileSync(manifestPath)), directions,
    note: 'Counts are from published exporter files. The server trace uses the production ExcelJS parser; compare matching file hashes and batch IDs before attributing a cause.' };
}
try { console.log(JSON.stringify(trace())); }
catch (error) { console.error('Regular RXO exporter trace unavailable: ' + error.message.slice(0, 400)); process.exitCode = 1; }
