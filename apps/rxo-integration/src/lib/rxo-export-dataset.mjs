import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  FORT_WAYNE_CODE,
  FORT_WAYNE_LEGACY,
  applyFortWayneFilter,
  loadPageForFilterTest,
} from './rxo-filter-ui.mjs';
import { sha256File } from './rxo-export-runtime.mjs';
import {
  EXPORT_ZONE,
  exportDateColumns,
  exportReadWorkbook,
  exportShipmentDateSchema,
  exportText,
} from './rxo-export-data.mjs';
import { exportApplyRange, exportRequireUnwindowed } from './rxo-export-date-filter.mjs';
import {
  exportCoverageError,
  exportHeaderSummary,
  exportMergeTables,
  exportMissingKnown,
  exportRangeDays,
  exportReacquisitionCoverage,
  exportRecoveryRanges,
  exportShiftDay,
} from './rxo-export-merge.mjs';
import { browserSession } from './rxo-export-browser.mjs';
import { exportDownloadVerified, exportFreshDownloadPage } from './rxo-export-download.mjs';
const EXPORT_XLSX = createRequire(import.meta.url)('xlsx');

// RXO_EXPORT: compare complete rows; reacquire a complete range set once when
// separately downloaded files disagree. Never choose an arbitrary winner.
async function exportCompleteDataset({ pageCase, direction, baselineFile, window, exportRange }) {
  const kind = pageCase.key, side = direction.direction;
  const baseline = exportReadWorkbook(baselineFile, kind);
  // Keep valid unbounded datasets byte-for-byte unchanged.
  if (!baseline.capped) return { mode: 'UNWINDOWED_BELOW_CEILING', sourceRows: baseline.sourceRows,
    keyedRows: baseline.rows.length, complete: true, sha256: baseline.sha256 };
  if (!['orders','shipments'].includes(kind)) throw new Error('RXO_EXPORT: Freight On The Move reached the ceiling; no unverified date filter was applied.');
  const dateColumns = exportDateColumns(kind, side);
  const acquisitionWindow = { startDate: exportShiftDay(window.startDate, -1), endDate: exportShiftDay(window.endDate, 1) };
  const discardedPasses = [];
  let totalRangeAttempts = 0, previousKeys = new Set(), conflictKeys = new Set();
  for (let acquisitionPass = 1; acquisitionPass <= 2; acquisitionPass++) {
    const leaves = [], attempts = [], recoveryRanges = [];
    const tables = () => leaves.map(item => item.table);
    try {
      if (kind === 'shipments') exportShipmentDateSchema(baseline, side);
      async function get(range, role, dateColumn) {
        if (totalRangeAttempts >= 60) throw new Error('RXO_EXPORT: maximum bounded export attempts reached across all passes. No partial merge accepted.');
        // A unique index preserves the first-pass workbooks as evidence.
        const exportIndex = totalRangeAttempts++;
        const result = await exportRange(range, exportIndex, dateColumn);
        const proof = result.verification;
        if (!proof?.verified || proof.startDate !== range.startDate || proof.endDate !== range.endDate ||
            proof.field !== (side === 'OUTBOUND' ? 'Pickup' : 'Delivery') || proof.timeZone !== EXPORT_ZONE ||
            (kind === 'shipments' && (proof.pageKey !== kind || proof.requestedDateColumn !== dateColumn || proof.selectedDateColumn !== dateColumn)) ||
            (proof.selectedDateColumn && (proof.selectedDateColumn !== dateColumn || !proof.reopenedColumnVerified))) {
          throw new Error('RXO_EXPORT: range boundaries and date-column selection were not verified.');
        }
        const table = exportReadWorkbook(result.file, kind);
        if (kind === 'shipments') exportShipmentDateSchema(table, side);
        attempts.push({ ...range, role, dateColumn, exportIndex, sourceRows: table.sourceRows, capped: table.capped, sha256: table.sha256,
          dateRangeVerification: proof, workbookValidation: result.workbookValidation ?? null,
          downloadValidation: result.downloadValidation ?? null, headerSummary: exportHeaderSummary(table) });
        if (!table.capped) { leaves.push({ range, role, dateColumn, table }); return; }
        if (range.startDate === range.endDate) throw new Error(`RXO_EXPORT ${kind} ${side}: a single day still reaches the ceiling; current complete data retained.`);
        for (const date of exportRangeDays(range)) await get({ startDate: date, endDate: date }, role, dateColumn);
      }
      for (const dateColumn of dateColumns) await get(acquisitionWindow, 'PRIMARY', dateColumn);
      const primaryCovered = new Set(leaves.filter(item => item.role === 'PRIMARY').flatMap(item => exportRangeDays(item.range)));
      for (const dateColumn of dateColumns) {
        const covered = new Set(leaves.filter(item => item.role === 'PRIMARY' && item.dateColumn === dateColumn).flatMap(item => exportRangeDays(item.range)));
        if (exportRangeDays(acquisitionWindow).some(day => !covered.has(day))) throw new Error('RXO_EXPORT: acquisition ranges do not cover every requested day and date column.');
      }
      const beforeRecovery = exportMissingKnown(tables(), baseline, kind, side, window);
      if (beforeRecovery.missing.length) {
        recoveryRanges.push(...exportRecoveryRanges(beforeRecovery.missing, baseline, side, primaryCovered));
        console.log(`[RXO RXO_EXPORT] ${kind} ${side}: ${beforeRecovery.missing.length} known rows need ${recoveryRanges.length} recorded-date recovery range(s).`);
        for (const range of recoveryRanges) for (const dateColumn of dateColumns) await get(range, 'RECOVERY', dateColumn);
      }
      // Exact row agreement and the original known-key gate remain mandatory.
      const merged = exportMergeTables(tables(), baseline, kind, side, window);
      const recheck = exportReacquisitionCoverage(tables(), previousKeys, conflictKeys, kind, side);
      const mergeConsistency = { verified: true, method: 'EXACT_ALIGNED_ROWS', acquisitionPasses: acquisitionPass,
        reacquisitionAttempted: acquisitionPass === 2, totalRangeAttempts, ...recheck, discardedPasses };
      const book = EXPORT_XLSX.utils.book_new();
      EXPORT_XLSX.utils.book_append_sheet(book, EXPORT_XLSX.utils.aoa_to_sheet([merged.headers, ...merged.rows]), 'Sheet1');
      const temporary = baselineFile + '.verified.tmp.xlsx';
      EXPORT_XLSX.writeFile(book, temporary);
      const written = exportReadWorkbook(temporary, kind);
      if (written.capped || written.rows.length !== merged.rows.length ||
          JSON.stringify(written.rows) !== JSON.stringify(merged.rows)) throw new Error('RXO_EXPORT: merged workbook round-trip verification failed.');
      fs.renameSync(temporary, baselineFile);
      return { mode: 'VERIFIED_SITE_DATE_WINDOW', complete: true, sourceRows: written.sourceRows,
        keyedRows: written.rows.length, duplicatesCollapsed: merged.duplicatesCollapsed, columnAlignment: merged.columnAlignment,
        knownWindowRows: merged.knownWindowRows, missingKnownWindowRows: 0, mergeConsistency,
        missingBeforeRecordedDateRecovery: beforeRecovery.missing.length,
        originalSourceRows: baseline.sourceRows, originalSha256: baseline.sha256, knownCoverageIsLowerBound: true,
        window, acquisitionWindow, recoveryRanges, requiredDateColumns: dateColumns,
        coverage: leaves.map(({ range, role, dateColumn }) => ({ ...range, role, dateColumn })), attempts, sha256: written.sha256 };
    } catch (error) {
      const conflict = error.rxoMergeDiagnostics;
      if (acquisitionPass === 1 && error.code === 'RXO_CONFLICTING_EXPORT_ROWS' &&
          conflict?.withinWorkbookConflicts === 0 && conflict.acrossWorkbookConflicts > 0) {
        previousKeys = new Set(tables().flatMap(table => table.rows.map(row => exportText(row[table.keyIndex]).toUpperCase())));
        conflictKeys = new Set(error.rxoMergeConflictKeys);
        discardedPasses.push({ acquisitionPass, attempts, conflict });
        console.log(`[RXO RXO_EXPORT] ${kind} ${side}: ${conflict.conflictingKeys} load(s) differ between exports; reacquiring all complete ranges once before merging.`);
        continue;
      }
      if (!error.rxoCoverageDiagnostics) error.rxoCoverageDiagnostics = exportCoverageError(error.message, tables(), baseline, kind, side, window, attempts).rxoCoverageDiagnostics;
      else error.rxoCoverageDiagnostics.attempts = attempts;
      if (conflict || discardedPasses.length) error.rxoMergeDiagnostics = { ...(conflict || { pageKey: kind, direction: side }),
        reacquisitionAttempted: discardedPasses.length > 0, acquisitionPasses: acquisitionPass, totalRangeAttempts, discardedPasses };
      throw error;
    }
  }
  throw new Error('RXO_EXPORT: no consistent complete acquisition was produced.');
}

async function exportOneDirection({
  page,
  pageCase,
  direction,
  batchDir,
  batchWindow,
}) {
  const pageDir =
    path.join(
      batchDir,
      'fort-wayne',
      pageCase.exportKey
    );

  const evidenceDir =
    path.join(
      batchDir,
      'evidence',
      pageCase.exportKey,
      direction.direction.toLowerCase()
    );

  console.log('');
  console.log(
    '============================================================'
  );
  console.log(
    `[RXO] ${pageCase.name} - ${direction.direction}`
  );
  console.log(
    `[RXO] Filter: ${direction.filter}`
  );
  console.log(
    `[RXO] Required: ${FORT_WAYNE_CODE} + ${FORT_WAYNE_LEGACY}`
  );
  console.log(
    '============================================================'
  );

  await loadPageForFilterTest(
    page,
    pageCase,
    direction.filter
  );

  await exportRequireUnwindowed(page, pageCase.key);

  let filter =
    await applyFortWayneFilter(
      page,
      direction.filter,
      evidenceDir
    );

  console.log(
    `[RXO] ${pageCase.name} ${direction.direction}: Fort Wayne filter VERIFIED.`
  );

  await page.waitForTimeout(
    1200
  );

  const destination =
    path.join(
      pageDir,
      direction.file
    );

  const recoverDownload = async () => {
    const previous = page;
    page = await exportFreshDownloadPage(previous);
    if (browserSession.page === previous) browserSession.page = page;
    await loadPageForFilterTest(page, pageCase, direction.filter);
    await exportRequireUnwindowed(page, pageCase.key);
    filter = await applyFortWayneFilter(page, direction.filter, evidenceDir);
    await page.waitForTimeout(1200);
  };
  const optionsFor = file => ({ get page() { return page; }, pageCase, direction,
    destination: file, recoverDownload });
  const download = await exportDownloadVerified(optionsFor(destination));

  const completeness = await exportCompleteDataset({
    pageCase, direction, baselineFile: destination, window: batchWindow,
    exportRange: async (range, index, dateColumn) => {
      await loadPageForFilterTest(page, pageCase, direction.filter);
      await exportRequireUnwindowed(page, pageCase.key);
      await applyFortWayneFilter(page, direction.filter, evidenceDir);
      let verification;
      const file = path.join(pageDir, '_verified-ranges', direction.direction, String(index) + '.xlsx');
      const checked = await exportDownloadVerified(optionsFor(file), async () => { verification = await exportApplyRange(page, direction.direction, range, { pageKey: pageCase.key, dateColumn }); });
      return { file, verification, workbookValidation: checked.workbookValidation, downloadValidation: checked.downloadValidation };
    },
  });
  // The complete merged file replaces the raw candidate only inside this batch.
  download.bytes = fs.statSync(destination).size;
  download.sha256 = sha256File(destination);
  console.log(`[RXO RXO_EXPORT] ${pageCase.key} ${direction.direction}: ${completeness.sourceRows} rows; ${completeness.mode}; complete.`);

  return {
    completeness,
    dateRangeVerification: completeness.mode === 'VERIFIED_SITE_DATE_WINDOW'
      ? { verified: true, ...completeness.window, coverage: completeness.coverage }
      : null,
    pageKey:
      pageCase.key,
    pageName:
      pageCase.name,
    url:
      pageCase.url,
    direction:
      direction.direction,
    filter:
      direction.filter,
    requiredIdentifiers: [
      FORT_WAYNE_CODE,
      FORT_WAYNE_LEGACY,
    ],
    filterVerification: {
      method:
        filter.verification
          ?.method ||
        'UNKNOWN',
      expectedSelections:
        2,
      finalSelectedCount:
        filter.verification
          ?.finalCount ??
        filter.beforeApply
          ?.selected ??
        null,
    },
    download,
  };
}

export { exportCompleteDataset, exportOneDirection };
