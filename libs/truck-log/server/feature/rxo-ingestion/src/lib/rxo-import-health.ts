import type { RxoImportHealth, RxoImportDatasetHealth } from '@truck-log/shared/contracts';

/** Read persisted dataset outcomes; transaction COMPLETE does not mean every export was complete. */
export function rxoImportHealth(batch: Record<string, unknown> | null | undefined): RxoImportHealth {
  let raw = batch?.dataset_summary;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const source = Array.isArray(raw) ? raw : [];
  const datasets: RxoImportDatasetHealth[] = [];
  for (const pageKey of ['orders', 'shipments', 'freight-on-the-move']) {
    for (const direction of ['OUTBOUND', 'INBOUND']) {
      const matches = source.filter((entry) => entry && entry.pageKey === pageKey && entry.direction === direction);
      const entry = matches.length === 1 ? matches[0] : null;
      const status = typeof entry?.status === 'string' ? entry.status : 'NOT_RECORDED';
      const count = (key: string) => Number.isInteger(entry?.[key]) && entry[key] >= 0 ? entry[key] as number : null;
      const sourceRows = count('sourceRows');
      const reason = status === 'COMPLETE' ? null
        : status === 'SKIPPED_POSSIBLE_RXO_EXPORT_CEILING'
          ? `${pageKey} ${direction}: ${sourceRows ?? 'unknown'} source rows; skipped because the export may have reached the 10,000-row RXO ceiling.`
          : `${pageKey} ${direction}: ${status === 'NOT_RECORDED' ? 'dataset completeness was not recorded' : 'dataset was not imported (' + status + ')'}.`;
      datasets.push({ pageKey, direction, status, sourceRows, parsedRows: count('parsedRows'), uniqueRows: count('uniqueRows'), reason });
    }
  }
  const partial = datasets.some((entry) => entry.status !== 'COMPLETE' && entry.status !== 'NOT_RECORDED');
  const unknown = datasets.some((entry) => entry.status === 'NOT_RECORDED');
  const status = !batch ? 'NOT_IMPORTED'
    : batch.status !== 'COMPLETE' ? String(batch.status || 'UNKNOWN')
      : partial ? 'PARTIAL' : unknown ? 'UNKNOWN' : 'COMPLETE';
  return { status, partial: status === 'PARTIAL', complete: status === 'COMPLETE',
    batchId: typeof batch?.source_batch_id === 'string' ? batch.source_batch_id : null,
    datasets, warnings: datasets.flatMap((entry) => entry.reason ? [entry.reason] : []) };
}
